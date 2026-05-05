import uuid
from typing import Optional, List
from decimal import Decimal
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel

from app.db.session import get_db
from app.core.security import get_current_user
from app.models.models import Conto, SaldoSnapshot

router = APIRouter()


# ── SCHEMAS ────────────────────────────────────────────────────────────────────

class ContoOut(BaseModel):
    id: uuid.UUID
    nome: str
    tipo: str
    banca: Optional[str]
    iban: Optional[str]
    valuta: str
    attivo: bool
    saldo_corrente: Optional[Decimal]  # latest SaldoSnapshot.saldo
    rilevato_at: Optional[datetime]    # when saldo was recorded

    class Config:
        from_attributes = True


class SaldoIn(BaseModel):
    saldo: float


# ── HELPERS ────────────────────────────────────────────────────────────────────

async def _get_latest_saldi(db: AsyncSession, conto_ids: list) -> dict:
    """Returns {conto_id: SaldoSnapshot} for the most recent snapshot per conto."""
    if not conto_ids:
        return {}
    subq = (
        select(
            SaldoSnapshot.conto_id,
            func.max(SaldoSnapshot.rilevato_at).label("max_ts"),
        )
        .where(SaldoSnapshot.conto_id.in_(conto_ids))
        .group_by(SaldoSnapshot.conto_id)
        .subquery()
    )
    result = await db.execute(
        select(SaldoSnapshot).join(
            subq,
            (SaldoSnapshot.conto_id == subq.c.conto_id)
            & (SaldoSnapshot.rilevato_at == subq.c.max_ts),
        )
    )
    rows = result.scalars().all()
    return {row.conto_id: row for row in rows}


# ── ENDPOINTS ──────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[ContoOut])
async def list_conti(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Restituisce tutti i conti attivi dell'utente con l'ultimo saldo registrato."""
    result = await db.execute(
        select(Conto).where(
            Conto.utente_id == current_user.id,
            Conto.attivo == True,
        ).order_by(Conto.nome)
    )
    conti = result.scalars().all()

    if not conti:
        return []

    saldi_map = await _get_latest_saldi(db, [c.id for c in conti])

    output = []
    for conto in conti:
        snap = saldi_map.get(conto.id)
        output.append(
            ContoOut(
                id=conto.id,
                nome=conto.nome,
                tipo=conto.tipo.value,
                banca=conto.banca,
                iban=conto.iban,
                valuta=conto.valuta,
                attivo=conto.attivo,
                saldo_corrente=snap.saldo if snap else None,
                rilevato_at=snap.rilevato_at if snap else None,
            )
        )
    return output


@router.post("/{conto_id}/saldo", response_model=ContoOut, status_code=status.HTTP_201_CREATED)
async def update_saldo(
    conto_id: uuid.UUID,
    body: SaldoIn,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Registra un nuovo saldo per il conto specificato."""
    # Verify conto belongs to current user
    result = await db.execute(
        select(Conto).where(
            Conto.id == conto_id,
            Conto.utente_id == current_user.id,
        )
    )
    conto = result.scalar_one_or_none()
    if not conto:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conto non trovato",
        )

    new_snap = SaldoSnapshot(
        conto_id=conto_id,
        saldo=Decimal(str(body.saldo)),
        fonte="manuale",
        rilevato_at=datetime.utcnow(),
    )
    db.add(new_snap)
    await db.flush()  # populate new_snap.id without closing session

    return ContoOut(
        id=conto.id,
        nome=conto.nome,
        tipo=conto.tipo.value,
        banca=conto.banca,
        iban=conto.iban,
        valuta=conto.valuta,
        attivo=conto.attivo,
        saldo_corrente=new_snap.saldo,
        rilevato_at=new_snap.rilevato_at,
    )
