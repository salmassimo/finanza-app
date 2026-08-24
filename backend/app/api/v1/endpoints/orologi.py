from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Optional
from decimal import Decimal
from datetime import datetime
from pydantic import BaseModel
import uuid

from app.db.session import get_db
from app.core.security import get_current_user
from app.models.models import Orologio, OrologioSnapshot

router = APIRouter()


class OrologioCreate(BaseModel):
    marca: str
    modello: str
    riferimento: Optional[str] = None
    materiale_cassa: Optional[str] = None
    quadrante: Optional[str] = None
    diametro: Optional[str] = None
    materiale_lunetta: Optional[str] = None
    vetro: Optional[str] = None
    carica: Optional[str] = None
    riserva_carica: Optional[str] = None
    funzioni: Optional[str] = None
    anno_acquisto: Optional[int] = None
    prezzo_acquisto: Optional[float] = None
    stima_min: Optional[float] = None   # se fornita, salta la valutazione AI
    stima_max: Optional[float] = None


@router.post("/")
async def create_orologio(
    body: OrologioCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Aggiunge un orologio e ne stima il valore di mercato usato via AI."""
    import json
    from app.api.v1.endpoints.advisor import _call_claude

    specs_parts = [
        f"Marca/Modello: {body.marca} {body.modello}",
        f"Referenza: {body.riferimento}" if body.riferimento else "",
        f"Cassa: {body.materiale_cassa}" if body.materiale_cassa else "",
        f"Lunetta: {body.materiale_lunetta}" if body.materiale_lunetta else "",
        f"Quadrante: {body.quadrante}" if body.quadrante else "",
        f"Diametro: {body.diametro}" if body.diametro else "",
        f"Vetro: {body.vetro}" if body.vetro else "",
        f"Carica: {body.carica}" if body.carica else "",
        f"Riserva: {body.riserva_carica}" if body.riserva_carica else "",
        f"Funzioni: {body.funzioni}" if body.funzioni else "",
    ]
    specs = " · ".join(p for p in specs_parts if p)

    stima_min = stima_max = None
    val_note = None
    fonte = "AI"

    if body.stima_min is not None and body.stima_max is not None:
        # Stima fornita manualmente (perizia) → nessuna chiamata AI
        stima_min = Decimal(str(body.stima_min))
        stima_max = Decimal(str(body.stima_max))
        fonte = "perizia"
    else:
        try:
            prompt = (
                "Sei un perito di orologi di lusso. Stima il valore di mercato dell'USATO in EUR "
                "(prezzi attuali del second-hand europeo, condizioni buone, full set non garantito) "
                "per questo orologio. Rispondi SOLO con JSON valido:\n"
                '{"stima_min": <float EUR>, "stima_max": <float EUR>, "note": "<1 frase sul posizionamento di mercato>"}\n\n'
                f"Orologio: {specs}"
            )
            raw = await _call_claude(system="Rispondi solo con JSON valido.", messages=[{"role": "user", "content": prompt}], max_tokens=300)
            if "```" in raw:
                raw = raw.split("```")[1].replace("json", "", 1)
            d = json.loads(raw.strip())
            stima_min = Decimal(str(d.get("stima_min")))
            stima_max = Decimal(str(d.get("stima_max")))
            val_note = d.get("note")
        except Exception:
            raise HTTPException(502, "Valutazione AI non disponibile (credito Anthropic esaurito?). Inserisci una stima manuale.")

    o = Orologio(
        utente_id=current_user.id, marca=body.marca, modello=body.modello,
        riferimento=body.riferimento, anno_acquisto=body.anno_acquisto,
        prezzo_acquisto=Decimal(str(body.prezzo_acquisto)) if body.prezzo_acquisto else None,
        note=specs,
    )
    db.add(o)
    await db.flush()
    db.add(OrologioSnapshot(
        orologio_id=o.id, stima_min=stima_min, stima_max=stima_max,
        fonte=fonte, rilevato_at=datetime.utcnow(), note=val_note,
    ))
    await db.commit()
    return {
        "id": str(o.id), "marca": o.marca, "modello": o.modello,
        "stima_min": float(stima_min), "stima_max": float(stima_max),
        "valore_medio": float((stima_min + stima_max) / 2), "note": val_note,
    }


@router.delete("/{orologio_id}")
async def delete_orologio(orologio_id: uuid.UUID, db: AsyncSession = Depends(get_db), current_user=Depends(get_current_user)):
    o = await db.get(Orologio, orologio_id)
    if not o or o.utente_id != current_user.id:
        raise HTTPException(404, "Orologio non trovato")
    o.attivo = False
    await db.commit()
    return {"ok": True}


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
