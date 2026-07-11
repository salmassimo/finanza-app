"""
Reddito da lavoro dipendente — buste paga importate.
Fornisce la lista, una sintesi annuale (netto/lordo, 13ª/14ª/premi) e la
stima del reddito annuo usata come base nelle analisi AI.
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from app.db.session import get_db
from app.core.security import get_current_user
from app.models.models import BustaPaga, Movimento, TipoMovimento, CategoriaSpesa
from pydantic import BaseModel
from decimal import Decimal
from collections import defaultdict
from datetime import date
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
    has_pdf: bool = False

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
            netto=b.netto, voci=b.voci or [], has_pdf=b.file_pdf is not None,
        )
        for b in res.scalars().all()
    ]


@router.get("/{busta_id}/pdf")
async def get_busta_pdf(busta_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user=Depends(get_current_user)):
    b = await db.get(BustaPaga, busta_id)
    if not b or b.utente_id != current_user.id:
        raise HTTPException(404, "Busta paga non trovata")
    if not b.file_pdf:
        raise HTTPException(404, "PDF non archiviato per questa busta")
    return Response(
        content=b.file_pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="busta_{b.anno}_{b.mese:02d}.pdf"'},
    )


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


@router.get("/confronto")
async def confronto_reddito_spese(anno: int | None = None, db: AsyncSession = Depends(get_db), current_user=Depends(get_current_user)):
    """
    Confronto mensile reddito (netto buste) vs spese (uscite del conto, escluse
    le voci carta per non contare doppio con l'addebito di saldo carta).
    """
    res = await db.execute(select(BustaPaga).where(BustaPaga.utente_id == current_user.id))
    buste = res.scalars().all()
    anni_disp = sorted({b.anno for b in buste}, reverse=True)
    if anno is None:
        anno = anni_disp[0] if anni_disp else date.today().year

    reddito_mese: dict[int, Decimal] = defaultdict(Decimal)
    for b in buste:
        if b.anno == anno:
            reddito_mese[b.mese] += b.netto

    # Escludi trasferimenti/risparmio (giroconti verso investimenti/PAC) dalle spese
    escl_cat = select(CategoriaSpesa.id).where(CategoriaSpesa.nome.in_(["Investimenti", "Trasferimenti"]))
    r2 = await db.execute(
        select(
            func.extract("month", Movimento.data_operazione).label("m"),
            func.coalesce(func.sum(Movimento.importo), 0).label("tot"),
        )
        .where(
            Movimento.utente_id == current_user.id,
            Movimento.tipo == TipoMovimento.uscita,
            Movimento.is_carta_credito == False,
            func.extract("year", Movimento.data_operazione) == anno,
            or_(Movimento.categoria_id.is_(None), Movimento.categoria_id.notin_(escl_cat)),
        )
        .group_by("m")
    )
    spese_mese = {int(row.m): abs(Decimal(str(row.tot))) for row in r2.fetchall()}

    mesi = sorted(set(reddito_mese) | set(spese_mese))
    punti = []
    for m in mesi:
        red = float(reddito_mese.get(m, Decimal(0)))
        spe = float(spese_mese.get(m, Decimal(0)))
        punti.append({
            "mese": m, "label": MESI[m - 1][:3],
            "reddito": round(red, 2), "spese": round(spe, 2),
            "risparmio": round(red - spe, 2),
        })

    tot_red = sum(p["reddito"] for p in punti)
    tot_spe = sum(p["spese"] for p in punti)
    return {
        "anno": anno,
        "anni_disponibili": anni_disp,
        "punti": punti,
        "totale_reddito": round(tot_red, 2),
        "totale_spese": round(tot_spe, 2),
        "risparmio": round(tot_red - tot_spe, 2),
        "tasso_risparmio": round(100 * (tot_red - tot_spe) / tot_red, 1) if tot_red else 0.0,
    }


class BustaUpdate(BaseModel):
    tipo_mensilita: str | None = None
    netto: Decimal | None = None
    totale_competenze: Decimal | None = None
    totale_trattenute: Decimal | None = None


@router.patch("/{busta_id}")
async def update_busta(busta_id: uuid.UUID, body: BustaUpdate, db: AsyncSession = Depends(get_db), current_user=Depends(get_current_user)):
    """Correzione manuale (quando l'analisi AI sbaglia tipo o importi)."""
    b = await db.get(BustaPaga, busta_id)
    if not b or b.utente_id != current_user.id:
        raise HTTPException(404, "Busta paga non trovata")
    if body.tipo_mensilita is not None:
        b.tipo_mensilita = body.tipo_mensilita
    if body.netto is not None:
        b.netto = body.netto
    if body.totale_competenze is not None:
        b.totale_competenze = body.totale_competenze
    if body.totale_trattenute is not None:
        b.totale_trattenute = body.totale_trattenute
    await db.commit()
    return {"ok": True}


@router.delete("/{busta_id}")
async def delete_busta(busta_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user=Depends(get_current_user)):
    b = await db.get(BustaPaga, busta_id)
    if not b or b.utente_id != current_user.id:
        raise HTTPException(404, "Busta paga non trovata")
    await db.delete(b)
    await db.commit()
    return {"ok": True}
