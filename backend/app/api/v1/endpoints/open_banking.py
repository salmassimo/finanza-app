"""
Open Banking endpoints (GoCardless Bank Account Data PSD2).
Gestione connessioni bancarie, autenticazione e sincronizzazione transazioni.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional
import uuid

from app.db.session import get_db
from app.core.security import get_current_user
from app.core.config import settings
from app.models.models import OBConnessione, OBTransazione
from app.services import open_banking as ob_svc

router = APIRouter()


# ─── Schemas ────────────────────────────────────────────────────────────────────

class IstituzioneOut(BaseModel):
    id: str
    name: str
    bic: Optional[str] = None
    logo: Optional[str] = None
    transaction_total_days: Optional[str] = None


class ConnettiBancaIn(BaseModel):
    institution_id: str
    institution_name: str
    conto_id: Optional[uuid.UUID] = None
    redirect_url: Optional[str] = None  # default: FRONTEND_URL/ob-callback


class ConnessioneOut(BaseModel):
    id: uuid.UUID
    institution_id: str
    institution_name: str
    conto_id: Optional[uuid.UUID] = None
    requisition_id: str
    account_id: Optional[str] = None
    link_url: Optional[str] = None
    status: str
    expires_at: Optional[datetime] = None
    last_sync: Optional[datetime] = None
    created_at: datetime
    class Config: from_attributes = True


class OBTransazioneOut(BaseModel):
    id: uuid.UUID
    transaction_id: str
    data_operazione: datetime
    data_valuta: Optional[datetime] = None
    importo: float
    valuta: str
    descrizione: Optional[str] = None
    debitore_nome: Optional[str] = None
    creditore_nome: Optional[str] = None
    saldo_dopo: Optional[float] = None
    created_at: datetime
    class Config: from_attributes = True


# ─── Callback redirect banca (no auth – ricevuto dal browser dopo autenticazione) ─

@router.get("/callback", response_class=HTMLResponse, include_in_schema=False)
async def ob_callback(request: Request):
    """
    Pagina di callback ricevuta dal browser dopo che l'utente ha autenticato
    con la propria banca. Mostra una pagina 'completato' e invita a tornare all'app.
    Compatibile con GoCardless (?ref=), Enable Banking (?code=&state=) e altri provider.
    """
    params = dict(request.query_params)
    ref = params.get("ref") or params.get("code") or params.get("state") or "—"

    html = f"""<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Autenticazione completata</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background: #0f172a; color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 24px;
    }}
    .card {{
      background: #1e293b; border-radius: 16px; padding: 40px 32px;
      max-width: 420px; width: 100%; text-align: center;
      border: 1px solid #334155;
    }}
    .icon {{ font-size: 56px; margin-bottom: 20px; }}
    h1 {{ font-size: 22px; font-weight: 700; margin-bottom: 12px; color: #22c55e; }}
    p  {{ font-size: 15px; color: #94a3b8; line-height: 1.6; margin-bottom: 8px; }}
    .ref {{
      background: #0f172a; border: 1px solid #334155; border-radius: 8px;
      padding: 10px 16px; margin: 20px 0; font-family: monospace;
      font-size: 12px; color: #60a5fa; word-break: break-all;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Autenticazione completata!</h1>
    <p>La tua banca ha autorizzato l'accesso ai dati del conto.</p>
    <p style="margin-top:12px">Ora <strong>torna nell'app</strong> e premi<br>
       <strong style="color:#22c55e">"Ho completato l'autenticazione"</strong>.</p>
    <div class="ref">ref: {ref}</div>
    <p style="font-size:13px; color:#475569;">Puoi chiudere questa finestra.</p>
  </div>
</body>
</html>"""
    return HTMLResponse(content=html)


# ─── Endpoints ──────────────────────────────────────────────────────────────────

def _check_config():
    if not settings.GOCARDLESS_SECRET_ID or not settings.GOCARDLESS_SECRET_KEY:
        raise HTTPException(
            status_code=503,
            detail="GoCardless non configurato. Aggiungi GOCARDLESS_SECRET_ID e GOCARDLESS_SECRET_KEY nel file .env del backend.",
        )


@router.get("/istituzioni", response_model=list[IstituzioneOut])
async def get_istituzioni(
    country: str = Query("IT", description="Codice paese ISO (IT, DE, FR…)"),
    current_user=Depends(get_current_user),
):
    """Lista banche/istituti disponibili per paese."""
    _check_config()
    try:
        istituti = await ob_svc.get_institutions(country=country)
    except Exception as e:
        raise HTTPException(502, f"Errore GoCardless: {e}")

    return [
        IstituzioneOut(
            id=i["id"],
            name=i["name"],
            bic=i.get("bic"),
            logo=i.get("logo"),
            transaction_total_days=i.get("transaction_total_days"),
        )
        for i in istituti
    ]


@router.post("/connetti", response_model=ConnessioneOut)
async def connetti_banca(
    body: ConnettiBancaIn,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Avvia il collegamento con una banca.
    Ritorna {link_url} da aprire nel browser per completare l'autenticazione.
    Dopo che l'utente ha completato l'auth, chiamare POST /completa/{requisition_id}.
    """
    _check_config()

    redirect_url = body.redirect_url or "http://localhost:8000/api/v1/open-banking/callback"
    reference    = f"finanza_{current_user.id}_{uuid.uuid4().hex[:8]}"

    try:
        req = await ob_svc.create_requisition(
            institution_id=body.institution_id,
            redirect_url=redirect_url,
            reference=reference,
        )
    except Exception as e:
        raise HTTPException(502, f"Errore creazione requisition: {e}")

    conn = OBConnessione(
        utente_id=current_user.id,
        conto_id=body.conto_id,
        institution_id=body.institution_id,
        institution_name=body.institution_name,
        requisition_id=req["id"],
        link_url=req.get("link"),
        status="pending",
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)
    return conn


@router.post("/completa/{requisition_id}", response_model=ConnessioneOut)
async def completa_connessione(
    requisition_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Completa il collegamento dopo che l'utente ha autenticato con la propria banca.
    GoCardless associa uno o più account_id alla requisition; prendiamo il primo.
    """
    _check_config()

    res = await db.execute(
        select(OBConnessione).where(
            OBConnessione.requisition_id == requisition_id,
            OBConnessione.utente_id == current_user.id,
        )
    )
    conn = res.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connessione non trovata")

    try:
        req_data = await ob_svc.get_requisition(requisition_id)
    except Exception as e:
        raise HTTPException(502, f"Errore GoCardless: {e}")

    accounts = req_data.get("accounts", [])
    if not accounts:
        raise HTTPException(
            400,
            "L'autenticazione non è ancora completata. "
            "Completa il processo nel browser e riprova tra qualche minuto.",
        )

    conn.account_id = accounts[0]
    conn.status     = "active"
    conn.expires_at = datetime.utcnow() + timedelta(days=90)
    await db.commit()
    await db.refresh(conn)
    return conn


@router.get("/connessioni", response_model=list[ConnessioneOut])
async def get_connessioni(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Lista tutte le connessioni bancarie dell'utente."""
    res = await db.execute(
        select(OBConnessione)
        .where(OBConnessione.utente_id == current_user.id)
        .order_by(OBConnessione.created_at.desc())
    )
    return res.scalars().all()


@router.post("/sync/{connessione_id}")
async def sync_connessione(
    connessione_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Sincronizza transazioni e saldo per una connessione attiva.
    - Scarica transazioni da GoCardless
    - Inserisce in ob_transazioni (dedup)
    - Inserisce in movimenti con auto-categorizzazione (dedup)
    - Aggiorna saldo in saldi_snapshot
    """
    _check_config()

    res = await db.execute(
        select(OBConnessione).where(
            OBConnessione.id == connessione_id,
            OBConnessione.utente_id == current_user.id,
        )
    )
    conn = res.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connessione non trovata")
    if conn.status == "expired":
        raise HTTPException(400, "Connessione scaduta (90 giorni PSD2). Ricollega la banca.")
    if not conn.account_id:
        raise HTTPException(400, "Autenticazione non completata. Usa POST /completa/{requisition_id} prima.")

    try:
        result = await ob_svc.sync_connessione(db, conn)
    except Exception as e:
        raise HTTPException(502, f"Errore sincronizzazione: {e}")

    return result


@router.delete("/connessioni/{connessione_id}", status_code=204)
async def elimina_connessione(
    connessione_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Rimuove una connessione bancaria (revoca anche lato GoCardless)."""
    res = await db.execute(
        select(OBConnessione).where(
            OBConnessione.id == connessione_id,
            OBConnessione.utente_id == current_user.id,
        )
    )
    conn = res.scalar_one_or_none()
    if not conn:
        raise HTTPException(404, "Connessione non trovata")

    # Revoca lato GoCardless (best-effort)
    await ob_svc.delete_requisition(conn.requisition_id)

    await db.delete(conn)
    await db.commit()


@router.get("/transazioni", response_model=list[OBTransazioneOut])
async def get_transazioni_ob(
    connessione_id: Optional[uuid.UUID] = None,
    limit: int = Query(200, le=500),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Lista transazioni raw da Open Banking (per analisi/debug)."""
    q = (
        select(OBTransazione)
        .where(OBTransazione.utente_id == current_user.id)
        .order_by(OBTransazione.data_operazione.desc())
        .limit(limit)
    )
    if connessione_id:
        q = q.where(OBTransazione.connessione_id == connessione_id)

    res = await db.execute(q)
    rows = res.scalars().all()

    # Converte date → datetime per il modello Pydantic
    out = []
    for r in rows:
        out.append(OBTransazioneOut(
            id=r.id,
            transaction_id=r.transaction_id,
            data_operazione=datetime.combine(r.data_operazione, datetime.min.time()),
            data_valuta=datetime.combine(r.data_valuta, datetime.min.time()) if r.data_valuta else None,
            importo=float(r.importo),
            valuta=r.valuta,
            descrizione=r.descrizione,
            debitore_nome=r.debitore_nome,
            creditore_nome=r.creditore_nome,
            saldo_dopo=float(r.saldo_dopo) if r.saldo_dopo else None,
            created_at=r.created_at,
        ))
    return out
