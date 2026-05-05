from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List
from decimal import Decimal
from datetime import date
from pydantic import BaseModel
import uuid

from app.db.session import get_db
from app.core.security import get_current_user
from app.models.models import Immobile, ImmobileSnapshot, Mutuo

router = APIRouter()


class ImmobileOut(BaseModel):
    id: str
    nome: str
    descrizione: str | None
    indirizzo: str | None
    tipo: str
    valore_corrente: Decimal
    mutuo_residuo: Decimal
    banca_mutuo: str | None
    rata_mensile: Decimal
    data_scadenza_mutuo: str | None

    class Config:
        from_attributes = True


@router.get("/", response_model=List[ImmobileOut])
async def get_immobili(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    # Fetch active immobili for user
    result = await db.execute(
        select(Immobile).where(
            Immobile.utente_id == current_user.id,
            Immobile.attivo == True,
        )
    )
    immobili = result.scalars().all()
    if not immobili:
        return []

    immobile_ids = [i.id for i in immobili]

    # Latest snapshot per immobile
    subq = (
        select(
            ImmobileSnapshot.immobile_id,
            func.max(ImmobileSnapshot.id).label("max_id"),
        )
        .where(ImmobileSnapshot.immobile_id.in_(immobile_ids))
        .group_by(ImmobileSnapshot.immobile_id)
        .subquery()
    )
    snap_result = await db.execute(
        select(ImmobileSnapshot).join(
            subq,
            (ImmobileSnapshot.immobile_id == subq.c.immobile_id)
            & (ImmobileSnapshot.id == subq.c.max_id),
        )
    )
    snapshots = {row.immobile_id: row for row in snap_result.scalars().all()}

    # Mutui linked to these immobili
    mutuo_result = await db.execute(
        select(Mutuo).where(
            Mutuo.immobile_id.in_(immobile_ids),
            Mutuo.attivo == True,
        )
    )
    mutui_by_immobile: dict[uuid.UUID, list[Mutuo]] = {}
    for m in mutuo_result.scalars().all():
        mutui_by_immobile.setdefault(m.immobile_id, []).append(m)

    output = []
    for im in immobili:
        snap = snapshots.get(im.id)
        valore_corrente = snap.valore_mercato if snap else Decimal("0")

        mutui = mutui_by_immobile.get(im.id, [])
        mutuo_residuo = sum((m.capitale_residuo for m in mutui), Decimal("0"))
        rata_mensile = sum((m.rata_mensile for m in mutui), Decimal("0"))
        banca_mutuo = mutui[0].banca if mutui else None
        data_scad = str(mutui[0].data_scadenza) if mutui else None

        output.append(
            ImmobileOut(
                id=str(im.id),
                nome=im.nome,
                descrizione=im.descrizione,
                indirizzo=im.indirizzo,
                tipo=im.tipo,
                valore_corrente=valore_corrente,
                mutuo_residuo=mutuo_residuo,
                banca_mutuo=banca_mutuo,
                rata_mensile=rata_mensile,
                data_scadenza_mutuo=data_scad,
            )
        )

    return output
