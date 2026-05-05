"""
Fondo Pensione Complementare — CRUD + snapshot storico.
Supporta fondi chiusi (es. Mario Negri), aperti e PIP.
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.core.security import get_current_user
from app.models.models import FondoPensione, FondoPensioneSnapshot

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class SnapshotOut(BaseModel):
    id: int
    data_riferimento: date
    saldo_individuale: Decimal
    tfr_maturato: Decimal
    totale_posizione: Decimal
    versamenti_ytd: Optional[Decimal]
    risultato_esercizio: Optional[Decimal]
    anzianita_anni: int
    anzianita_mesi: int
    anzianita_giorni: int
    fonte: str
    rilevato_at: datetime
    note: Optional[str]

    class Config:
        from_attributes = True


class FondoOut(BaseModel):
    id: uuid.UUID
    nome: str
    tipo: str
    note: Optional[str]
    ultimo_snapshot: Optional[SnapshotOut]

    class Config:
        from_attributes = True


class FondoCreate(BaseModel):
    nome: str
    tipo: str = "chiuso"
    note: Optional[str] = None


class SnapshotCreate(BaseModel):
    data_riferimento: date
    saldo_individuale: float
    tfr_maturato: float
    totale_posizione: float
    versamenti_ytd: Optional[float] = None
    risultato_esercizio: Optional[float] = None
    anzianita_anni: int
    anzianita_mesi: int
    anzianita_giorni: int = 0
    fonte: str = "manuale"
    note: Optional[str] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _anzianita_totale_mesi(snap: FondoPensioneSnapshot) -> int:
    return snap.anzianita_anni * 12 + snap.anzianita_mesi


def _mesi_a_8_anni(snap: FondoPensioneSnapshot) -> int:
    return max(0, 96 - _anzianita_totale_mesi(snap))


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[FondoOut])
async def list_fondi(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(
        select(FondoPensione)
        .options(selectinload(FondoPensione.snapshots))
        .where(FondoPensione.utente_id == current_user.id)
        .order_by(FondoPensione.nome)
    )
    fondi = result.scalars().all()
    out = []
    for f in fondi:
        ultimo = f.snapshots[0] if f.snapshots else None
        out.append(FondoOut(
            id=f.id, nome=f.nome, tipo=f.tipo, note=f.note,
            ultimo_snapshot=SnapshotOut.model_validate(ultimo) if ultimo else None,
        ))
    return out


@router.post("/", response_model=FondoOut, status_code=status.HTTP_201_CREATED)
async def create_fondo(
    body: FondoCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    fondo = FondoPensione(
        utente_id=current_user.id,
        nome=body.nome,
        tipo=body.tipo,
        note=body.note,
    )
    db.add(fondo)
    await db.flush()
    await db.commit()
    await db.refresh(fondo)
    return FondoOut(id=fondo.id, nome=fondo.nome, tipo=fondo.tipo, note=fondo.note, ultimo_snapshot=None)


@router.post("/{fondo_id}/snapshot", response_model=SnapshotOut, status_code=status.HTTP_201_CREATED)
async def add_snapshot(
    fondo_id: uuid.UUID,
    body: SnapshotCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    res = await db.execute(
        select(FondoPensione).where(
            FondoPensione.id == fondo_id,
            FondoPensione.utente_id == current_user.id,
        )
    )
    fondo = res.scalar_one_or_none()
    if not fondo:
        raise HTTPException(status_code=404, detail="Fondo non trovato")

    snap = FondoPensioneSnapshot(
        fondo_id=fondo_id,
        data_riferimento=body.data_riferimento,
        saldo_individuale=Decimal(str(body.saldo_individuale)),
        tfr_maturato=Decimal(str(body.tfr_maturato)),
        totale_posizione=Decimal(str(body.totale_posizione)),
        versamenti_ytd=Decimal(str(body.versamenti_ytd)) if body.versamenti_ytd is not None else None,
        risultato_esercizio=Decimal(str(body.risultato_esercizio)) if body.risultato_esercizio is not None else None,
        anzianita_anni=body.anzianita_anni,
        anzianita_mesi=body.anzianita_mesi,
        anzianita_giorni=body.anzianita_giorni,
        fonte=body.fonte,
        rilevato_at=datetime.utcnow(),
        note=body.note,
    )
    db.add(snap)
    await db.commit()
    await db.refresh(snap)
    return SnapshotOut.model_validate(snap)


@router.get("/regole-accesso")
async def regole_accesso():
    """
    Regole generali di accesso alle prestazioni dei fondi pensione complementari
    (D.Lgs. 252/2005 + regolamento Mario Negri).
    """
    return {
        "anticipazioni": [
            {
                "titolo": "Gravi motivi di salute",
                "percentuale_max": 75,
                "anzianita_minima_anni": 0,
                "descrizione": "Anticipazione fino al 75% in qualsiasi momento per spese sanitarie gravi (proprie o del coniuge/figli): ricovero ospedaliero, interventi chirurgici, terapie salvavita.",
                "modalita": "Domanda con documentazione medica. Liquidazione entro 30 giorni.",
            },
            {
                "titolo": "Acquisto o ristrutturazione prima casa",
                "percentuale_max": 75,
                "anzianita_minima_anni": 8,
                "descrizione": "Anticipazione fino al 75% dopo 8 anni di iscrizione per acquisto o ristrutturazione dell'abitazione principale propria o dei figli.",
                "modalita": "Domanda con atto notarile o permesso di costruire. L'importo è tassato al 23%.",
            },
            {
                "titolo": "Motivi personali (qualsiasi)",
                "percentuale_max": 30,
                "anzianita_minima_anni": 8,
                "descrizione": "Anticipazione del 30% dopo 8 anni senza obbligo di motivazione. Tassazione al 23%.",
                "modalita": "Semplice domanda al fondo. Liquidazione entro 90 giorni.",
            },
        ],
        "riscatti": [
            {
                "titolo": "Riscatto parziale (50%)",
                "anzianita_minima_anni": 8,
                "cause": [
                    "Inoccupazione per più di 12 mesi e meno di 48 mesi",
                    "Mobilità/cassa integrazione",
                    "Invalidità permanente che riduce la capacità lavorativa a meno di 1/3",
                ],
                "tassazione": "Ritenuta a titolo d'imposta 15% (scende al 9% dopo 35 anni di iscrizione, -0,30%/anno dopo il 15°).",
            },
            {
                "titolo": "Riscatto totale",
                "anzianita_minima_anni": 0,
                "cause": [
                    "Invalidità permanente con inabilità totale al lavoro",
                    "Perdita definitiva dei requisiti di partecipazione (cessazione attività lavorativa senza nuovo impiego)",
                    "Decesso dell'aderente (pagamento agli eredi/beneficiari)",
                ],
                "tassazione": "Ritenuta a titolo d'imposta 15% (riduzione come riscatto parziale).",
            },
        ],
        "prestazioni_pensionistiche": [
            {
                "titolo": "Pensione complementare",
                "requisiti": "Raggiungimento requisiti pensionistici obbligatori (INPS) + almeno 5 anni di iscrizione al fondo complementare.",
                "modalita": "Rendita vitalizia (obbligatoria per almeno il 50% della posizione), o capitale fino al 50%.",
                "tassazione": "Aliquota dal 15% al 9% in base agli anni di iscrizione (riduzione 0,30%/anno dopo il 15°).",
            },
            {
                "titolo": "RITA — Rendita Integrativa Temporanea Anticipata",
                "requisiti": [
                    "Cessazione attività lavorativa",
                    "Maturazione dei requisiti pensione di vecchiaia entro i 5 anni successivi",
                    "Almeno 20 anni di contribuzione INPS",
                    "Almeno 5 anni di iscrizione al fondo",
                ],
                "descrizione": "Permette di ricevere la posizione individuale (in tutto o in parte) in rate mensili fino alla pensione INPS. Tassazione agevolata: aliquota sostitutiva 15% (-0,30%/anno dopo 15° anno di iscrizione).",
            },
        ],
        "nota_fiscale": (
            "Le somme versate al fondo sono deducibili dal reddito imponibile IRPEF fino a €5.164,57/anno. "
            "Le anticipazioni per salute grave non sono soggette a ritenuta. "
            "Le anticipazioni per casa/motivi personali sono tassate al 23% fisso. "
            "Le prestazioni finali beneficiano di aliquote ridotte (min 9%) rispetto all'IRPEF ordinaria."
        ),
    }
