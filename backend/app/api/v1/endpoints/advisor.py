"""
AI Financial Advisor endpoint.
Analisi patrimoniale strutturata + chat interattiva con contesto finanziario completo.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from decimal import Decimal
from datetime import date, timedelta
import json
import os
import httpx

from app.db.session import get_db
from app.core.security import get_current_user
from app.core.config import settings
from app.models.models import (
    Conto, TipoConto, SaldoSnapshot,
    Posizione, PosizioneSnapshot,
    Immobile, ImmobileSnapshot,
    Orologio, OrologioSnapshot,
    Mutuo, Movimento, TipoMovimento, CategoriaSpesa,
    FondoPensione, FondoPensioneSnapshot,
)

router = APIRouter()

ANTHROPIC_API_KEY = settings.ANTHROPIC_API_KEY or os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-opus-4-5"


# ─── Schemas ────────────────────────────────────────────────────────────────────

class AdvisorResponse(BaseModel):
    valutazione: str
    rischi: list[str]
    consigli: list[str]
    aree_risparmio: list[str]
    punteggio_salute: int
    sommario: str


class ChatMessage(BaseModel):
    role: str    # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []


class ChatResponse(BaseModel):
    response: str


# ─── Context builders ───────────────────────────────────────────────────────────

async def _build_patrimonio_context(db: AsyncSession, user_id) -> dict:
    """Assembla snapshot patrimoniale completo."""

    # Conti
    conti_r = await db.execute(
        select(Conto).where(Conto.utente_id == user_id, Conto.attivo == True)
    )
    conti = conti_r.scalars().all()
    conto_ids = [c.id for c in conti]

    saldi_map: dict = {}
    if conto_ids:
        subq = (
            select(SaldoSnapshot.conto_id, func.max(SaldoSnapshot.id).label("mid"))
            .where(SaldoSnapshot.conto_id.in_(conto_ids))
            .group_by(SaldoSnapshot.conto_id)
            .subquery()
        )
        sr = await db.execute(
            select(SaldoSnapshot).join(
                subq,
                (SaldoSnapshot.conto_id == subq.c.conto_id) & (SaldoSnapshot.id == subq.c.mid),
            )
        )
        saldi_map = {row.conto_id: row for row in sr.scalars().all()}

    conti_data = []
    for c in conti:
        snap = saldi_map.get(c.id)
        conti_data.append({"nome": c.nome, "tipo": c.tipo.value, "banca": c.banca, "saldo": float(snap.saldo) if snap else 0.0})

    liquidita = sum(
        float(saldi_map[c.id].saldo) if c.id in saldi_map else 0
        for c in conti
        if c.tipo in (TipoConto.conto_corrente, TipoConto.deposito)
    )

    # Portafoglio — carica subito la relazione strumento per evitare lazy load in async
    pos_r = await db.execute(
        select(Posizione)
        .options(selectinload(Posizione.strumento))
        .where(Posizione.utente_id == user_id, Posizione.attivo == True)
    )
    posizioni = pos_r.scalars().all()
    pos_ids = [p.id for p in posizioni]

    pos_snap_map: dict = {}
    if pos_ids:
        subq2 = (
            select(PosizioneSnapshot.posizione_id, func.max(PosizioneSnapshot.id).label("mid"))
            .where(PosizioneSnapshot.posizione_id.in_(pos_ids))
            .group_by(PosizioneSnapshot.posizione_id)
            .subquery()
        )
        psr = await db.execute(
            select(PosizioneSnapshot).join(
                subq2,
                (PosizioneSnapshot.posizione_id == subq2.c.posizione_id) & (PosizioneSnapshot.id == subq2.c.mid),
            )
        )
        pos_snap_map = {row.posizione_id: row for row in psr.scalars().all()}

    portafoglio_items = []
    for p in posizioni:
        snap = pos_snap_map.get(p.id)
        vm = float(snap.valore_mercato) if snap else float(p.valore_carico)
        pnl = vm - float(p.valore_carico)
        pnl_pct = (pnl / float(p.valore_carico) * 100) if p.valore_carico else 0
        portafoglio_items.append({
            "simbolo": p.strumento.simbolo if p.strumento else "?",
            "nome": p.strumento.nome if p.strumento else "?",
            "tipo": p.strumento.tipo.value if p.strumento else "?",
            "valore_mercato": vm,
            "valore_carico": float(p.valore_carico),
            "pnl_eur": pnl,
            "pnl_pct": round(pnl_pct, 1),
        })
    portafoglio_totale = sum(i["valore_mercato"] for i in portafoglio_items)

    # Immobili
    imm_r = await db.execute(
        select(Immobile).where(Immobile.utente_id == user_id, Immobile.attivo == True)
    )
    immobili = imm_r.scalars().all()
    imm_ids = [i.id for i in immobili]

    imm_snap_map: dict = {}
    if imm_ids:
        subq3 = (
            select(ImmobileSnapshot.immobile_id, func.max(ImmobileSnapshot.id).label("mid"))
            .where(ImmobileSnapshot.immobile_id.in_(imm_ids))
            .group_by(ImmobileSnapshot.immobile_id)
            .subquery()
        )
        isr = await db.execute(
            select(ImmobileSnapshot).join(
                subq3,
                (ImmobileSnapshot.immobile_id == subq3.c.immobile_id) & (ImmobileSnapshot.id == subq3.c.mid),
            )
        )
        imm_snap_map = {row.immobile_id: row for row in isr.scalars().all()}

    immobili_data = []
    for im in immobili:
        snap = imm_snap_map.get(im.id)
        immobili_data.append({"nome": im.nome, "tipo": im.tipo if hasattr(im, 'tipo') else "", "valore": float(snap.valore_mercato) if snap else 0.0})
    immobili_totale = sum(d["valore"] for d in immobili_data)

    # Mutui
    mut_r = await db.execute(
        select(Mutuo).where(Mutuo.utente_id == user_id, Mutuo.attivo == True)
    )
    mutui = mut_r.scalars().all()
    mutui_data = [
        {
            "nome": m.nome, "banca": m.banca,
            "residuo": float(m.capitale_residuo),
            "rata_mensile": float(m.rata_mensile),
            "scadenza": str(m.data_scadenza),
            "tasso_tipo": m.tasso_tipo,
            "tasso_valore": float(m.tasso_valore) if m.tasso_valore else None,
        }
        for m in mutui
    ]
    totale_mutui = sum(d["residuo"] for d in mutui_data)
    rata_mensile_totale = sum(d["rata_mensile"] for d in mutui_data)

    # Orologi
    or_r = await db.execute(
        select(Orologio).where(Orologio.utente_id == user_id, Orologio.attivo == True)
    )
    orologi = or_r.scalars().all()
    or_ids = [o.id for o in orologi]

    or_snap_map: dict = {}
    if or_ids:
        subq4 = (
            select(OrologioSnapshot.orologio_id, func.max(OrologioSnapshot.id).label("mid"))
            .where(OrologioSnapshot.orologio_id.in_(or_ids))
            .group_by(OrologioSnapshot.orologio_id)
            .subquery()
        )
        osr = await db.execute(
            select(OrologioSnapshot).join(
                subq4,
                (OrologioSnapshot.orologio_id == subq4.c.orologio_id) & (OrologioSnapshot.id == subq4.c.mid),
            )
        )
        or_snap_map = {row.orologio_id: row for row in osr.scalars().all()}

    orologi_data = []
    for o in orologi:
        snap = or_snap_map.get(o.id)
        orologi_data.append({
            "nome": f"{o.marca} {o.modello}",
            "stima_min": float(snap.stima_min) if snap else 0,
            "stima_max": float(snap.stima_max) if snap else 0,
            "valore_medio": float((snap.stima_min + snap.stima_max) / 2) if snap else 0,
        })
    orologi_totale = sum(d["valore_medio"] for d in orologi_data)

    totale_asset = liquidita + portafoglio_totale + immobili_totale + orologi_totale
    patrimonio_netto = totale_asset - totale_mutui

    return {
        "conti": conti_data,
        "liquidita": liquidita,
        "portafoglio_items": portafoglio_items,
        "portafoglio_totale": portafoglio_totale,
        "immobili": immobili_data,
        "immobili_totale": immobili_totale,
        "orologi": orologi_data,
        "orologi_totale": orologi_totale,
        "mutui": mutui_data,
        "totale_mutui": totale_mutui,
        "rata_mensile_totale": rata_mensile_totale,
        "totale_asset": totale_asset,
        "patrimonio_netto": patrimonio_netto,
    }


async def _build_spese_context(db: AsyncSession, user_id) -> dict:
    """Analisi spese ultimi 90 giorni: per categoria + mensile."""
    since = date.today() - timedelta(days=90)

    # Totale per categoria (solo uscite)
    cat_r = await db.execute(
        select(
            CategoriaSpesa.nome,
            func.sum(Movimento.importo).label("totale"),
            func.count(Movimento.id).label("n"),
        )
        .join(CategoriaSpesa, Movimento.categoria_id == CategoriaSpesa.id, isouter=True)
        .where(
            Movimento.utente_id == user_id,
            Movimento.tipo == TipoMovimento.uscita,
            Movimento.data_operazione >= since,
        )
        .group_by(CategoriaSpesa.nome)
        .order_by(func.sum(Movimento.importo).desc())
    )
    per_categoria = [
        {"categoria": r.nome or "Non categorizzato", "totale": float(r.totale), "n_transazioni": r.n}
        for r in cat_r.fetchall()
    ]
    totale_uscite_90gg = sum(c["totale"] for c in per_categoria)

    # Riepilogo mensile (ultimi 3 mesi)
    mesi_r = await db.execute(
        select(
            func.extract("year",  Movimento.data_operazione).label("anno"),
            func.extract("month", Movimento.data_operazione).label("mese"),
            func.sum(
                case((Movimento.tipo == TipoMovimento.uscita, Movimento.importo), else_=0)
            ).label("uscite"),
            func.sum(
                case((Movimento.tipo == TipoMovimento.entrata, Movimento.importo), else_=0)
            ).label("entrate"),
        )
        .where(
            Movimento.utente_id == user_id,
            Movimento.data_operazione >= since,
        )
        .group_by("anno", "mese")
        .order_by("anno", "mese")
    )
    mesi_nomi = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"]
    per_mese = [
        {
            "periodo": f"{mesi_nomi[int(r.mese)-1]} {int(r.anno)}",
            "uscite": float(r.uscite or 0),
            "entrate": float(r.entrate or 0),
            "saldo_netto": float((r.entrate or 0) - (r.uscite or 0)),
        }
        for r in mesi_r.fetchall()
    ]

    # Top 5 spese singole più alte
    top_r = await db.execute(
        select(Movimento.descrizione, Movimento.importo, Movimento.data_operazione)
        .where(
            Movimento.utente_id == user_id,
            Movimento.tipo == TipoMovimento.uscita,
            Movimento.data_operazione >= since,
        )
        .order_by(Movimento.importo.desc())
        .limit(5)
    )
    top_spese = [
        {"descrizione": r.descrizione or "—", "importo": float(r.importo), "data": str(r.data_operazione)}
        for r in top_r.fetchall()
    ]

    return {
        "periodo": "ultimi 90 giorni",
        "totale_uscite": totale_uscite_90gg,
        "media_mensile_uscite": totale_uscite_90gg / 3,
        "per_categoria": per_categoria,
        "per_mese": per_mese,
        "top_spese_singole": top_spese,
    }


async def _build_polizze_context(db: AsyncSession, user_id) -> dict:
    """Assembla dati polizze assicurative con garanzie, beneficiari e copertura CPI live."""
    from sqlalchemy import text

    FACTORS: dict = {"mensile": 1.0, "trimestrale": 1/3, "semestrale": 1/6, "annuale": 1/12, "unico": 0.0}

    pol_res = await db.execute(
        text("""
            SELECT p.*,
                   m.nome AS mutuo_nome,
                   CASE WHEN p.mutuo_id IS NOT NULL
                        THEN m.capitale_erogato - COALESCE((
                                SELECT SUM(pa.quota_capitale) FROM piano_ammortamento pa
                                WHERE pa.mutuo_id = p.mutuo_id AND pa.data_scadenza <= CURRENT_DATE
                             ), 0)
                        ELSE NULL END AS residuo_live
            FROM polizze_assicurative p
            LEFT JOIN mutui m ON m.id = p.mutuo_id
            WHERE p.utente_id = :uid AND p.attiva = TRUE
            ORDER BY p.tipo, p.nome
        """).bindparams(uid=user_id)
    )
    rows = pol_res.fetchall()

    polizze = []
    totale_premio_mensile = 0.0

    for row in rows:
        # Garanzie
        g_res = await db.execute(
            text("""SELECT tipo_garanzia, descrizione, note
                    FROM garanzie_polizza WHERE polizza_id = :pid AND attiva = TRUE""")
            .bindparams(pid=row.id)
        )
        garanzie = [
            {"tipo": g.tipo_garanzia, "descrizione": g.descrizione or g.tipo_garanzia}
            for g in g_res.fetchall()
        ]

        # Beneficiari
        b_res = await db.execute(
            text("""SELECT nome_cognome, relazione, percentuale_quota
                    FROM beneficiari_polizza WHERE polizza_id = :pid ORDER BY ordine""")
            .bindparams(pid=row.id)
        )
        beneficiari = [
            f"{b.nome_cognome} ({b.relazione or '—'}{f', {float(b.percentuale_quota):.0f}%' if b.percentuale_quota else ''})"
            for b in b_res.fetchall()
        ]

        # Premio mensile equivalente
        premio_mensile = 0.0
        if row.premio_importo:
            f = FACTORS.get(row.premio_periodicita or "mensile", 1.0)
            premio_mensile = float(row.premio_importo) * f
            totale_premio_mensile += premio_mensile

        # CPI: copertura live
        copertura_live = None
        if row.mutuo_id and row.copertura_percentuale and row.residuo_live:
            copertura_live = float(row.residuo_live) * float(row.copertura_percentuale) / 100

        polizze.append({
            "nome": row.nome,
            "tipo": row.tipo,
            "stato": row.stato,
            "compagnia": row.compagnia or "n.d.",
            "numero_polizza": row.numero_polizza,
            "data_stipula": str(row.data_stipula) if row.data_stipula else None,
            "data_scadenza": str(row.data_scadenza) if row.data_scadenza else "—",
            "premio_importo": float(row.premio_importo) if row.premio_importo else None,
            "premio_periodicita": row.premio_periodicita,
            "premio_mensile_equiv": round(premio_mensile, 2),
            "capitale_assicurato": float(row.capitale_assicurato) if row.capitale_assicurato else None,
            "mutuo_collegato": row.mutuo_nome,
            "copertura_percentuale": float(row.copertura_percentuale) if row.copertura_percentuale else None,
            "copertura_effettiva_live": round(copertura_live, 2) if copertura_live else None,
            "garanzie": garanzie,
            "beneficiari": beneficiari,
            "note": row.note,
        })

    return {
        "polizze": polizze,
        "n_polizze_attive": len(polizze),
        "totale_premio_mensile": round(totale_premio_mensile, 2),
    }


async def _build_fondi_pensione_context(db: AsyncSession, user_id) -> list[dict]:
    """Assembla dati fondi pensione complementari con ultimo snapshot."""
    from sqlalchemy.orm import selectinload
    res = await db.execute(
        select(FondoPensione)
        .options(selectinload(FondoPensione.snapshots))
        .where(FondoPensione.utente_id == user_id)
    )
    fondi = res.scalars().all()
    out = []
    for f in fondi:
        snap = f.snapshots[0] if f.snapshots else None
        out.append({
            "nome": f.nome,
            "tipo": f.tipo,
            "saldo_individuale": float(snap.saldo_individuale) if snap else 0,
            "tfr_maturato": float(snap.tfr_maturato) if snap else 0,
            "totale_posizione": float(snap.totale_posizione) if snap else 0,
            "anzianita_anni": snap.anzianita_anni if snap else 0,
            "anzianita_mesi": snap.anzianita_mesi if snap else 0,
            "data_riferimento": str(snap.data_riferimento) if snap else None,
            "mesi_a_8_anni": max(0, 96 - (snap.anzianita_anni * 12 + snap.anzianita_mesi)) if snap else 96,
        })
    return out


# ─── Prompt builders ────────────────────────────────────────────────────────────

def _fmt(v: float) -> str:
    return f"€{v:,.0f}".replace(",", ".")


def _build_system_prompt(pat: dict, spese: dict, fondi: list[dict] | None = None, polizze: dict | None = None) -> str:
    """System prompt ricco con tutto il contesto finanziario."""
    lines = [
        "Sei Marco, un consulente finanziario indipendente di alto livello e di fiducia del cliente.",
        "Rispondi SEMPRE in italiano. Sii diretto, specifico e usa i numeri reali del cliente.",
        "Quando identifichi problemi, proponi soluzioni concrete. Mantieni un tono professionale ma accessibile.",
        "Non fornire consigli legali o fiscali specifici, ma suggerisci di consultare professionisti per quelli.",
        "",
        f"## SITUAZIONE FINANZIARIA AGGIORNATA AL {date.today().strftime('%d/%m/%Y')}",
        "",
        "### PATRIMONIO NETTO",
        f"- Totale asset: {_fmt(pat['totale_asset'])}",
        f"- Totale passività (mutui): {_fmt(pat['totale_mutui'])}",
        f"- **Patrimonio netto: {_fmt(pat['patrimonio_netto'])}**",
        "",
        "### LIQUIDITÀ",
        f"Totale liquidità: {_fmt(pat['liquidita'])}",
    ]
    for c in pat["conti"]:
        lines.append(f"  - {c['nome']} ({c['tipo']}, {c['banca']}): {_fmt(c['saldo'])}")

    lines += ["", "### PORTAFOGLIO INVESTIMENTI", f"Totale: {_fmt(pat['portafoglio_totale'])}"]
    for p in pat["portafoglio_items"]:
        pnl_str = f"+{_fmt(p['pnl_eur'])}" if p["pnl_eur"] >= 0 else _fmt(p["pnl_eur"])
        lines.append(f"  - {p['simbolo']} ({p['tipo']}): {_fmt(p['valore_mercato'])} | P&L {pnl_str} ({p['pnl_pct']:+.1f}%)")

    lines += ["", "### IMMOBILI", f"Totale: {_fmt(pat['immobili_totale'])}"]
    for im in pat["immobili"]:
        lines.append(f"  - {im['nome']}: {_fmt(im['valore'])}")

    if pat["orologi"]:
        lines += ["", "### OROLOGI DA COLLEZIONE", f"Totale stimato: {_fmt(pat['orologi_totale'])}"]
        for o in pat["orologi"]:
            lines.append(f"  - {o['nome']}: stima {_fmt(o['stima_min'])}–{_fmt(o['stima_max'])}")

    lines += ["", "### MUTUI", f"Debito residuo totale: {_fmt(pat['totale_mutui'])} | Rata mensile totale: {_fmt(pat['rata_mensile_totale'])}"]
    for m in pat["mutui"]:
        tasso = f"{m['tasso_valore']:.2f}% {m['tasso_tipo']}" if m["tasso_valore"] else "n.d."
        lines.append(f"  - {m['nome']} ({m['banca']}): residuo {_fmt(m['residuo'])}, rata {_fmt(m['rata_mensile'])}/mese, {tasso}, scadenza {m['scadenza']}")

    lines += [
        "",
        f"### ANALISI SPESE ({spese['periodo']})",
        f"Totale uscite: {_fmt(spese['totale_uscite'])} | Media mensile: {_fmt(spese['media_mensile_uscite'])}",
        "",
        "**Per categoria** (ordinate per importo):",
    ]
    for c in spese["per_categoria"][:10]:
        lines.append(f"  - {c['categoria']}: {_fmt(c['totale'])} ({c['n_transazioni']} transazioni)")

    if spese["per_mese"]:
        lines += ["", "**Andamento mensile**:"]
        for m in spese["per_mese"]:
            lines.append(f"  - {m['periodo']}: uscite {_fmt(m['uscite'])}, entrate {_fmt(m['entrate'])}, saldo netto {_fmt(m['saldo_netto'])}")

    if spese["top_spese_singole"]:
        lines += ["", "**Top 5 spese singole**:"]
        for t in spese["top_spese_singole"]:
            lines.append(f"  - {t['data']}: {t['descrizione']} — {_fmt(t['importo'])}")

    if fondi:
        totale_fondi = sum(f["totale_posizione"] for f in fondi)
        lines += ["", f"### FONDI PENSIONE COMPLEMENTARI", f"Totale posizione: {_fmt(totale_fondi)}"]
        for f in fondi:
            mesi = f["mesi_a_8_anni"]
            sblocco = f"Anticipazione 30%/casa già disponibile" if mesi == 0 else f"Anticipazione 30%/casa tra ~{mesi} mesi"
            lines.append(
                f"  - {f['nome']} ({f['tipo']}): posizione totale {_fmt(f['totale_posizione'])} "
                f"[saldo individuale {_fmt(f['saldo_individuale'])} + TFR {_fmt(f['tfr_maturato'])}] "
                f"| anzianità {f['anzianita_anni']}a {f['anzianita_mesi']}m | {sblocco}"
            )
        lines.append(
            "  NOTA: i fondi pensione non sono patrimonio liberamente disponibile; "
            "l'accesso è vincolato (anticipazioni, riscatti, RITA, pensione complementare). "
            "Tienine conto nelle analisi di liquidità e nella pianificazione previdenziale."
        )

    if polizze and polizze.get("polizze"):
        pol_list = polizze["polizze"]
        lines += [
            "",
            f"### COPERTURE ASSICURATIVE",
            f"Polizze attive: {polizze['n_polizze_attive']} | Premio mensile equivalente totale: {_fmt(polizze['totale_premio_mensile'])}",
        ]
        TIPO_LABEL = {
            "vita_intera": "Polizza Mista Rivalutabile",
            "vita_termine": "Vita a Termine",
            "cpi_mutuo": "CPI Mutuo",
            "tcm": "Temporanea Caso Morte",
            "invalidita": "Invalidità",
            "malattia_grave": "Malattia Grave",
            "ltc": "Long Term Care",
            "altro": "Altro",
        }
        for p in pol_list:
            tipo_label = TIPO_LABEL.get(p["tipo"], p["tipo"])
            linea = f"  - **{p['nome']}** [{tipo_label}] ({p['compagnia']})"
            if p["numero_polizza"]:
                linea += f" | N° {p['numero_polizza']}"
            linea += f" | Stato: {p['stato']}"
            lines.append(linea)

            if p["premio_importo"]:
                lines.append(f"    Premio: {_fmt(p['premio_importo'])}/{p['premio_periodicita']} (≈ {_fmt(p['premio_mensile_equiv'])}/mese)")

            if p["tipo"] == "vita_intera" and p["capitale_assicurato"]:
                lines.append(f"    Valore riscatto maturato: {_fmt(p['capitale_assicurato'])}")
                if p["note"]:
                    # Estrai solo la parte con rendimento
                    note_short = p["note"][:200] if len(p["note"]) > 200 else p["note"]
                    lines.append(f"    Note: {note_short}")

            if p["copertura_effettiva_live"]:
                lines.append(f"    CPI: copre {p['copertura_percentuale']:.0f}% del debito → copertura oggi {_fmt(p['copertura_effettiva_live'])}")
            elif p["tipo"] == "cpi_mutuo" and p["mutuo_collegato"]:
                lines.append(f"    CPI collegata al mutuo: {p['mutuo_collegato']}")

            if p["garanzie"]:
                garanzie_str = ", ".join(g["descrizione"] for g in p["garanzie"])
                lines.append(f"    Garanzie: {garanzie_str}")

            if p["beneficiari"]:
                lines.append(f"    Beneficiari: {', '.join(p['beneficiari'])}")

    lines += [
        "",
        "## ISTRUZIONI COMPORTAMENTO",
        "- Quando il cliente chiede 'dove posso risparmiare', analizza le categorie di spesa e identifica quelle ottimizzabili",
        "- Per investimenti, considera il rapporto liquidità/portafoglio e la diversificazione esistente",
        "- Per i mutui, valuta opportunità di rinegoziazione o estinzione anticipata parziale",
        "- Sii proattivo: se vedi qualcosa di importante nel contesto, segnalalo anche se non chiesto esplicitamente",
        "- Rispondi in modo conciso ma completo; usa elenchi puntati per consigli pratici",
    ]
    return "\n".join(lines)


def _build_analysis_prompt(pat: dict, spese: dict, fondi: list[dict] | None = None, polizze: dict | None = None) -> str:
    """Prompt per analisi strutturata JSON (endpoint /analisi)."""
    system = _build_system_prompt(pat, spese, fondi, polizze)
    return system + """

## RICHIESTA
Fornisci un'analisi finanziaria completa in formato JSON con questa struttura esatta:
{
  "sommario": "Sommario dello stato finanziario in 2-3 frasi",
  "punteggio_salute": <intero 0-100 dove 100 è eccellente>,
  "valutazione": "Analisi approfondita della situazione (3-5 paragrafi)",
  "rischi": ["rischio concreto 1", "rischio 2", ...],
  "consigli": ["consiglio pratico e prioritizzato 1", "consiglio 2", ...],
  "aree_risparmio": ["area di risparmio identificata 1", "area 2", ...]
}

Fornisci 3-5 rischi, 5-7 consigli prioritizzati, 3-5 aree di risparmio concrete basate sulle spese reali.
Rispondi SOLO con il JSON, senza testo prima o dopo."""


async def _call_claude(system: str, messages: list[dict], max_tokens: int = 1500) -> str:
    """Chiama l'API Anthropic e restituisce il testo della risposta."""
    if not ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY non configurata nel file .env del backend.",
        )

    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(
            ANTHROPIC_URL,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": MODEL,
                "max_tokens": max_tokens,
                "system": system,
                "messages": messages,
            },
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Anthropic API error: {resp.text[:300]}")

    return resp.json()["content"][0]["text"]


# ─── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/analisi", response_model=AdvisorResponse)
async def analisi_finanziaria(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Analisi strutturata con punteggio, rischi, consigli e aree di risparmio."""
    pat     = await _build_patrimonio_context(db, current_user.id)
    spese   = await _build_spese_context(db, current_user.id)
    fondi   = await _build_fondi_pensione_context(db, current_user.id)
    polizze = await _build_polizze_context(db, current_user.id)
    prompt  = _build_analysis_prompt(pat, spese, fondi, polizze)

    text = await _call_claude(
        system="Sei un consulente finanziario esperto. Rispondi solo in JSON valido.",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=2048,
    )

    # Strip markdown fences se presenti
    if "```" in text:
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else parts[0]
        if text.startswith("json"):
            text = text[4:]

    data = json.loads(text.strip())
    return AdvisorResponse(
        sommario=data.get("sommario", ""),
        punteggio_salute=int(data.get("punteggio_salute", 50)),
        valutazione=data.get("valutazione", ""),
        rischi=data.get("rischi", []),
        consigli=data.get("consigli", []),
        aree_risparmio=data.get("aree_risparmio", []),
    )


@router.post("/chat", response_model=ChatResponse)
async def chat_finanziario(
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Chat interattiva con l'AI advisor.
    Il contesto finanziario completo è incluso nel system prompt ad ogni chiamata.
    """
    pat     = await _build_patrimonio_context(db, current_user.id)
    spese   = await _build_spese_context(db, current_user.id)
    fondi   = await _build_fondi_pensione_context(db, current_user.id)
    polizze = await _build_polizze_context(db, current_user.id)
    system  = _build_system_prompt(pat, spese, fondi, polizze)

    # Costruisce la lista messaggi: history + messaggio corrente
    messages = [{"role": m.role, "content": m.content} for m in body.history]
    messages.append({"role": "user", "content": body.message})

    response_text = await _call_claude(system=system, messages=messages, max_tokens=1024)
    return ChatResponse(response=response_text)
