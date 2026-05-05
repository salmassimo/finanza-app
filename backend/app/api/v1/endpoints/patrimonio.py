from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from typing import List
from app.db.session import get_db
from app.core.security import get_current_user
from app.models.models import (
    Conto, TipoConto, SaldoSnapshot,
    Posizione, PiattaformaEnum, PosizioneSnapshot,
    Immobile, ImmobileSnapshot,
    Orologio, OrologioSnapshot,
    Mutuo, PianoAmmortamento,
    Movimento, TipoMovimento,
    PatrimonioSnapshot,
)
from pydantic import BaseModel
from decimal import Decimal
from datetime import date, datetime
from calendar import monthrange

router = APIRouter()


# ── RESPONSE MODELS ────────────────────────────────────────────────────────────

class PatrimonioLiveOut(BaseModel):
    # Liquidità
    saldo_conto_corrente: Decimal
    saldo_deposito: Decimal
    debito_carta: Decimal
    liquidita_effettiva: Decimal
    # Investimenti
    portafoglio_fineco: Decimal
    portafoglio_revolut: Decimal
    portafoglio_totale: Decimal
    # Immobili
    immobili_valore: Decimal
    # Beni
    orologi_valore: Decimal
    # Totali
    totale_asset: Decimal
    totale_mutui: Decimal
    totale_passivo: Decimal
    patrimonio_netto: Decimal
    # Dettaglio mutui
    mutui: list[dict]  # [{"nome": str, "residuo": Decimal, "rata": Decimal}]
    # Timestamp
    calcolato_at: str  # datetime.utcnow().isoformat()


class PatrimonioOut(BaseModel):
    liquidita_totale: Decimal
    portafoglio_fineco: Decimal
    portafoglio_revolut: Decimal
    immobili_valore: Decimal
    orologi_valore: Decimal
    totale_asset: Decimal
    mutuo_uc_residuo: Decimal
    mutuo_ca_residuo: Decimal
    totale_passivo: Decimal
    patrimonio_netto: Decimal
    rilevato_at: datetime

    class Config:
        from_attributes = True


# ── HELPER: get latest snapshot id per entity ──────────────────────────────────

async def _latest_saldo_per_conto(db: AsyncSession, conto_ids: list) -> dict:
    """Returns {conto_id: SaldoSnapshot} for the latest snapshot per conto."""
    if not conto_ids:
        return {}
    # Subquery: max id per conto_id (id is autoincrement so max == latest)
    subq = (
        select(
            SaldoSnapshot.conto_id,
            func.max(SaldoSnapshot.id).label("max_id"),
        )
        .where(SaldoSnapshot.conto_id.in_(conto_ids))
        .group_by(SaldoSnapshot.conto_id)
        .subquery()
    )
    result = await db.execute(
        select(SaldoSnapshot).join(
            subq,
            (SaldoSnapshot.conto_id == subq.c.conto_id)
            & (SaldoSnapshot.id == subq.c.max_id),
        )
    )
    rows = result.scalars().all()
    return {row.conto_id: row for row in rows}


async def _latest_posizione_snapshot(db: AsyncSession, posizione_ids: list) -> dict:
    """Returns {posizione_id: PosizioneSnapshot} for the latest snapshot per posizione."""
    if not posizione_ids:
        return {}
    subq = (
        select(
            PosizioneSnapshot.posizione_id,
            func.max(PosizioneSnapshot.id).label("max_id"),
        )
        .where(PosizioneSnapshot.posizione_id.in_(posizione_ids))
        .group_by(PosizioneSnapshot.posizione_id)
        .subquery()
    )
    result = await db.execute(
        select(PosizioneSnapshot).join(
            subq,
            (PosizioneSnapshot.posizione_id == subq.c.posizione_id)
            & (PosizioneSnapshot.id == subq.c.max_id),
        )
    )
    rows = result.scalars().all()
    return {row.posizione_id: row for row in rows}


async def _latest_immobile_snapshot(db: AsyncSession, immobile_ids: list) -> dict:
    """Returns {immobile_id: ImmobileSnapshot} for the latest snapshot per immobile."""
    if not immobile_ids:
        return {}
    subq = (
        select(
            ImmobileSnapshot.immobile_id,
            func.max(ImmobileSnapshot.id).label("max_id"),
        )
        .where(ImmobileSnapshot.immobile_id.in_(immobile_ids))
        .group_by(ImmobileSnapshot.immobile_id)
        .subquery()
    )
    result = await db.execute(
        select(ImmobileSnapshot).join(
            subq,
            (ImmobileSnapshot.immobile_id == subq.c.immobile_id)
            & (ImmobileSnapshot.id == subq.c.max_id),
        )
    )
    rows = result.scalars().all()
    return {row.immobile_id: row for row in rows}


async def _latest_orologio_snapshot(db: AsyncSession, orologio_ids: list) -> dict:
    """Returns {orologio_id: OrologioSnapshot} for the latest snapshot per orologio."""
    if not orologio_ids:
        return {}
    subq = (
        select(
            OrologioSnapshot.orologio_id,
            func.max(OrologioSnapshot.id).label("max_id"),
        )
        .where(OrologioSnapshot.orologio_id.in_(orologio_ids))
        .group_by(OrologioSnapshot.orologio_id)
        .subquery()
    )
    result = await db.execute(
        select(OrologioSnapshot).join(
            subq,
            (OrologioSnapshot.orologio_id == subq.c.orologio_id)
            & (OrologioSnapshot.id == subq.c.max_id),
        )
    )
    rows = result.scalars().all()
    return {row.orologio_id: row for row in rows}


# ── LIVE CALCULATION ───────────────────────────────────────────────────────────

@router.get("/corrente", response_model=PatrimonioLiveOut)
async def get_patrimonio_corrente(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Calcola il patrimonio netto in tempo reale da tutte le fonti dati."""

    today = date.today()
    year, month = today.year, today.month
    _, last_day = monthrange(year, month)
    month_start = date(year, month, 1)
    month_end = date(year, month, last_day)

    # ── 1. CONTI: saldo corrente ──────────────────────────────────────────────
    conti_result = await db.execute(
        select(Conto).where(
            Conto.utente_id == current_user.id,
            Conto.attivo == True,
            Conto.tipo.in_([TipoConto.conto_corrente, TipoConto.deposito]),
        )
    )
    conti = conti_result.scalars().all()
    conto_ids = [c.id for c in conti]
    conto_cc_ids = [c.id for c in conti if c.tipo == TipoConto.conto_corrente]

    saldi_map = await _latest_saldo_per_conto(db, conto_ids)

    conto_tipo_map = {c.id: c.tipo for c in conti}
    saldo_conto_corrente = Decimal(0)
    saldo_deposito = Decimal(0)
    for cid, snap in saldi_map.items():
        if conto_tipo_map.get(cid) == TipoConto.conto_corrente:
            saldo_conto_corrente += snap.saldo
        elif conto_tipo_map.get(cid) == TipoConto.deposito:
            saldo_deposito += snap.saldo

    # ── 2. DEBITO CARTA CORRENTE ──────────────────────────────────────────────
    movimenti_result = await db.execute(
        select(Movimento).where(
            Movimento.utente_id == current_user.id,
            Movimento.is_carta_credito == True,
            Movimento.tipo == TipoMovimento.uscita,
            Movimento.data_operazione >= month_start,
            Movimento.data_operazione <= month_end,
        )
    )
    movimenti_carta = movimenti_result.scalars().all()
    debito_carta = sum((abs(m.importo) for m in movimenti_carta), Decimal(0))

    liquidita_effettiva = saldo_conto_corrente + saldo_deposito - debito_carta

    # ── 3. PORTAFOGLIO FINECO ─────────────────────────────────────────────────
    pos_fineco_result = await db.execute(
        select(Posizione).where(
            Posizione.utente_id == current_user.id,
            Posizione.attivo == True,
            Posizione.piattaforma == PiattaformaEnum.fineco,
        )
    )
    pos_fineco = pos_fineco_result.scalars().all()
    snap_fineco = await _latest_posizione_snapshot(db, [p.id for p in pos_fineco])
    portafoglio_fineco = sum(
        (s.valore_mercato for s in snap_fineco.values()), Decimal(0)
    )

    # ── 4. PORTAFOGLIO REVOLUT ────────────────────────────────────────────────
    pos_revolut_result = await db.execute(
        select(Posizione).where(
            Posizione.utente_id == current_user.id,
            Posizione.attivo == True,
            Posizione.piattaforma == PiattaformaEnum.revolut_investimenti,
        )
    )
    pos_revolut = pos_revolut_result.scalars().all()
    snap_revolut = await _latest_posizione_snapshot(db, [p.id for p in pos_revolut])
    portafoglio_revolut = sum(
        (s.valore_mercato for s in snap_revolut.values()), Decimal(0)
    )

    portafoglio_totale = portafoglio_fineco + portafoglio_revolut

    # ── 5. IMMOBILI ───────────────────────────────────────────────────────────
    immobili_result = await db.execute(
        select(Immobile).where(
            Immobile.utente_id == current_user.id,
            Immobile.attivo == True,
        )
    )
    immobili = immobili_result.scalars().all()
    snap_immobili = await _latest_immobile_snapshot(db, [i.id for i in immobili])
    immobili_valore = sum(
        (s.valore_mercato for s in snap_immobili.values()), Decimal(0)
    )

    # ── 6. OROLOGI ────────────────────────────────────────────────────────────
    orologi_result = await db.execute(
        select(Orologio).where(
            Orologio.utente_id == current_user.id,
            Orologio.attivo == True,
        )
    )
    orologi = orologi_result.scalars().all()
    snap_orologi = await _latest_orologio_snapshot(db, [o.id for o in orologi])
    orologi_valore = sum(
        ((s.stima_min + s.stima_max) / Decimal(2) for s in snap_orologi.values()),
        Decimal(0),
    )

    # ── 7. MUTUI ──────────────────────────────────────────────────────────────
    mutui_result = await db.execute(
        select(Mutuo).where(
            Mutuo.utente_id == current_user.id,
            Mutuo.attivo == True,
        )
    )
    mutui = mutui_result.scalars().all()

    mutui_dettaglio = []
    totale_mutui = Decimal(0)

    for mutuo in mutui:
        # Sum quota_capitale for paid instalments up to today
        piano_result = await db.execute(
            select(func.coalesce(func.sum(PianoAmmortamento.quota_capitale), 0)).where(
                PianoAmmortamento.mutuo_id == mutuo.id,
                PianoAmmortamento.data_scadenza <= today,
            )
        )
        quota_capitale_pagata = piano_result.scalar() or Decimal(0)
        capitale_residuo_live = mutuo.capitale_erogato - Decimal(str(quota_capitale_pagata))

        # Sync campo statico se deviato
        if mutuo.capitale_residuo != capitale_residuo_live:
            mutuo.capitale_residuo = capitale_residuo_live

        totale_mutui += capitale_residuo_live
        mutui_dettaglio.append(
            {
                "nome": mutuo.nome,
                "residuo": capitale_residuo_live,
                "rata": mutuo.rata_mensile,
            }
        )

    # Persisti eventuali sync dei campi statici mutui
    await db.commit()

    # ── 8. TOTALI ─────────────────────────────────────────────────────────────
    totale_asset = liquidita_effettiva + portafoglio_totale + immobili_valore + orologi_valore
    totale_passivo = totale_mutui
    patrimonio_netto = totale_asset - totale_passivo

    return PatrimonioLiveOut(
        saldo_conto_corrente=saldo_conto_corrente,
        saldo_deposito=saldo_deposito,
        debito_carta=debito_carta,
        liquidita_effettiva=liquidita_effettiva,
        portafoglio_fineco=portafoglio_fineco,
        portafoglio_revolut=portafoglio_revolut,
        portafoglio_totale=portafoglio_totale,
        immobili_valore=immobili_valore,
        orologi_valore=orologi_valore,
        totale_asset=totale_asset,
        totale_mutui=totale_mutui,
        totale_passivo=totale_passivo,
        patrimonio_netto=patrimonio_netto,
        mutui=mutui_dettaglio,
        calcolato_at=datetime.utcnow().isoformat(),
    )


# ── STORICO (backward compat) ─────────────────────────────────────────────────

@router.get("/storico", response_model=List[PatrimonioOut])
async def get_storico_patrimonio(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Serie storica del patrimonio netto — base per il grafico temporale."""
    result = await db.execute(
        select(PatrimonioSnapshot)
        .where(PatrimonioSnapshot.utente_id == current_user.id)
        .order_by(PatrimonioSnapshot.rilevato_at.asc())
    )
    return result.scalars().all()


# ── STORICO MENSILE CALCOLATO ─────────────────────────────────────────────────

@router.get("/storico-mensile")
async def get_storico_mensile(
    mesi: int = Query(13, ge=3, le=24),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Ricostruisce il patrimonio netto mese per mese partendo dai dati reali:
    - Liquidità: backward reconstruction dai movimenti CC/deposito
    - Portafoglio: snapshot PosizioneSnapshot più recente per ogni mese
    - Immobili / Orologi: valore corrente (invariante, nessuno storico snapshot)
    - Mutui: residuo calcolato dal piano ammortamento per ogni mese
    """
    today = date.today()

    # ── 1. Conti CC + deposito ────────────────────────────────────────────────
    conti_res = await db.execute(
        select(Conto).where(
            Conto.utente_id == current_user.id,
            Conto.attivo == True,
            Conto.tipo.in_([TipoConto.conto_corrente, TipoConto.deposito]),
        )
    )
    conti = conti_res.scalars().all()
    conto_ids = [c.id for c in conti]

    saldo_totale_corrente = Decimal(0)
    for c in conti:
        s = await db.execute(
            select(SaldoSnapshot.saldo)
            .where(SaldoSnapshot.conto_id == c.id)
            .order_by(SaldoSnapshot.rilevato_at.desc())
            .limit(1)
        )
        v = s.scalar_one_or_none()
        saldo_totale_corrente += v or Decimal(0)

    # ── 2. Flussi netti mensili (entrate − uscite) per CC/deposito ────────────
    mese_col = func.to_char(Movimento.data_operazione, "YYYY-MM").label("mese")
    mov_res = await db.execute(
        select(
            mese_col,
            func.coalesce(
                func.sum(case((Movimento.tipo == TipoMovimento.entrata, Movimento.importo), else_=0)), 0
            ).label("entrate"),
            func.coalesce(
                func.sum(case((Movimento.tipo == TipoMovimento.uscita, Movimento.importo), else_=0)), 0
            ).label("uscite"),
        )
        .where(
            Movimento.utente_id == current_user.id,
            Movimento.conto_id.in_(conto_ids),
            Movimento.is_carta_credito == False,
        )
        .group_by(mese_col)
        .order_by(mese_col)
    )
    flussi: dict[str, Decimal] = {
        r.mese: Decimal(str(r.entrate)) - Decimal(str(r.uscite))
        for r in mov_res.fetchall()
    }

    # ── 3. Portafoglio: snapshot per mese ─────────────────────────────────────
    pos_res = await db.execute(
        select(Posizione).where(
            Posizione.utente_id == current_user.id,
            Posizione.attivo == True,
        )
    )
    posizioni = pos_res.scalars().all()
    pos_ids = [p.id for p in posizioni]

    # Portafoglio corrente
    port_corrente = Decimal(0)
    if pos_ids:
        subq_p = (
            select(PosizioneSnapshot.posizione_id, func.max(PosizioneSnapshot.id).label("mid"))
            .where(PosizioneSnapshot.posizione_id.in_(pos_ids))
            .group_by(PosizioneSnapshot.posizione_id).subquery()
        )
        psr = await db.execute(
            select(PosizioneSnapshot).join(
                subq_p, (PosizioneSnapshot.posizione_id == subq_p.c.posizione_id)
                & (PosizioneSnapshot.id == subq_p.c.mid)
            )
        )
        port_corrente = sum(s.valore_mercato for s in psr.scalars().all()) or Decimal(0)

    # Mappa mese → valore portafoglio (prende lo snapshot rilevato_at più recente ≤ fine mese)
    port_per_mese: dict[str, Decimal] = {}
    if pos_ids:
        all_snaps_res = await db.execute(
            select(PosizioneSnapshot)
            .where(PosizioneSnapshot.posizione_id.in_(pos_ids))
            .order_by(PosizioneSnapshot.rilevato_at)
        )
        all_snaps = all_snaps_res.scalars().all()
        # Raggruppa per mese: somma gli ultimi snapshot per posizione entro quel mese
        from collections import defaultdict
        snap_by_month: dict[str, dict] = defaultdict(dict)
        for s in all_snaps:
            m_key = s.rilevato_at.strftime("%Y-%m")
            snap_by_month[m_key][s.posizione_id] = s.valore_mercato
        # Running aggregation: mantieni ultimo valore noto per ogni posizione
        running: dict = {}
        for m_key in sorted(snap_by_month):
            running.update(snap_by_month[m_key])
            port_per_mese[m_key] = sum(running.values())

    # ── 4. Immobili + Orologi (valori correnti) ───────────────────────────────
    imm_res = await db.execute(
        select(Immobile).where(Immobile.utente_id == current_user.id, Immobile.attivo == True)
    )
    immobili = imm_res.scalars().all()
    imm_ids = [i.id for i in immobili]
    immobili_val = Decimal(0)
    if imm_ids:
        subq_i = (
            select(ImmobileSnapshot.immobile_id, func.max(ImmobileSnapshot.id).label("mid"))
            .where(ImmobileSnapshot.immobile_id.in_(imm_ids))
            .group_by(ImmobileSnapshot.immobile_id).subquery()
        )
        isr = await db.execute(
            select(ImmobileSnapshot).join(
                subq_i, (ImmobileSnapshot.immobile_id == subq_i.c.immobile_id)
                & (ImmobileSnapshot.id == subq_i.c.mid)
            )
        )
        immobili_val = sum(s.valore_mercato for s in isr.scalars().all()) or Decimal(0)

    or_res = await db.execute(
        select(Orologio).where(Orologio.utente_id == current_user.id, Orologio.attivo == True)
    )
    orologi = or_res.scalars().all()
    or_ids = [o.id for o in orologi]
    orologi_val = Decimal(0)
    if or_ids:
        subq_o = (
            select(OrologioSnapshot.orologio_id, func.max(OrologioSnapshot.id).label("mid"))
            .where(OrologioSnapshot.orologio_id.in_(or_ids))
            .group_by(OrologioSnapshot.orologio_id).subquery()
        )
        osr = await db.execute(
            select(OrologioSnapshot).join(
                subq_o, (OrologioSnapshot.orologio_id == subq_o.c.orologio_id)
                & (OrologioSnapshot.id == subq_o.c.mid)
            )
        )
        orologi_val = sum(
            (s.stima_min + s.stima_max) / Decimal(2) for s in osr.scalars().all()
        ) or Decimal(0)

    asset_fissi = immobili_val + orologi_val  # costanti nel tempo

    # ── 5. Mutui: residuo storico per data ────────────────────────────────────
    mutui_res = await db.execute(
        select(Mutuo).where(Mutuo.utente_id == current_user.id, Mutuo.attivo == True)
    )
    mutui = mutui_res.scalars().all()

    async def _residuo_mutui_al(target: date) -> Decimal:
        totale = Decimal(0)
        for m in mutui:
            # residuo = capitale_erogato - quota_capitale già scaduta entro target
            pagato_res = await db.execute(
                select(func.coalesce(func.sum(PianoAmmortamento.quota_capitale), 0))
                .where(
                    PianoAmmortamento.mutuo_id == m.id,
                    PianoAmmortamento.data_scadenza <= target,
                )
            )
            pagato = Decimal(str(pagato_res.scalar() or 0))
            totale += m.capitale_erogato - pagato
        return totale

    # ── 6. Costruisci lista mesi (dal più vecchio al più recente) ─────────────
    month_keys: list[str] = []
    for i in range(mesi - 1, -1, -1):
        m_off = today.month - i
        y = today.year + (m_off - 1) // 12
        m = ((m_off - 1) % 12) + 1
        month_keys.append(f"{y}-{m:02d}")

    # ── 7. Saldo liquidità per ogni mese (backward reconstruction) ────────────
    # saldo_at_fine_mese(M) = saldo_corrente − Σ flussi_netti(m > M)
    saldo_per_mese: dict[str, Decimal] = {}
    cumulative_after = Decimal(0)
    current_mese = today.strftime("%Y-%m")
    for mk in reversed(month_keys):
        saldo_per_mese[mk] = saldo_totale_corrente - cumulative_after
        if mk != current_mese:
            cumulative_after += flussi.get(mk, Decimal(0))

    # ── 8. Punti risultato ────────────────────────────────────────────────────
    mesi_it = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"]
    last_known_port = Decimal(0)
    result = []

    for mk in month_keys:
        y, m = int(mk[:4]), int(mk[5:])
        _, last_day = monthrange(y, m)
        mese_end = date(y, m, last_day)

        # Portafoglio: usa snapshot ≤ mese, altrimenti il più recente disponibile
        if mk in port_per_mese:
            last_known_port = port_per_mese[mk]
        port_val = last_known_port if last_known_port > 0 else port_corrente

        liquidita = saldo_per_mese.get(mk, Decimal(0))
        mutui_val = await _residuo_mutui_al(mese_end)
        patrimonio_netto = liquidita + port_val + asset_fissi - mutui_val

        label = f"{mesi_it[m-1]} {str(y)[2:]}"
        result.append({
            "mese": mk,
            "label": label,
            "liquidita": round(float(liquidita), 2),
            "portafoglio": round(float(port_val), 2),
            "immobili_orologi": round(float(asset_fissi), 2),
            "mutui": round(float(mutui_val), 2),
            "patrimonio_netto": round(float(patrimonio_netto), 2),
        })

    return result
