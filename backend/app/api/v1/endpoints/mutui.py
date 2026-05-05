from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.db.session import get_db
from app.core.security import get_current_user
from app.models.models import Mutuo, PianoAmmortamento
from pydantic import BaseModel
from decimal import Decimal
from datetime import date
from typing import Optional
import uuid

router = APIRouter()


class RataOut(BaseModel):
    numero_rata: int
    data_scadenza: date
    quota_capitale: Decimal
    quota_interessi: Decimal
    rata_totale: Decimal
    pagata: bool
    capitale_residuo_dopo: Optional[Decimal] = None
    class Config: from_attributes = True

class MutuoOut(BaseModel):
    id: uuid.UUID
    nome: str
    banca: str
    numero_contratto: Optional[str] = None
    immobile_id: Optional[uuid.UUID] = None
    capitale_erogato: Decimal
    capitale_residuo_live: Decimal   # calcolato da piano
    tasso_tipo: str = "fisso"
    tasso_valore: Optional[Decimal] = None  # TAN in %
    rata_mensile: Decimal
    rate_totali: int
    rate_pagate_live: int            # calcolato da piano
    data_erogazione: date
    data_scadenza: date
    prossima_scadenza: Optional[date] = None
    prossima_rata: Optional[Decimal] = None
    interessi_pagati: Decimal
    interessi_residui: Decimal
    class Config: from_attributes = True


@router.get("/", response_model=list[MutuoOut])
async def get_mutui(db: AsyncSession = Depends(get_db), current_user=Depends(get_current_user)):
    res = await db.execute(
        select(Mutuo).where(Mutuo.utente_id == current_user.id, Mutuo.attivo == True)
    )
    mutui = res.scalars().all()
    out = []
    for m in mutui:
        out.append(await _build_mutuo_out(db, m))
    return out


@router.get("/{mutuo_id}", response_model=MutuoOut)
async def get_mutuo(mutuo_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user=Depends(get_current_user)):
    m = await db.get(Mutuo, mutuo_id)
    if not m or m.utente_id != current_user.id:
        raise HTTPException(404, "Mutuo non trovato")
    return await _build_mutuo_out(db, m)


@router.get("/{mutuo_id}/piano", response_model=list[RataOut])
async def get_piano(mutuo_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user=Depends(get_current_user)):
    m = await db.get(Mutuo, mutuo_id)
    if not m or m.utente_id != current_user.id:
        raise HTTPException(404, "Mutuo non trovato")

    res = await db.execute(
        select(PianoAmmortamento)
        .where(PianoAmmortamento.mutuo_id == mutuo_id)
        .order_by(PianoAmmortamento.numero_rata)
    )
    rate = res.scalars().all()
    today = date.today()

    # Calcola capitale residuo progressivo
    cap = m.capitale_erogato
    out = []
    for r in rate:
        cap -= r.quota_capitale
        pagata = r.data_scadenza <= today
        out.append(RataOut(
            numero_rata=r.numero_rata,
            data_scadenza=r.data_scadenza,
            quota_capitale=r.quota_capitale,
            quota_interessi=r.quota_interessi,
            rata_totale=r.rata_totale,
            pagata=pagata,
            capitale_residuo_dopo=cap,
        ))
    return out


class AnalisiAnnualeItem(BaseModel):
    anno: int
    quota_capitale: Decimal
    quota_interessi: Decimal
    rata_totale: Decimal
    n_rate: int
    n_pagate: int
    capitale_residuo_fine_anno: Optional[Decimal] = None


@router.get("/{mutuo_id}/analisi-annuale", response_model=list[AnalisiAnnualeItem])
async def get_analisi_annuale(
    mutuo_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    m = await db.get(Mutuo, mutuo_id)
    if not m or m.utente_id != current_user.id:
        raise HTTPException(404, "Mutuo non trovato")

    res = await db.execute(
        select(PianoAmmortamento)
        .where(PianoAmmortamento.mutuo_id == mutuo_id)
        .order_by(PianoAmmortamento.numero_rata)
    )
    rate = res.scalars().all()

    if not rate:
        return []

    today = date.today()

    # Group by year
    from collections import defaultdict
    anni: dict[int, list] = defaultdict(list)
    for r in rate:
        anni[r.data_scadenza.year].append(r)

    # Progressive capitale residuo fallback (when capitale_residuo_dopo is not stored)
    cap_progressivo = m.capitale_erogato
    # Pre-compute progressive map indexed by rata id
    cap_map: dict[int, Decimal] = {}
    for r in rate:
        cap_progressivo -= r.quota_capitale
        cap_map[r.id] = cap_progressivo

    result = []
    for anno in sorted(anni.keys()):
        righe = anni[anno]
        tot_capitale = sum(r.quota_capitale for r in righe)
        tot_interessi = sum(r.quota_interessi for r in righe)
        tot_rata = sum(r.rata_totale for r in righe)
        n_rate_anno = len(righe)
        # Usa la data di scadenza (come il main endpoint) invece del flag statico "pagata"
        n_pagate_anno = sum(1 for r in righe if r.data_scadenza <= today)

        # capitale_residuo_fine_anno: prefer stored value from last row in year
        ultima_rata = righe[-1]
        if ultima_rata.capitale_residuo_dopo is not None:
            cap_fine = ultima_rata.capitale_residuo_dopo
        else:
            cap_fine = cap_map.get(ultima_rata.id)

        result.append(AnalisiAnnualeItem(
            anno=anno,
            quota_capitale=tot_capitale,
            quota_interessi=tot_interessi,
            rata_totale=tot_rata,
            n_rate=n_rate_anno,
            n_pagate=n_pagate_anno,
            capitale_residuo_fine_anno=cap_fine,
        ))

    return result


async def _build_mutuo_out(db: AsyncSession, m: Mutuo) -> MutuoOut:
    today = date.today()

    res = await db.execute(
        select(PianoAmmortamento)
        .where(PianoAmmortamento.mutuo_id == m.id)
        .order_by(PianoAmmortamento.numero_rata)
    )
    rate = res.scalars().all()

    if not rate:
        return MutuoOut(
            id=m.id, nome=m.nome, banca=m.banca,
            numero_contratto=m.numero_contratto,
            immobile_id=m.immobile_id,
            capitale_erogato=m.capitale_erogato,
            capitale_residuo_live=m.capitale_residuo,
            tasso_tipo=m.tasso_tipo or "fisso",
            tasso_valore=m.tasso_valore,
            rata_mensile=m.rata_mensile,
            rate_totali=m.rate_totali,
            rate_pagate_live=m.rate_pagate,
            data_erogazione=m.data_erogazione,
            data_scadenza=m.data_scadenza,
            prossima_scadenza=None, prossima_rata=None,
            interessi_pagati=Decimal("0"), interessi_residui=Decimal("0"),
        )

    rate_pagate = [r for r in rate if r.data_scadenza <= today]
    rate_future = [r for r in rate if r.data_scadenza > today]

    capitale_residuo = m.capitale_erogato - sum(r.quota_capitale for r in rate_pagate)
    interessi_pagati = sum(r.quota_interessi for r in rate_pagate)
    interessi_residui = sum(r.quota_interessi for r in rate_future)

    prossima = rate_future[0] if rate_future else None

    # Sync campi statici se derivati dal piano (evita stale data nel DB)
    n_pagate = len(rate_pagate)
    if m.capitale_residuo != capitale_residuo or m.rate_pagate != n_pagate:
        m.capitale_residuo = capitale_residuo
        m.rate_pagate = n_pagate
        await db.commit()

    return MutuoOut(
        id=m.id, nome=m.nome, banca=m.banca,
        numero_contratto=m.numero_contratto,
        immobile_id=m.immobile_id,
        capitale_erogato=m.capitale_erogato,
        capitale_residuo_live=capitale_residuo,
        tasso_tipo=m.tasso_tipo or "fisso",
        tasso_valore=m.tasso_valore,
        rata_mensile=m.rata_mensile,
        rate_totali=m.rate_totali,
        rate_pagate_live=len(rate_pagate),
        data_erogazione=m.data_erogazione,
        data_scadenza=m.data_scadenza,
        prossima_scadenza=prossima.data_scadenza if prossima else None,
        prossima_rata=prossima.rata_totale if prossima else None,
        interessi_pagati=interessi_pagati,
        interessi_residui=interessi_residui,
    )
