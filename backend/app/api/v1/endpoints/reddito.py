"""
Reddito da lavoro dipendente — buste paga importate.
Fornisce la lista, una sintesi annuale (netto/lordo, 13ª/14ª/premi) e la
stima del reddito annuo usata come base nelle analisi AI.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.core.security import get_current_user
from app.models.models import BustaPaga
from pydantic import BaseModel
from decimal import Decimal
from collections import defaultdict
import uuid

router = APIRouter()

MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
        "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"]

RICORRENTI = ("ordinaria",)          # mensilità che fanno media
AGGIUNTIVE = ("tredicesima", "quattordicesima")
STRAORD    = ("premio", "una_tantum")


class BustaOut(BaseModel):
    id: uuid.UUID
    anno: int
    mese: int
    mese_label: str
    azienda: str | None
    tipo_mensilita: str
    totale_competenze: Decimal
    totale_trattenute: Decimal
    netto: Decimal
    voci: list | None

    class Config:
        from_attributes = True


@router.get("/", response_model=list[BustaOut])
async def list_buste(db: AsyncSession = Depends(get_db), current_user=Depends(get_current_user)):
    res = await db.execute(
        select(BustaPaga)
        .where(BustaPaga.utente_id == current_user.id)
        .order_by(BustaPaga.anno.desc(), BustaPaga.mese.desc())
    )
    return [
        BustaOut(
            id=b.id, anno=b.anno, mese=b.mese, mese_label=MESI[b.mese - 1],
            azienda=b.azienda, tipo_mensilita=b.tipo_mensilita,
            totale_competenze=b.totale_competenze, totale_trattenute=b.totale_trattenute,
            netto=b.netto, voci=b.voci or [],
        )
        for b in res.scalars().all()
    ]


def _sintesi_da_buste(buste: list[BustaPaga]) -> dict:
    """Calcola la sintesi reddito (usata anche dal contesto AI)."""
    if not buste:
        return {"n_buste": 0, "anni": [], "netto_mensile_medio": 0.0,
                "reddito_netto_annuo_stimato": 0.0, "reddito_lordo_annuo_stimato": 0.0}

    per_anno: dict[int, list] = defaultdict(list)
    for b in buste:
        per_anno[b.anno].append(b)

    anni = []
    for anno in sorted(per_anno, reverse=True):
        bs = per_anno[anno]
        ordinarie = [b for b in bs if b.tipo_mensilita in RICORRENTI]
        media_netto = (sum((b.netto for b in ordinarie), Decimal(0)) / len(ordinarie)) if ordinarie else Decimal(0)
        media_lordo = (sum((b.totale_competenze for b in ordinarie), Decimal(0)) / len(ordinarie)) if ordinarie else Decimal(0)
        aggiuntive_netto = sum((b.netto for b in bs if b.tipo_mensilita in AGGIUNTIVE), Decimal(0))
        aggiuntive_lordo = sum((b.totale_competenze for b in bs if b.tipo_mensilita in AGGIUNTIVE), Decimal(0))
        premi_netto = sum((b.netto for b in bs if b.tipo_mensilita in STRAORD), Decimal(0))
        premi_lordo = sum((b.totale_competenze for b in bs if b.tipo_mensilita in STRAORD), Decimal(0))
        anni.append({
            "anno": anno,
            "n_buste": len(bs),
            "netto_totale": float(sum((b.netto for b in bs), Decimal(0))),
            "lordo_totale": float(sum((b.totale_competenze for b in bs), Decimal(0))),
            "media_netto_mensile": float(media_netto),
            "media_lordo_mensile": float(media_lordo),
            "ha_tredicesima": any(b.tipo_mensilita == "tredicesima" for b in bs),
            "ha_quattordicesima": any(b.tipo_mensilita == "quattordicesima" for b in bs),
            "aggiuntive_netto": float(aggiuntive_netto),
            "premi_netto": float(premi_netto),
            # Stima normalizzata sull'anno: 12 mensilità ordinarie + aggiuntive + premi
            "reddito_netto_annuo_stimato": float(media_netto * 12 + aggiuntive_netto + premi_netto),
            "reddito_lordo_annuo_stimato": float(media_lordo * 12 + aggiuntive_lordo + premi_lordo),
        })

    ultimo = anni[0]
    return {
        "n_buste": len(buste),
        "azienda": buste[0].azienda,
        "anni": anni,
        "netto_mensile_medio": ultimo["media_netto_mensile"],
        "reddito_netto_annuo_stimato": ultimo["reddito_netto_annuo_stimato"],
        "reddito_lordo_annuo_stimato": ultimo["reddito_lordo_annuo_stimato"],
    }


@router.get("/sintesi")
async def sintesi_reddito(db: AsyncSession = Depends(get_db), current_user=Depends(get_current_user)):
    res = await db.execute(select(BustaPaga).where(BustaPaga.utente_id == current_user.id))
    return _sintesi_da_buste(res.scalars().all())


@router.delete("/{busta_id}")
async def delete_busta(busta_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user=Depends(get_current_user)):
    b = await db.get(BustaPaga, busta_id)
    if not b or b.utente_id != current_user.id:
        raise HTTPException(404, "Busta paga non trovata")
    await db.delete(b)
    await db.commit()
    return {"ok": True}
