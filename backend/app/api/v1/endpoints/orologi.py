from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List
from decimal import Decimal
from pydantic import BaseModel

from app.db.session import get_db
from app.core.security import get_current_user
from app.models.models import Orologio, OrologioSnapshot

router = APIRouter()


class OrologioOut(BaseModel):
    id: str
    marca: str
    modello: str
    nome: str
    riferimento: str | None
    anno_acquisto: int | None
    stima_min: Decimal
    stima_max: Decimal

    class Config:
        from_attributes = True


@router.get("/", response_model=List[OrologioOut])
async def get_orologi(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(
        select(Orologio).where(
            Orologio.utente_id == current_user.id,
            Orologio.attivo == True,
        )
    )
    orologi = result.scalars().all()
    if not orologi:
        return []

    orologio_ids = [o.id for o in orologi]

    # Latest snapshot per orologio
    subq = (
        select(
            OrologioSnapshot.orologio_id,
            func.max(OrologioSnapshot.id).label("max_id"),
        )
        .where(OrologioSnapshot.orologio_id.in_(orologio_ids))
        .group_by(OrologioSnapshot.orologio_id)
        .subquery()
    )
    snap_result = await db.execute(
        select(OrologioSnapshot).join(
            subq,
            (OrologioSnapshot.orologio_id == subq.c.orologio_id)
            & (OrologioSnapshot.id == subq.c.max_id),
        )
    )
    snapshots = {row.orologio_id: row for row in snap_result.scalars().all()}

    output = []
    for or_ in orologi:
        snap = snapshots.get(or_.id)
        stima_min = snap.stima_min if snap else Decimal("0")
        stima_max = snap.stima_max if snap else Decimal("0")

        output.append(
            OrologioOut(
                id=str(or_.id),
                marca=or_.marca,
                modello=or_.modello,
                nome=f"{or_.marca} {or_.modello}",
                riferimento=or_.riferimento,
                anno_acquisto=or_.anno_acquisto,
                stima_min=stima_min,
                stima_max=stima_max,
            )
        )

    return output
