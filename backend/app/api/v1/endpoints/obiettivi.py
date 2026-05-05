"""
Obiettivi finanziari — CRUD con calcolo automatico del progresso.
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, case, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.core.security import get_current_user
from app.models.models import (
    ObiettivoFinanziario,
    Conto, TipoConto, SaldoSnapshot,
    Posizione, PosizioneSnapshot,
    Mutuo,
    Immobile, ImmobileSnapshot,
    Orologio, OrologioSnapshot,
)

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class ObiettivoCreate(BaseModel):
    nome: str
    descrizione: Optional[str] = None
    tipo: str = "patrimonio_netto"
    target_importo: Optional[float] = None
    target_data: date


class ObiettivoOut(BaseModel):
    id: uuid.UUID
    nome: str
    descrizione: Optional[str]
    tipo: str
    target_importo: Optional[Decimal]
    target_data: date
    attivo: bool
    giorni_rimanenti: int
    progresso_pct: Optional[float]      # 0-100, None se non calcolabile
    valore_attuale: Optional[float]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _valore_corrente(db: AsyncSession, user_id, tipo: str) -> Optional[float]:
    """Calcola il valore attuale dell'indicatore per tipo obiettivo."""

    # Liquidità conti
    conti_r = await db.execute(
        select(Conto).where(Conto.utente_id == user_id, Conto.attivo == True)
    )
    conti = conti_r.scalars().all()
    conto_ids = [c.id for c in conti]

    saldi_map: dict = {}
    if conto_ids:
        subq = (
            select(SaldoSnapshot.conto_id, func.max(SaldoSnapshot.rilevato_at).label("mt"))
            .where(SaldoSnapshot.conto_id.in_(conto_ids))
            .group_by(SaldoSnapshot.conto_id).subquery()
        )
        sr = await db.execute(
            select(SaldoSnapshot).join(
                subq, (SaldoSnapshot.conto_id == subq.c.conto_id)
                & (SaldoSnapshot.rilevato_at == subq.c.mt)
            )
        )
        saldi_map = {r.conto_id: r for r in sr.scalars().all()}

    liquidita = sum(
        float(saldi_map[c.id].saldo) if c.id in saldi_map else 0
        for c in conti if c.tipo in (TipoConto.conto_corrente, TipoConto.deposito)
    )

    # Portafoglio
    pos_r = await db.execute(
        select(Posizione).where(Posizione.utente_id == user_id, Posizione.attivo == True)
    )
    posizioni = pos_r.scalars().all()
    pos_ids = [p.id for p in posizioni]

    portafoglio = 0.0
    if pos_ids:
        subq2 = (
            select(PosizioneSnapshot.posizione_id, func.max(PosizioneSnapshot.id).label("mid"))
            .where(PosizioneSnapshot.posizione_id.in_(pos_ids))
            .group_by(PosizioneSnapshot.posizione_id).subquery()
        )
        psr = await db.execute(
            select(PosizioneSnapshot).join(
                subq2, (PosizioneSnapshot.posizione_id == subq2.c.posizione_id)
                & (PosizioneSnapshot.id == subq2.c.mid)
            )
        )
        snaps = psr.scalars().all()
        portafoglio = sum(float(s.valore_mercato) for s in snaps)

    # Mutui
    mut_r = await db.execute(
        select(func.sum(Mutuo.capitale_residuo)).where(
            Mutuo.utente_id == user_id, Mutuo.attivo == True
        )
    )
    mutui_tot = float(mut_r.scalar() or 0)

    if tipo == "liquidita":
        return liquidita
    if tipo == "portafoglio":
        return portafoglio
    if tipo == "zero_mutui":
        return mutui_tot

    # Per patrimonio_netto aggiunge immobili e orologi
    imm_r = await db.execute(
        select(Immobile).where(Immobile.utente_id == user_id, Immobile.attivo == True)
    )
    immobili = imm_r.scalars().all()
    imm_ids = [i.id for i in immobili]
    immobili_val = 0.0
    if imm_ids:
        subq3 = (
            select(ImmobileSnapshot.immobile_id, func.max(ImmobileSnapshot.id).label("mid"))
            .where(ImmobileSnapshot.immobile_id.in_(imm_ids))
            .group_by(ImmobileSnapshot.immobile_id).subquery()
        )
        isr = await db.execute(
            select(ImmobileSnapshot).join(
                subq3, (ImmobileSnapshot.immobile_id == subq3.c.immobile_id)
                & (ImmobileSnapshot.id == subq3.c.mid)
            )
        )
        immobili_val = sum(float(r.valore_mercato) for r in isr.scalars().all())

    or_r = await db.execute(
        select(Orologio).where(Orologio.utente_id == user_id, Orologio.attivo == True)
    )
    orologi = or_r.scalars().all()
    or_ids = [o.id for o in orologi]
    orologi_val = 0.0
    if or_ids:
        subq4 = (
            select(OrologioSnapshot.orologio_id, func.max(OrologioSnapshot.id).label("mid"))
            .where(OrologioSnapshot.orologio_id.in_(or_ids))
            .group_by(OrologioSnapshot.orologio_id).subquery()
        )
        osr = await db.execute(
            select(OrologioSnapshot).join(
                subq4, (OrologioSnapshot.orologio_id == subq4.c.orologio_id)
                & (OrologioSnapshot.id == subq4.c.mid)
            )
        )
        snaps = osr.scalars().all()
        orologi_val = sum(float((s.stima_min + s.stima_max) / 2) for s in snaps)

    if tipo == "patrimonio_netto":
        return liquidita + portafoglio + immobili_val + orologi_val - mutui_tot
    return None                  # libero: progresso non auto-calcolabile


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[ObiettivoOut])
async def list_obiettivi(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    res = await db.execute(
        select(ObiettivoFinanziario).where(
            ObiettivoFinanziario.utente_id == current_user.id,
            ObiettivoFinanziario.attivo == True,
        ).order_by(ObiettivoFinanziario.target_data)
    )
    obiettivi = res.scalars().all()

    out = []
    for ob in obiettivi:
        giorni = (ob.target_data - date.today()).days
        valore = await _valore_corrente(db, current_user.id, ob.tipo)

        progresso = None
        if valore is not None:
            if ob.tipo == "zero_mutui":
                # target_importo = capitale originale; progresso = % ridotta
                if ob.target_importo and float(ob.target_importo) > 0:
                    progresso = max(0.0, min(100.0, (1 - valore / float(ob.target_importo)) * 100))
                else:
                    # senza riferimento iniziale non calcolabile
                    progresso = None
            elif ob.target_importo and float(ob.target_importo) != 0:
                progresso = min(100.0, max(0.0, (valore / float(ob.target_importo)) * 100))

        out.append(ObiettivoOut(
            id=ob.id, nome=ob.nome, descrizione=ob.descrizione,
            tipo=ob.tipo, target_importo=ob.target_importo,
            target_data=ob.target_data, attivo=ob.attivo,
            giorni_rimanenti=giorni,
            progresso_pct=round(progresso, 1) if progresso is not None else None,
            valore_attuale=round(valore, 2) if valore is not None else None,
            created_at=ob.created_at,
        ))
    return out


@router.post("/", response_model=ObiettivoOut, status_code=status.HTTP_201_CREATED)
async def create_obiettivo(
    body: ObiettivoCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    ob = ObiettivoFinanziario(
        utente_id=current_user.id,
        nome=body.nome,
        descrizione=body.descrizione,
        tipo=body.tipo,
        target_importo=Decimal(str(body.target_importo)) if body.target_importo else None,
        target_data=body.target_data,
    )
    db.add(ob)
    await db.commit()
    await db.refresh(ob)

    giorni = (ob.target_data - date.today()).days
    valore = await _valore_corrente(db, current_user.id, ob.tipo)
    progresso = None
    if valore is not None:
        if ob.tipo == "zero_mutui":
            if ob.target_importo and float(ob.target_importo) > 0:
                progresso = max(0.0, min(100.0, (1 - valore / float(ob.target_importo)) * 100))
        elif ob.target_importo and float(ob.target_importo) != 0:
            progresso = min(100.0, max(0.0, (valore / float(ob.target_importo)) * 100))

    return ObiettivoOut(
        id=ob.id, nome=ob.nome, descrizione=ob.descrizione,
        tipo=ob.tipo, target_importo=ob.target_importo,
        target_data=ob.target_data, attivo=ob.attivo,
        giorni_rimanenti=giorni, progresso_pct=progresso,
        valore_attuale=valore, created_at=ob.created_at,
    )


@router.delete("/{ob_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_obiettivo(
    ob_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    res = await db.execute(
        select(ObiettivoFinanziario).where(
            ObiettivoFinanziario.id == ob_id,
            ObiettivoFinanziario.utente_id == current_user.id,
        )
    )
    ob = res.scalar_one_or_none()
    if not ob:
        raise HTTPException(404, "Obiettivo non trovato")
    ob.attivo = False
    await db.commit()
