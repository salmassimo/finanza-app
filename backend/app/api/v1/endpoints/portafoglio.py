from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload
from typing import List
from uuid import UUID
from app.db.session import get_db
from app.core.security import get_current_user
from app.models.models import Posizione, Strumento, PosizioneSnapshot, PrezzoSnapshot
from app.services.prezzi import aggiorna_tutti_i_prezzi, backfill_prezzi_storici
from pydantic import BaseModel
from decimal import Decimal
from datetime import datetime, date

router = APIRouter()


class StoricoPortafoglioItem(BaseModel):
    data: date
    valore_mercato: Decimal
    var_eur: Decimal

class PosizioneOut(BaseModel):
    id: UUID
    simbolo: str
    nome: str
    tipo: str
    piattaforma: str
    quantita: Decimal
    prezzo_carico: Decimal
    valore_carico: Decimal
    prezzo_mercato: Decimal | None = None
    valore_mercato: Decimal | None = None
    var_eur: Decimal | None = None
    var_pct: Decimal | None = None
    aggiornato_al: datetime | None = None

    class Config:
        from_attributes = True

class StoricoItem(BaseModel):
    data: datetime
    valore_mercato: Decimal
    var_eur: Decimal
    var_pct: Decimal

@router.get("/", response_model=List[PosizioneOut])
async def get_portafoglio(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Restituisce il portafoglio corrente con l'ultimo prezzo disponibile."""
    result = await db.execute(
        select(Posizione)
        .options(selectinload(Posizione.strumento))
        .join(Strumento)
        .where(Posizione.utente_id == current_user.id, Posizione.attivo == True)
    )
    posizioni = result.scalars().all()

    output = []
    for pos in posizioni:
        # Ultimo snapshot
        snap_result = await db.execute(
            select(PosizioneSnapshot)
            .where(PosizioneSnapshot.posizione_id == pos.id)
            .order_by(PosizioneSnapshot.rilevato_at.desc())
            .limit(1)
        )
        snap = snap_result.scalar_one_or_none()

        output.append(PosizioneOut(
            id=pos.id,
            simbolo=pos.strumento.simbolo,
            nome=pos.strumento.nome,
            tipo=pos.strumento.tipo.value,
            piattaforma=pos.piattaforma.value,
            quantita=pos.quantita,
            prezzo_carico=pos.prezzo_carico,
            valore_carico=pos.valore_carico,
            prezzo_mercato=snap.prezzo_mercato if snap else None,
            valore_mercato=snap.valore_mercato if snap else None,
            var_eur=snap.var_eur if snap else None,
            var_pct=snap.var_pct if snap else None,
            aggiornato_al=snap.rilevato_at if snap else None,
        ))

    return output

@router.get("/{posizione_id}/storico", response_model=List[StoricoItem])
async def get_storico_posizione(
    posizione_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Serie storica del valore di una posizione nel tempo."""
    # Verifica ownership
    pos = await db.get(Posizione, posizione_id)
    if not pos or pos.utente_id != current_user.id:
        raise HTTPException(status_code=404, detail="Posizione non trovata")

    result = await db.execute(
        select(PosizioneSnapshot)
        .where(PosizioneSnapshot.posizione_id == posizione_id)
        .order_by(PosizioneSnapshot.rilevato_at.asc())
    )
    snapshots = result.scalars().all()

    return [StoricoItem(
        data=s.rilevato_at,
        valore_mercato=s.valore_mercato,
        var_eur=s.var_eur,
        var_pct=s.var_pct
    ) for s in snapshots]

class PrezzoManualeIn(BaseModel):
    prezzo: Decimal


@router.post("/{posizione_id}/prezzo-manuale")
async def set_prezzo_manuale(
    posizione_id: UUID,
    body: PrezzoManualeIn,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Imposta manualmente il prezzo di una posizione (es. titoli non quotati come
    SpaceX). Crea uno snapshot 'manuale' che 'aggiorna prezzi' non sovrascrive.
    """
    pos = await db.get(Posizione, posizione_id)
    if not pos or pos.utente_id != current_user.id:
        raise HTTPException(404, "Posizione non trovata")

    prezzo = body.prezzo
    if prezzo <= 0:
        raise HTTPException(400, "Prezzo non valido")

    now = datetime.utcnow()
    valore_mercato = prezzo * pos.quantita
    var_eur = valore_mercato - pos.valore_carico
    var_pct = (var_eur / pos.valore_carico * 100) if pos.valore_carico else Decimal("0")

    db.add(PrezzoSnapshot(
        strumento_id=pos.strumento_id, prezzo=prezzo, valuta="EUR",
        fonte="manuale", rilevato_at=now,
    ))
    db.add(PosizioneSnapshot(
        posizione_id=pos.id, quantita=pos.quantita, prezzo_mercato=prezzo,
        valore_mercato=valore_mercato, var_eur=var_eur, var_pct=var_pct, rilevato_at=now,
    ))
    await db.commit()
    return {
        "ok": True,
        "prezzo": str(prezzo),
        "valore_mercato": str(valore_mercato),
        "var_eur": str(var_eur),
    }


@router.post("/aggiorna-prezzi")
async def aggiorna_prezzi(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Aggiorna i prezzi di mercato di tutti gli strumenti in portafoglio."""
    result = await aggiorna_tutti_i_prezzi(db, str(current_user.id))
    return result


@router.get("/storico-portafoglio", response_model=List[StoricoPortafoglioItem])
async def get_storico_portafoglio(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """
    Serie storica del valore totale del portafoglio.
    Per ogni giorno restituisce la somma dell'ultimo snapshot per ciascuna posizione.
    """
    sql = text("""
        WITH ranked AS (
            SELECT
                ps.posizione_id,
                DATE(ps.rilevato_at) AS data,
                ps.valore_mercato,
                ps.var_eur,
                ROW_NUMBER() OVER (
                    PARTITION BY ps.posizione_id, DATE(ps.rilevato_at)
                    ORDER BY ps.rilevato_at DESC
                ) AS rn
            FROM posizioni_snapshot ps
            JOIN posizioni p ON p.id = ps.posizione_id
            WHERE p.utente_id = :uid
        ),
        tot_posizioni AS (
            SELECT COUNT(*) AS tot
            FROM posizioni
            WHERE utente_id = :uid AND attivo = TRUE
        ),
        daily AS (
            SELECT
                data,
                SUM(valore_mercato)          AS valore_mercato,
                SUM(var_eur)                 AS var_eur,
                COUNT(DISTINCT posizione_id) AS n_pos
            FROM ranked
            WHERE rn = 1
            GROUP BY data
        )
        SELECT d.data, d.valore_mercato, d.var_eur
        FROM daily d, tot_posizioni t
        WHERE d.n_pos >= GREATEST(1, ROUND(t.tot * 0.5))
        ORDER BY data ASC
    """)
    result = await db.execute(sql, {"uid": str(current_user.id)})
    return [
        StoricoPortafoglioItem(data=r.data, valore_mercato=r.valore_mercato, var_eur=r.var_eur)
        for r in result.fetchall()
    ]


@router.post("/backfill-prezzi")
async def backfill_prezzi(
    range: str = "1y",
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """
    Recupera e salva la serie storica prezzi per tutte le posizioni.
    range: '6mo' | '1y' | '2y'
    """
    result = await backfill_prezzi_storici(db, str(current_user.id), range_str=range)
    return result


@router.get("/ultimo-aggiornamento")
async def get_ultimo_aggiornamento(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Restituisce la data dell'ultimo aggiornamento prezzi per questo utente."""
    sql = text("""
        SELECT MAX(ps.rilevato_at) AS ultimo
        FROM posizioni_snapshot ps
        JOIN posizioni p ON p.id = ps.posizione_id
        WHERE p.utente_id = :uid
    """)
    result = await db.execute(sql, {"uid": str(current_user.id)})
    row = result.fetchone()
    return {"ultimo_aggiornamento": row.ultimo.isoformat() if row and row.ultimo else None}
