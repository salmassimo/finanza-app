from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.core.security import (
    verify_password, create_access_token, hash_password,
    create_temp_token, verify_temp_token, get_current_user,
)
from app.models.models import Utente
from pydantic import BaseModel, EmailStr
from typing import Optional
import pyotp
import uuid

router = APIRouter()


# ── Schemi ──────────────────────────────────────────────

class Token(BaseModel):
    access_token: str
    token_type: str
    utente_id: str
    nome: str

class LoginStep1Response(BaseModel):
    """Risposta login quando 2FA è abilitato."""
    requires_2fa: bool
    temp_token: Optional[str] = None
    access_token: Optional[str] = None
    token_type: Optional[str] = None
    utente_id: Optional[str] = None
    nome: Optional[str] = None

class RegisterIn(BaseModel):
    nome: str
    cognome: str
    email: EmailStr
    password: str

class LoginTotpIn(BaseModel):
    temp_token: str
    totp_code: str

class Setup2FAResponse(BaseModel):
    secret: str
    totp_uri: str

class Verify2FAIn(BaseModel):
    totp_code: str

class Disable2FAIn(BaseModel):
    password: str


# ── Endpoints ────────────────────────────────────────────

@router.post("/login", response_model=LoginStep1Response)
async def login(form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Utente).where(Utente.email == form.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenziali errate")

    # Se 2FA abilitato → restituisce temp_token
    if user.totp_enabled and user.totp_secret:
        return LoginStep1Response(
            requires_2fa=True,
            temp_token=create_temp_token(user.email),
        )

    # Altrimenti → JWT completo
    token = create_access_token({"sub": user.email})
    return LoginStep1Response(
        requires_2fa=False,
        access_token=token,
        token_type="bearer",
        utente_id=str(user.id),
        nome=user.nome,
    )


@router.post("/login-totp", response_model=Token)
async def login_totp(body: LoginTotpIn, db: AsyncSession = Depends(get_db)):
    """Step 2: verifica codice TOTP e restituisce JWT completo."""
    email = verify_temp_token(body.temp_token)
    result = await db.execute(select(Utente).where(Utente.email == email))
    user = result.scalar_one_or_none()
    if not user or not user.totp_secret:
        raise HTTPException(status_code=401, detail="Utente non trovato")

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(body.totp_code, valid_window=1):
        raise HTTPException(status_code=401, detail="Codice 2FA non valido")

    token = create_access_token({"sub": user.email})
    return Token(access_token=token, token_type="bearer", utente_id=str(user.id), nome=user.nome)


@router.post("/setup-2fa", response_model=Setup2FAResponse)
async def setup_2fa(db: AsyncSession = Depends(get_db), current_user: Utente = Depends(get_current_user)):
    """Genera un nuovo secret TOTP e lo salva (non ancora abilitato)."""
    secret = pyotp.random_base32()
    current_user.totp_secret = secret
    current_user.totp_enabled = False  # si abilita solo dopo verifica
    await db.commit()

    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name=current_user.email, issuer_name="Finanza App")
    return Setup2FAResponse(secret=secret, totp_uri=uri)


@router.post("/enable-2fa")
async def enable_2fa(body: Verify2FAIn, db: AsyncSession = Depends(get_db), current_user: Utente = Depends(get_current_user)):
    """Abilita il 2FA verificando il primo codice TOTP."""
    if not current_user.totp_secret:
        raise HTTPException(400, "Esegui prima /setup-2fa")
    totp = pyotp.TOTP(current_user.totp_secret)
    if not totp.verify(body.totp_code, valid_window=1):
        raise HTTPException(400, "Codice non valido. Riprova.")
    current_user.totp_enabled = True
    await db.commit()
    return {"detail": "2FA abilitato con successo"}


@router.post("/disable-2fa")
async def disable_2fa(body: Disable2FAIn, db: AsyncSession = Depends(get_db), current_user: Utente = Depends(get_current_user)):
    """Disabilita il 2FA (richiede password)."""
    if not verify_password(body.password, current_user.password_hash):
        raise HTTPException(401, "Password non corretta")
    current_user.totp_enabled = False
    current_user.totp_secret = None
    await db.commit()
    return {"detail": "2FA disabilitato"}


@router.get("/2fa-status")
async def get_2fa_status(current_user: Utente = Depends(get_current_user)):
    return {"totp_enabled": current_user.totp_enabled}


@router.post("/register", response_model=Token)
async def register(data: RegisterIn, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Utente).where(Utente.email == data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email già registrata")
    user = Utente(nome=data.nome, cognome=data.cognome, email=data.email, password_hash=hash_password(data.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_access_token({"sub": user.email})
    return Token(access_token=token, token_type="bearer", utente_id=str(user.id), nome=user.nome)
