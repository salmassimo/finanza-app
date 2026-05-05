"""
Motore di proiezione patrimoniale — 3 scenari × 60 mesi.

Logica:
  - Legge i dati reali del DB (movimenti, patrimonio, mutui, fondo pensione)
  - Calcola entrate/uscite medie mensili degli ultimi 90 giorni
  - Proietta mese per mese per 5 anni sotto 3 ipotesi di comportamento
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, case, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import (
    Conto, TipoConto, SaldoSnapshot,
    Posizione, PosizioneSnapshot,
    Immobile, ImmobileSnapshot,
    Orologio, OrologioSnapshot,
    Mutuo, PianoAmmortamento,
    Movimento, TipoMovimento,
    FondoPensione, FondoPensioneSnapshot,
    ObiettivoFinanziario,
)


# ─── Parametri scenari ───────────────────────────────────────────────────────

SCENARI = {
    "base": {
        "nome": "Base",
        "descrizione": "Continui come ora",
        "spesa_mult": 1.00,
        "invest_pct":  0.50,   # % del risparmio netto investita in portafoglio
        "tasso_annuo": 0.055,  # rendimento portafoglio annuo
        "color": "#38BDF8",
    },
    "ottimizzato": {
        "nome": "Ottimizzato",
        "descrizione": "Riduci le spese del 15%, investi di più",
        "spesa_mult": 0.85,
        "invest_pct":  0.70,
        "tasso_annuo": 0.065,
        "color": "#4ADE80",
    },
    "aggressivo": {
        "nome": "Aggressivo",
        "descrizione": "Risparmio massimo, investimento spinto",
        "spesa_mult": 0.75,
        "invest_pct":  0.85,
        "tasso_annuo": 0.080,
        "color": "#A78BFA",
    },
}

MESI_PROIEZIONE = 60  # 5 anni


# ─── Raccolta snapshot patrimoniale ──────────────────────────────────────────

async def _patrimonio_attuale(db: AsyncSession, user_id) -> dict:
    """Snapshot completo del patrimonio corrente."""

    # Liquidità (conti correnti + deposito)
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
        for c in conti
        if c.tipo in (TipoConto.conto_corrente, TipoConto.deposito)
    )

    # Portafoglio
    pos_r = await db.execute(
        select(Posizione).options(selectinload(Posizione.strumento))
        .where(Posizione.utente_id == user_id, Posizione.attivo == True)
    )
    posizioni = pos_r.scalars().all()
    pos_ids = [p.id for p in posizioni]

    pos_snap: dict = {}
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
        pos_snap = {r.posizione_id: r for r in psr.scalars().all()}

    portafoglio = sum(
        float(pos_snap[p.id].valore_mercato) if p.id in pos_snap else float(p.valore_carico)
        for p in posizioni
    )

    # Immobili
    imm_r = await db.execute(
        select(Immobile).where(Immobile.utente_id == user_id, Immobile.attivo == True)
    )
    immobili = imm_r.scalars().all()
    imm_ids = [i.id for i in immobili]

    imm_snap: dict = {}
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
        imm_snap = {r.immobile_id: r for r in isr.scalars().all()}

    immobili_val = sum(
        float(imm_snap[i.id].valore_mercato) if i.id in imm_snap else 0
        for i in immobili
    )

    # Orologi
    or_r = await db.execute(
        select(Orologio).where(Orologio.utente_id == user_id, Orologio.attivo == True)
    )
    orologi = or_r.scalars().all()
    or_ids = [o.id for o in orologi]

    or_snap: dict = {}
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
        or_snap = {r.orologio_id: r for r in osr.scalars().all()}

    orologi_val = sum(
        float((or_snap[o.id].stima_min + or_snap[o.id].stima_max) / 2)
        if o.id in or_snap else 0
        for o in orologi
    )

    # Mutui
    mut_r = await db.execute(
        select(Mutuo).where(Mutuo.utente_id == user_id, Mutuo.attivo == True)
    )
    mutui = mut_r.scalars().all()
    mutui_data = [
        {
            "residuo": float(m.capitale_residuo),
            "rata_mensile": float(m.rata_mensile),
            "data_scadenza": m.data_scadenza,
        }
        for m in mutui
    ]
    mutui_residuo = sum(d["residuo"] for d in mutui_data)
    rata_mensile_totale = sum(d["rata_mensile"] for d in mutui_data)

    # Fondo pensione
    fp_r = await db.execute(
        select(FondoPensione).options(selectinload(FondoPensione.snapshots))
        .where(FondoPensione.utente_id == user_id)
    )
    fondi = fp_r.scalars().all()
    fondo_totale = sum(
        float(f.snapshots[0].totale_posizione) if f.snapshots else 0
        for f in fondi
    )
    fondo_anzianita_mesi = sum(
        f.snapshots[0].anzianita_anni * 12 + f.snapshots[0].anzianita_mesi
        if f.snapshots else 0
        for f in fondi
    )

    return {
        "liquidita":            liquidita,
        "portafoglio":          portafoglio,
        "immobili":             immobili_val,
        "orologi":              orologi_val,
        "fondo_pensione":       fondo_totale,
        "fondo_anzianita_mesi": fondo_anzianita_mesi,
        "mutui_residuo":        mutui_residuo,
        "rata_mensile_mutui":   rata_mensile_totale,
        "mutui_data":           mutui_data,
    }


async def _flussi_medi(db: AsyncSession, user_id) -> dict:
    """Media mensile entrate/uscite ultimi 90 giorni."""
    since = date.today() - timedelta(days=90)

    r = await db.execute(
        select(
            func.sum(case((Movimento.tipo == TipoMovimento.entrata, Movimento.importo), else_=0)).label("entrate"),
            func.sum(case((Movimento.tipo == TipoMovimento.uscita,  Movimento.importo), else_=0)).label("uscite"),
        ).where(
            Movimento.utente_id == user_id,
            Movimento.data_operazione >= since,
            Movimento.is_carta_credito == False,
        )
    )
    row = r.fetchone()
    entrate_tot = float(row.entrate or 0)
    uscite_tot  = float(row.uscite  or 0)

    return {
        "entrate_mensili": entrate_tot / 3,
        "uscite_mensili":  uscite_tot  / 3,
    }


# ─── Logica proiezione ────────────────────────────────────────────────────────

def _mese_label(offset_mesi: int) -> str:
    today = date.today()
    m = (today.month - 1 + offset_mesi) % 12 + 1
    y = today.year + (today.month - 1 + offset_mesi) // 12
    mesi_it = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu",
               "Lug", "Ago", "Set", "Ott", "Nov", "Dic"]
    return f"{mesi_it[m-1]} {str(y)[2:]}"


def _proietta_scenario(pat: dict, flussi: dict, params: dict) -> list[dict]:
    """Proietta il patrimonio per MESI_PROIEZIONE mesi con i parametri dello scenario."""
    liquidita   = pat["liquidita"]
    portafoglio = pat["portafoglio"]
    immobili    = pat["immobili"]
    orologi     = pat["orologi"]
    fondo       = pat["fondo_pensione"]
    mutui_res   = pat["mutui_residuo"]
    rata_mutui  = pat["rata_mensile_mutui"]
    mutui_data  = pat["mutui_data"]

    entrate  = flussi["entrate_mensili"]
    uscite   = flussi["uscite_mensili"] * params["spesa_mult"]

    tasso_mensile       = params["tasso_annuo"] / 12
    invest_pct          = params["invest_pct"]
    tasso_fondo_mensile = 0.05 / 12   # crescita fondo pensione 5% anno

    # Calcola quota capitale mensile semplificata per ogni mutuo
    mutui_scadenze = [
        {
            "residuo": m["residuo"],
            "rata":    m["rata_mensile"],
            "mesi_rimanenti": max(1, (
                (m["data_scadenza"].year - date.today().year) * 12 +
                (m["data_scadenza"].month - date.today().month)
            ) if m["data_scadenza"] else 120),
        }
        for m in mutui_data
    ]

    punti = []

    for mese in range(MESI_PROIEZIONE + 1):
        milestones = []
        if mese == 0:
            milestones.append("Oggi")

        # Registra lo stato ATTUALE prima di applicare la crescita
        mutui_res = sum(m["residuo"] for m in mutui_scadenze)
        patrimonio_netto = liquidita + portafoglio + immobili + orologi + fondo - mutui_res

        # Milestone patrimonio (solo da mese 1 per evitare falsi positivi)
        if mese > 0:
            prev_pn = punti[-1]["patrimonio_netto"]
            for soglia in [500_000, 750_000, 1_000_000, 1_250_000, 1_500_000]:
                if prev_pn < soglia <= patrimonio_netto:
                    milestones.append(f"€{soglia//1000}k patrimonio netto")

        punti.append({
            "mese":             mese,
            "label":            _mese_label(mese),
            "patrimonio_netto": round(patrimonio_netto, 2),
            "liquidita":        round(liquidita, 2),
            "portafoglio":      round(portafoglio, 2),
            "fondo_pensione":   round(fondo, 2),
            "mutui_residuo":    round(mutui_res, 2),
            "milestones":       milestones,
        })

        if mese == MESI_PROIEZIONE:
            break

        # Applica crescita e flussi per il mese successivo
        risparmio_netto = entrate - uscite
        if risparmio_netto > 0:
            investito    = risparmio_netto * invest_pct
            in_liquidita = risparmio_netto * (1 - invest_pct)
        else:
            investito    = 0
            in_liquidita = risparmio_netto

        portafoglio = portafoglio * (1 + tasso_mensile) + investito
        fondo       = fondo * (1 + tasso_fondo_mensile)
        liquidita  += in_liquidita

        # Riduzione mutui
        for m in mutui_scadenze:
            if m["mesi_rimanenti"] <= 0:
                continue
            quota_cap = m["residuo"] / m["mesi_rimanenti"]
            m["residuo"] = max(0, m["residuo"] - quota_cap)
            m["mesi_rimanenti"] -= 1
            if m["residuo"] <= 0:
                punti[-1]["milestones"].append("Mutuo estinto")
        mutui_scadenze = [m for m in mutui_scadenze if m["residuo"] > 0]

    return punti


# ─── Entry point principale ──────────────────────────────────────────────────

async def calcola_scenari(db: AsyncSession, user_id) -> dict:
    """Calcola i 3 scenari e li restituisce con metadati."""
    pat    = await _patrimonio_attuale(db, user_id)
    flussi = await _flussi_medi(db, user_id)

    risultati = {}
    for key, params in SCENARI.items():
        # Copia pat per non mutare lo stato tra scenari
        import copy
        pat_copy = copy.deepcopy(pat)
        punti = _proietta_scenario(pat_copy, flussi, params)
        risultati[key] = {
            **params,
            "punti": punti,
            "patrimonio_finale": punti[-1]["patrimonio_netto"],
            "delta_vs_oggi":     punti[-1]["patrimonio_netto"] - punti[0]["patrimonio_netto"],
        }

    return {
        "scenari":     risultati,
        "snapshot":    pat,
        "flussi":      flussi,
        "mesi":        MESI_PROIEZIONE,
        "calcolato_al": date.today().isoformat(),
    }
