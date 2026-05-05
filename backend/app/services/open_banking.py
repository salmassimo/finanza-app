"""
Servizio GoCardless Bank Account Data (Open Banking PSD2).
Gestisce autenticazione, connessioni bancarie e sincronizzazione transazioni.
"""
import httpx
from decimal import Decimal
from datetime import datetime, date, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.models.models import (
    OBConnessione, OBTransazione, Movimento, SaldoSnapshot, TipoMovimento, CategoriaSpesa,
)
from app.services.categorizza import auto_categorizza

GOCARDLESS_BASE = "https://bankaccountdata.gocardless.com/api/v2"

# Cache token in memoria per evitare richieste ripetute
_token_cache: dict = {"access": None, "expires_at": None}


# ─── Auth token ────────────────────────────────────────────────────────────────

async def _get_token() -> str:
    """Restituisce un access token valido, richiedendone uno nuovo se scaduto."""
    now = datetime.utcnow()
    if _token_cache["access"] and _token_cache["expires_at"] and now < _token_cache["expires_at"]:
        return _token_cache["access"]

    if not settings.GOCARDLESS_SECRET_ID or not settings.GOCARDLESS_SECRET_KEY:
        raise ValueError("GOCARDLESS_SECRET_ID e GOCARDLESS_SECRET_KEY non configurati nel .env")

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{GOCARDLESS_BASE}/token/new/",
            json={
                "secret_id": settings.GOCARDLESS_SECRET_ID,
                "secret_key": settings.GOCARDLESS_SECRET_KEY,
            },
        )
        r.raise_for_status()
        data = r.json()
        _token_cache["access"] = data["access"]
        # Scade 23h dopo (GoCardless: 24h, usiamo 23h per sicurezza)
        _token_cache["expires_at"] = now + timedelta(hours=23)
        return _token_cache["access"]


# ─── GoCardless API calls ──────────────────────────────────────────────────────

async def get_institutions(country: str = "IT") -> list[dict]:
    """Lista istituti bancari disponibili per paese."""
    token = await _get_token()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{GOCARDLESS_BASE}/institutions/",
            params={"country": country},
            headers={"Authorization": f"Bearer {token}"},
        )
        r.raise_for_status()
        return r.json()


async def create_requisition(institution_id: str, redirect_url: str, reference: str) -> dict:
    """Crea una requisition GoCardless e restituisce {id, link}."""
    token = await _get_token()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{GOCARDLESS_BASE}/requisitions/",
            json={
                "redirect": redirect_url,
                "institution_id": institution_id,
                "reference": reference,
                "language": "IT",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        r.raise_for_status()
        return r.json()


async def get_requisition(req_id: str) -> dict:
    """Recupera lo stato di una requisition (include account_ids dopo auth)."""
    token = await _get_token()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{GOCARDLESS_BASE}/requisitions/{req_id}/",
            headers={"Authorization": f"Bearer {token}"},
        )
        r.raise_for_status()
        return r.json()


async def delete_requisition(req_id: str) -> None:
    """Elimina una requisition da GoCardless."""
    try:
        token = await _get_token()
        async with httpx.AsyncClient(timeout=30) as client:
            await client.delete(
                f"{GOCARDLESS_BASE}/requisitions/{req_id}/",
                headers={"Authorization": f"Bearer {token}"},
            )
    except Exception as e:
        print(f"[OB] Errore delete requisition {req_id}: {e}")


async def get_account_transactions(account_id: str, date_from: date | None = None) -> dict:
    """Recupera transazioni bancarie (booked + pending)."""
    token = await _get_token()
    params = {}
    if date_from:
        params["date_from"] = date_from.isoformat()
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(
            f"{GOCARDLESS_BASE}/accounts/{account_id}/transactions/",
            params=params,
            headers={"Authorization": f"Bearer {token}"},
        )
        r.raise_for_status()
        return r.json()


async def get_account_balances(account_id: str) -> dict:
    """Recupera saldo del conto bancario."""
    token = await _get_token()
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{GOCARDLESS_BASE}/accounts/{account_id}/balances/",
            headers={"Authorization": f"Bearer {token}"},
        )
        r.raise_for_status()
        return r.json()


# ─── Sync completo ─────────────────────────────────────────────────────────────

async def sync_connessione(db: AsyncSession, conn: OBConnessione) -> dict:
    """
    Sincronizza transazioni e saldo per una connessione GoCardless.
    - Salva transazioni raw in ob_transazioni (dedup per transaction_id)
    - Crea movimenti in movimenti con categorizzazione automatica (dedup per external_id)
    - Aggiorna saldo in saldi_snapshot
    - Aggiorna last_sync sulla connessione
    """
    if not conn.account_id:
        return {"error": "account_id non impostato – completa l'autenticazione prima", "nuove": 0, "duplicate": 0}

    # Range date: dall'ultimo sync (meno 1 giorno di overlap) o ultimi 90 giorni
    if conn.last_sync:
        date_from = (conn.last_sync.replace(tzinfo=None) - timedelta(days=1)).date()
    else:
        date_from = (datetime.utcnow() - timedelta(days=90)).date()

    print(f"[OB] Sync {conn.institution_name} account={conn.account_id} from={date_from}")

    # Fetch transazioni e saldo da GoCardless
    try:
        trans_data = await get_account_transactions(conn.account_id, date_from=date_from)
        bal_data = await get_account_balances(conn.account_id)
    except Exception as e:
        print(f"[OB] Errore fetch: {e}")
        return {"error": str(e), "nuove": 0, "duplicate": 0}

    # ── Livello 1: IDs GoCardless già in ob_transazioni ──
    ex_ob_res = await db.execute(
        select(OBTransazione.transaction_id).where(OBTransazione.connessione_id == conn.id)
    )
    existing_ob_ids: set[str] = {r[0] for r in ex_ob_res.fetchall()}

    # ── Livello 2: external_ids già in movimenti (GoCardless precedenti) ──
    ex_mov_res = await db.execute(
        select(Movimento.external_id)
        .where(Movimento.utente_id == conn.utente_id, Movimento.external_id.isnot(None))
    )
    existing_mov_ids: set[str] = {r[0] for r in ex_mov_res.fetchall()}

    # ── Livello 3: dedup fuzzy contro movimenti importati da CSV ──
    # Chiave: (data_operazione, importo_assoluto, desc_prefix_30_uppercase)
    # Intercetta i duplicati CSV↔GoCardless che hanno external_id diverso
    existing_fuzzy: set[tuple] = set()
    if conn.conto_id:
        fuzzy_res = await db.execute(
            select(Movimento.data_operazione, Movimento.importo, Movimento.descrizione)
            .where(
                Movimento.conto_id == conn.conto_id,
                Movimento.fonte != "gocardless",   # solo CSV/manuali, non GoCardless
            )
        )
        for r in fuzzy_res.fetchall():
            existing_fuzzy.add((
                r[0],                            # date
                abs(r[1]),                       # importo assoluto
                (r[2] or "")[:30].upper(),       # prefisso descrizione
            ))
    print(f"[OB] Dedup: {len(existing_ob_ids)} ob_ids, {len(existing_mov_ids)} mov_ids, {len(existing_fuzzy)} fuzzy CSV")

    # Mappa nome → id per le categorie spese
    cat_res = await db.execute(select(CategoriaSpesa))
    cat_map: dict[str, int] = {c.nome: c.id for c in cat_res.scalars().all()}

    booked  = trans_data.get("transactions", {}).get("booked", [])
    pending = trans_data.get("transactions", {}).get("pending", [])
    all_tx  = booked + pending

    nuove_ob  = 0   # ob_transazioni inserite
    nuove_mov = 0   # movimenti nuovi creati
    dup_ob    = 0   # ob_transazioni già presenti
    dup_mov   = 0   # movimenti già presenti (CSV o GoCardless precedente)
    errori: list[str] = []

    for tx in all_tx:
        try:
            tx_id = tx.get("transactionId") or tx.get("internalTransactionId")
            if not tx_id:
                continue

            if tx_id in existing_ob_ids:
                dup_ob += 1
                continue

            # Importo e valuta
            amount_info = tx.get("transactionAmount", {})
            importo  = Decimal(str(amount_info.get("amount", "0")))
            valuta   = amount_info.get("currency", "EUR")

            # Date
            booking_str = tx.get("bookingDate") or tx.get("valueDate")
            data_op = date.fromisoformat(booking_str) if booking_str else datetime.utcnow().date()
            data_val_str = tx.get("valueDate")
            data_val = date.fromisoformat(data_val_str) if data_val_str else None

            # Descrizione (prende il primo campo non vuoto)
            descrizione = next(
                (
                    tx.get(k, "").strip()
                    for k in [
                        "remittanceInformationUnstructured",
                        "remittanceInformationStructured",
                        "additionalInformation",
                        "creditorName",
                        "debtorName",
                    ]
                    if tx.get(k, "").strip()
                ),
                "",
            )

            # Saldo dopo transazione (se disponibile)
            saldo_dopo = None
            bal_after = tx.get("balanceAfterTransaction", {})
            if bal_after.get("balanceAmount", {}).get("amount"):
                saldo_dopo = Decimal(str(bal_after["balanceAmount"]["amount"]))

            # Salva transazione raw OB
            ob_tx = OBTransazione(
                utente_id=conn.utente_id,
                conto_id=conn.conto_id,
                connessione_id=conn.id,
                transaction_id=tx_id,
                data_operazione=data_op,
                data_valuta=data_val,
                importo=importo,
                valuta=valuta,
                descrizione=descrizione[:500] if descrizione else None,
                debitore_nome=tx.get("debtorName"),
                creditore_nome=tx.get("creditorName"),
                saldo_dopo=saldo_dopo,
                raw_data=tx,
            )
            db.add(ob_tx)
            existing_ob_ids.add(tx_id)

            # ── Crea movimento con dedup a 3 livelli ──
            ext_id    = f"ob_{tx_id}"
            abs_imp   = abs(importo)
            desc_key  = (descrizione or "")[:30].upper()
            fuzzy_key = (data_op, abs_imp, desc_key)

            # Livello 2: external_id GoCardless già presente
            # Livello 3: stessa data+importo+descrizione di un movimento CSV
            gia_in_movimenti = ext_id in existing_mov_ids or fuzzy_key in existing_fuzzy

            if not gia_in_movimenti:
                tipo = TipoMovimento.entrata if importo > 0 else TipoMovimento.uscita
                cat_nome = auto_categorizza(descrizione) if descrizione else "Altro"
                cat_id   = cat_map.get(cat_nome, cat_map.get("Altro"))

                mov = Movimento(
                    utente_id=conn.utente_id,
                    conto_id=conn.conto_id,
                    tipo=tipo,
                    importo=abs_imp,
                    descrizione=descrizione[:500] if descrizione else None,
                    data_operazione=data_op,
                    data_valuta=data_val,
                    fonte="gocardless",
                    external_id=ext_id,
                    categoria_id=cat_id,
                )
                db.add(mov)
                existing_mov_ids.add(ext_id)
                existing_fuzzy.add(fuzzy_key)   # previene doppioni nella stessa sync
                nuove_mov += 1
            else:
                dup_mov += 1
                print(f"[OB] Dup mov: {data_op} €{abs_imp} '{desc_key}'")

            nuove_ob += 1

        except Exception as e:
            errori.append(str(e))
            continue

    # Aggiorna saldo conto da GoCardless
    if conn.conto_id and bal_data.get("balances"):
        saldo_finale = None
        # Priorità: closingBooked > interimAvailable > expected
        for tipo_saldo in ("closingBooked", "interimAvailable", "expected"):
            for bal in bal_data["balances"]:
                if bal.get("balanceType") == tipo_saldo:
                    saldo_finale = Decimal(str(bal["balanceAmount"]["amount"]))
                    break
            if saldo_finale is not None:
                break

        if saldo_finale is not None:
            db.add(SaldoSnapshot(
                conto_id=conn.conto_id,
                saldo=saldo_finale,
                fonte="gocardless",
                rilevato_at=datetime.utcnow(),
            ))
            print(f"[OB] Saldo aggiornato: €{saldo_finale:.2f}")

    # Aggiorna stato connessione
    conn.last_sync = datetime.utcnow()
    conn.status    = "active"

    await db.commit()

    print(f"[OB] Sync completato: {nuove_ob} transazioni OB, {nuove_mov} movimenti nuovi, {dup_ob} dup-ob, {dup_mov} dup-csv/mov, {len(errori)} errori")
    return {
        "nuove_transazioni": nuove_ob,
        "nuovi_movimenti":   nuove_mov,
        "duplicate_ob":      dup_ob,
        "duplicate_csv":     dup_mov,
        "errori":            errori,
        "timestamp":         datetime.utcnow().isoformat(),
    }
