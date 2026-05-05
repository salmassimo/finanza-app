"""
Sistema di alert proattivi — analizza i dati reali e genera notifiche concrete.

Livelli:
  danger  → situazione critica, azione immediata
  warning → attenzione, monitorare
  info    → informazione utile, opportunità
"""
from __future__ import annotations

from datetime import date, timedelta, datetime
from decimal import Decimal

from sqlalchemy import func, case, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import (
    Conto, TipoConto, SaldoSnapshot,
    Mutuo,
    Movimento, TipoMovimento,
    FondoPensione, FondoPensioneSnapshot,
    ObiettivoFinanziario,
)


def _alert(livello: str, titolo: str, corpo: str, icona: str, categoria: str) -> dict:
    return {
        "livello":   livello,   # danger | warning | info
        "titolo":    titolo,
        "corpo":     corpo,
        "icona":     icona,     # ionicons name
        "categoria": categoria, # liquidita | pensione | mutui | spese | obiettivi | portafoglio
    }


async def calcola_alert(db: AsyncSession, user_id) -> list[dict]:
    alerts: list[dict] = []

    # ── 1. Liquidità ─────────────────────────────────────────────────────────

    # Saldo conti correnti
    conti_r = await db.execute(
        select(Conto).where(Conto.utente_id == user_id, Conto.attivo == True,
                             Conto.tipo.in_([TipoConto.conto_corrente, TipoConto.deposito]))
    )
    conti = conti_r.scalars().all()
    conto_ids = [c.id for c in conti]

    liquidita = 0.0
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
        saldi = sr.scalars().all()
        liquidita = sum(float(s.saldo) for s in saldi)

    # Uscite mensili medie (90 gg)
    since90 = date.today() - timedelta(days=90)
    r = await db.execute(
        select(func.sum(Movimento.importo)).where(
            Movimento.utente_id == user_id,
            Movimento.tipo == TipoMovimento.uscita,
            Movimento.data_operazione >= since90,
            Movimento.is_carta_credito == False,
        )
    )
    uscite_90 = float(r.scalar() or 0)
    uscite_mensili = uscite_90 / 3

    if uscite_mensili > 0:
        mesi_buffer = liquidita / uscite_mensili
        if mesi_buffer < 1:
            alerts.append(_alert(
                "danger", "Liquidità critica",
                f"Hai solo {mesi_buffer:.1f} mesi di spese coperte con la liquidità attuale "
                f"(€{liquidita:,.0f}). Considera di spostare fondi da investimenti.",
                "warning", "liquidita"
            ))
        elif mesi_buffer < 3:
            alerts.append(_alert(
                "warning", "Buffer liquidità basso",
                f"La tua liquidità (€{liquidita:,.0f}) copre {mesi_buffer:.1f} mesi di spese. "
                f"Il target consigliato è 3–6 mesi (€{uscite_mensili*3:,.0f}–€{uscite_mensili*6:,.0f}).",
                "water", "liquidita"
            ))
        elif mesi_buffer > 12:
            alerts.append(_alert(
                "info", "Liquidità in eccesso",
                f"Hai {mesi_buffer:.0f} mesi di spese in liquidità (€{liquidita:,.0f}). "
                f"Oltre 6 mesi di buffer potrebbe essere investito più efficacemente.",
                "trending-up", "liquidita"
            ))

    # ── 2. Anomalia spese mese corrente ──────────────────────────────────────

    today = date.today()
    inizio_mese = date(today.year, today.month, 1)
    since_prev  = inizio_mese - timedelta(days=90)

    r_curr = await db.execute(
        select(func.sum(Movimento.importo)).where(
            Movimento.utente_id == user_id,
            Movimento.tipo == TipoMovimento.uscita,
            Movimento.data_operazione >= inizio_mese,
            Movimento.is_carta_credito == False,
        )
    )
    uscite_mese = float(r_curr.scalar() or 0)

    giorni_mese = today.day
    uscite_proiettate = uscite_mese / giorni_mese * 30 if giorni_mese > 5 else 0

    if uscite_mensili > 0 and uscite_proiettate > uscite_mensili * 1.35:
        delta_pct = (uscite_proiettate / uscite_mensili - 1) * 100
        alerts.append(_alert(
            "warning", f"Spese mensili elevate (+{delta_pct:.0f}%)",
            f"A questo ritmo spenderai ~€{uscite_proiettate:,.0f} questo mese, "
            f"{delta_pct:.0f}% più della media (€{uscite_mensili:,.0f}/mese). "
            f"Controlla i movimenti per identificare le voci anomale.",
            "receipt", "spese"
        ))

    # ── 3. Fondo pensione — milestone 8 anni ─────────────────────────────────

    fp_r = await db.execute(
        select(FondoPensione).options(selectinload(FondoPensione.snapshots))
        .where(FondoPensione.utente_id == user_id)
    )
    fondi = fp_r.scalars().all()

    for fondo in fondi:
        if not fondo.snapshots:
            continue
        snap = fondo.snapshots[0]
        tot_mesi = snap.anzianita_anni * 12 + snap.anzianita_mesi
        mesi_a_8_anni = max(0, 96 - tot_mesi)

        if mesi_a_8_anni == 0:
            alerts.append(_alert(
                "info", f"{fondo.nome} — Anticipazione 30% disponibile",
                f"Hai superato gli 8 anni di iscrizione. Puoi richiedere un'anticipazione "
                f"del 30% (€{float(snap.totale_posizione)*0.30:,.0f}) per qualsiasi motivo, "
                f"o del 75% per acquisto/ristrutturazione prima casa.",
                "shield-checkmark", "pensione"
            ))
        elif mesi_a_8_anni <= 18:
            alerts.append(_alert(
                "info", f"{fondo.nome} — Anticipazione tra {mesi_a_8_anni} mesi",
                f"Tra {mesi_a_8_anni} mesi raggiungi gli 8 anni nel fondo. "
                f"Si sbloccherà l'anticipazione del 30% (~€{float(snap.totale_posizione)*0.30:,.0f}) "
                f"e del 75% per prima casa (~€{float(snap.totale_posizione)*0.75:,.0f}).",
                "time", "pensione"
            ))

    # ── 4. Mutui — alert tasso e scadenza ────────────────────────────────────

    mut_r = await db.execute(
        select(Mutuo).where(Mutuo.utente_id == user_id, Mutuo.attivo == True)
    )
    mutui = mut_r.scalars().all()

    for m in mutui:
        # Scadenza entro 24 mesi
        if m.data_scadenza:
            mesi_alla_scadenza = (
                (m.data_scadenza.year - today.year) * 12 +
                (m.data_scadenza.month - today.month)
            )
            if 0 < mesi_alla_scadenza <= 24:
                alerts.append(_alert(
                    "warning", f"Mutuo '{m.nome}' in scadenza",
                    f"Il mutuo scade tra {mesi_alla_scadenza} mesi "
                    f"(residuo €{float(m.capitale_residuo):,.0f}). "
                    f"Valuta se rinegoziare o estinguere anticipatamente.",
                    "business", "mutui"
                ))

        # Tasso variabile: check se conveniente passare a fisso
        if m.tasso_tipo == "variabile" and m.tasso_valore and float(m.tasso_valore) > 4.0:
            alerts.append(_alert(
                "info", f"Mutuo variabile '{m.nome}' a tasso elevato",
                f"Il tuo mutuo variabile è al {float(m.tasso_valore):.2f}%. "
                f"Potresti valutare la surroga a tasso fisso per bloccare la rata "
                f"(residuo €{float(m.capitale_residuo):,.0f}).",
                "swap-horizontal", "mutui"
            ))

    # ── 5. Obiettivi in ritardo ───────────────────────────────────────────────

    obj_r = await db.execute(
        select(ObiettivoFinanziario).where(
            ObiettivoFinanziario.utente_id == user_id,
            ObiettivoFinanziario.attivo == True,
        )
    )
    obiettivi = obj_r.scalars().all()

    for ob in obiettivi:
        giorni_rimanenti = (ob.target_data - today).days
        if giorni_rimanenti < 0:
            alerts.append(_alert(
                "warning", f"Obiettivo scaduto: {ob.nome}",
                f"L'obiettivo '{ob.nome}' era previsto per il "
                f"{ob.target_data.strftime('%d/%m/%Y')}. "
                f"Vuoi aggiornare la data o segnarlo come completato?",
                "flag", "obiettivi"
            ))
        elif giorni_rimanenti <= 90 and ob.target_importo:
            alerts.append(_alert(
                "info", f"Obiettivo in scadenza: {ob.nome}",
                f"Mancano {giorni_rimanenti} giorni alla scadenza dell'obiettivo "
                f"'{ob.nome}' (target €{float(ob.target_importo):,.0f}).",
                "flag", "obiettivi"
            ))

    # Ordina: danger prima, poi warning, poi info
    ordine = {"danger": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda a: ordine.get(a["livello"], 9))

    return alerts
