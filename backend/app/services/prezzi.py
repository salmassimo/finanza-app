"""
Servizio di aggiornamento prezzi.
Usa httpx direttamente per Yahoo Finance e CoinGecko per crypto.
Viene schedulato dal cron job giornaliero.
"""
import httpx
from decimal import Decimal
from datetime import datetime, date
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.models.models import Strumento, Posizione, PrezzoSnapshot, PosizioneSnapshot, PatrimonioSnapshot, TipoStrumento

YAHOO_BASE   = "https://query1.finance.yahoo.com/v8/finance/chart"
COINGECKO_BASE = "https://api.coingecko.com/api/v3"
CRYPTO_IDS = {"BTC": "bitcoin", "XRP": "ripple", "ETH": "ethereum", "SOL": "solana", "ADA": "cardano"}

# Simboli alternativi per ticker che Yahoo Finance non serve bene su alcune borse
TICKER_FALLBACK = {
    "IS3N.FRA": "IS3N.DE",
    "OM3M.FRA": "OM3M.DE",
}

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}


# ─── Prezzi real-time ──────────────────────────────────────────────────────────

async def _fx_to_eur(client: httpx.AsyncClient, valuta: str) -> float | None:
    """Tasso di cambio valuta→EUR da Yahoo (es. USDEUR=X)."""
    try:
        r = await client.get(f"{YAHOO_BASE}/{valuta}EUR=X", params={"interval": "1d", "range": "5d"})
        res = r.json().get("chart", {}).get("result", [])
        if not res:
            return None
        closes = [c for c in res[0].get("indicators", {}).get("quote", [{}])[0].get("close", []) if c is not None]
        return float(closes[-1]) if closes else None
    except Exception:
        return None


async def fetch_prezzo_yahoo(simbolo: str, _allow_strip: bool = True) -> float | None:
    """Recupera l'ultimo prezzo da Yahoo Finance (convertito in EUR se quotato in altra valuta)."""
    url = f"{YAHOO_BASE}/{simbolo}"
    params = {"interval": "1d", "range": "5d"}
    async with httpx.AsyncClient(timeout=15, headers=_HEADERS) as client:
        try:
            r = await client.get(url, params=params)
            data = r.json()
            result = data.get("chart", {}).get("result", [])
            if not result:
                # Suffissi stile Reuters/Refinitiv non validi su Yahoo (es. SPCX.O → SPCX)
                if _allow_strip and "." in simbolo:
                    base = simbolo.rsplit(".", 1)[0]
                    if base and base != simbolo and simbolo.upper().endswith(".O"):
                        print(f"[Yahoo] {simbolo} non trovato → riprovo {base}")
                        return await fetch_prezzo_yahoo(base, _allow_strip=False)
                print(f"[Yahoo] Nessun risultato per {simbolo}")
                return None
            meta = result[0].get("meta", {})
            closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
            closes_valid = [c for c in closes if c is not None]
            if not closes_valid:
                print(f"[Yahoo] Nessun close valido per {simbolo}")
                return None
            price = float(closes_valid[-1])
            valuta = (meta.get("currency") or "EUR").upper()
            if valuta and valuta != "EUR":
                rate = await _fx_to_eur(client, valuta)
                if rate:
                    price_eur = price * rate
                    print(f"[Yahoo] {simbolo} = {price:.4f} {valuta} → {price_eur:.4f} EUR (x{rate:.4f})")
                    return price_eur
                print(f"[Yahoo] {simbolo}: cambio {valuta}→EUR non disponibile, uso valore nativo")
            print(f"[Yahoo] {simbolo} = {price:.4f} {valuta}")
            return price
        except Exception as e:
            print(f"[Yahoo] Errore {simbolo}: {e}")
            return None


async def fetch_prezzi_crypto(simboli: list[str]) -> dict[str, float]:
    """Recupera prezzi crypto da CoinGecko in EUR."""
    ids = [CRYPTO_IDS.get(s) for s in simboli if CRYPTO_IDS.get(s)]
    if not ids:
        return {}
    url = f"{COINGECKO_BASE}/simple/price"
    params = {"ids": ",".join(ids), "vs_currencies": "eur"}
    async with httpx.AsyncClient(timeout=15, headers=_HEADERS) as client:
        try:
            r = await client.get(url, params=params)
            data = r.json()
            result = {}
            for sym in simboli:
                cg_id = CRYPTO_IDS.get(sym)
                if cg_id and cg_id in data:
                    result[sym] = data[cg_id]["eur"]
            return result
        except Exception as e:
            print(f"[CoinGecko] Errore: {e}")
            return {}


# ─── Serie storica per backfill ───────────────────────────────────────────────

async def fetch_storico_yahoo(simbolo: str, range_str: str = "1y") -> list[dict]:
    """
    Recupera serie storica giornaliera da Yahoo Finance.
    Ritorna lista di {date: datetime, close: float}.
    """
    url = f"{YAHOO_BASE}/{simbolo}"
    params = {"interval": "1d", "range": range_str}
    async with httpx.AsyncClient(timeout=30, headers=_HEADERS) as client:
        try:
            r = await client.get(url, params=params)
            data = r.json()
            result = data.get("chart", {}).get("result", [])
            if not result:
                print(f"[Yahoo Storico] Nessun dato per {simbolo}")
                return []
            timestamps = result[0].get("timestamp", [])
            closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
            history = []
            for ts, close in zip(timestamps, closes):
                if close is not None:
                    history.append({"date": datetime.fromtimestamp(ts), "close": float(close)})
            print(f"[Yahoo Storico] {simbolo}: {len(history)} punti ({range_str})")
            return history
        except Exception as e:
            print(f"[Yahoo Storico] Errore {simbolo}: {e}")
            return []


async def fetch_storico_crypto(simbolo: str, days: int = 365) -> list[dict]:
    """Recupera serie storica crypto da CoinGecko."""
    cg_id = CRYPTO_IDS.get(simbolo)
    if not cg_id:
        return []
    url = f"{COINGECKO_BASE}/coins/{cg_id}/market_chart"
    params = {"vs_currency": "eur", "days": str(days), "interval": "daily"}
    async with httpx.AsyncClient(timeout=30, headers=_HEADERS) as client:
        try:
            r = await client.get(url, params=params)
            data = r.json()
            history = []
            for ts_ms, price in data.get("prices", []):
                history.append({"date": datetime.fromtimestamp(ts_ms / 1000), "close": float(price)})
            print(f"[CoinGecko Storico] {simbolo}: {len(history)} punti")
            return history
        except Exception as e:
            print(f"[CoinGecko Storico] Errore {simbolo}: {e}")
            return []


# ─── Aggiornamento real-time ───────────────────────────────────────────────────

async def aggiorna_tutti_i_prezzi(db: AsyncSession, utente_id: str) -> dict:
    """
    Aggiorna i prezzi di tutti gli strumenti in portafoglio e salva gli snapshot.
    Chiamato dal cron job o manualmente dall'API.
    """
    now = datetime.utcnow()
    aggiornati = []
    errori = []

    result = await db.execute(
        select(Posizione)
        .options(selectinload(Posizione.strumento))
        .join(Strumento)
        .where(Posizione.utente_id == utente_id, Posizione.attivo == True)
    )
    posizioni = result.scalars().all()

    crypto_posizioni = [p for p in posizioni if p.strumento.tipo == TipoStrumento.crypto]
    other_posizioni  = [p for p in posizioni if p.strumento.tipo != TipoStrumento.crypto]

    crypto_prezzi = {}
    if crypto_posizioni:
        simboli_crypto = [p.strumento.simbolo for p in crypto_posizioni]
        crypto_prezzi = await fetch_prezzi_crypto(simboli_crypto)

    for pos in posizioni:
        simbolo = pos.strumento.simbolo
        prezzo = None

        if pos.strumento.tipo == TipoStrumento.conto_deposito:
            # Conto deposito: escluso da aggiornamento prezzi di mercato.
            # Matura interessi fissi di €0.35/giorno dall'ultimo snapshot.
            last_snap_res = await db.execute(
                select(PosizioneSnapshot.rilevato_at)
                .where(PosizioneSnapshot.posizione_id == pos.id)
                .order_by(PosizioneSnapshot.rilevato_at.desc())
                .limit(1)
            )
            last_dt = last_snap_res.scalar_one_or_none()
            giorni = max(0, (now - last_dt.replace(tzinfo=None)).days) if last_dt else 0
            if giorni > 0:
                interessi = Decimal("0.35") * giorni
                pos.quantita += interessi
                print(f"[Deposito] {simbolo}: +€{interessi:.2f} interessi ({giorni}gg) → saldo {pos.quantita:.2f}")
            else:
                print(f"[Deposito] {simbolo}: nessun interesse da maturare (0 giorni)")
            valore_mercato = pos.quantita
            var_eur = valore_mercato - pos.valore_carico
            var_pct = (var_eur / pos.valore_carico * 100) if pos.valore_carico else Decimal("0")
            db.add(PosizioneSnapshot(
                posizione_id=pos.id,
                quantita=pos.quantita,
                prezzo_mercato=Decimal("1"),
                valore_mercato=valore_mercato,
                var_eur=var_eur,
                var_pct=var_pct,
                rilevato_at=now
            ))
            aggiornati.append({"simbolo": simbolo, "prezzo": float(pos.quantita)})
            continue

        manuale = False
        if pos.strumento.tipo == TipoStrumento.crypto:
            prezzo = crypto_prezzi.get(simbolo)
        else:
            # Se l'ultimo prezzo è stato impostato manualmente (es. titoli non
            # quotati come SpaceX), non sovrascrivere con Yahoo: riporta avanti
            # il valore manuale così resta visibile e non genera errori.
            last_pr_res = await db.execute(
                select(PrezzoSnapshot)
                .where(PrezzoSnapshot.strumento_id == pos.strumento_id)
                .order_by(PrezzoSnapshot.rilevato_at.desc())
                .limit(1)
            )
            last_pr = last_pr_res.scalar_one_or_none()
            if last_pr is not None and last_pr.fonte == "manuale":
                prezzo = float(last_pr.prezzo)
                manuale = True
            else:
                prezzo = await fetch_prezzo_yahoo(simbolo)
                # Fallback su ticker alternativo se il primo fallisce
                if prezzo is None and simbolo in TICKER_FALLBACK:
                    alt = TICKER_FALLBACK[simbolo]
                    print(f"[Yahoo] Fallback {simbolo} → {alt}")
                    prezzo = await fetch_prezzo_yahoo(alt)

        if prezzo is None:
            errori.append(simbolo)
            continue

        prezzo_dec = Decimal(str(prezzo))

        db.add(PrezzoSnapshot(
            strumento_id=pos.strumento_id,
            prezzo=prezzo_dec,
            valuta="EUR",
            fonte="manuale" if manuale else ("coingecko" if pos.strumento.tipo == TipoStrumento.crypto else "yahoo"),
            rilevato_at=now
        ))

        valore_mercato = prezzo_dec * pos.quantita
        var_eur = valore_mercato - pos.valore_carico
        var_pct = (var_eur / pos.valore_carico * 100) if pos.valore_carico else Decimal("0")

        db.add(PosizioneSnapshot(
            posizione_id=pos.id,
            quantita=pos.quantita,
            prezzo_mercato=prezzo_dec,
            valore_mercato=valore_mercato,
            var_eur=var_eur,
            var_pct=var_pct,
            rilevato_at=now
        ))

        aggiornati.append({"simbolo": simbolo, "prezzo": prezzo})

    await db.flush()
    await _aggiorna_patrimonio_snapshot(db, utente_id, now)
    await db.commit()

    return {"aggiornati": aggiornati, "errori": errori, "timestamp": now.isoformat()}


# ─── Backfill storico ──────────────────────────────────────────────────────────

async def backfill_prezzi_storici(db: AsyncSession, utente_id: str, range_str: str = "1y") -> dict:
    """
    Backfill prezzi storici per tutte le posizioni attive.
    Inserisce PosizioneSnapshot giornalieri senza sovrascrivere quelli esistenti.
    """
    result = await db.execute(
        select(Posizione)
        .options(selectinload(Posizione.strumento))
        .join(Strumento)
        .where(Posizione.utente_id == utente_id, Posizione.attivo == True)
    )
    posizioni = result.scalars().all()

    totale_inseriti = 0
    errori = []

    for pos in posizioni:
        simbolo = pos.strumento.simbolo

        if pos.strumento.tipo == TipoStrumento.conto_deposito:
            # Conto deposito: storico non ha senso, salta
            print(f"[Backfill] {simbolo} saltato (conto deposito)")
            continue
        elif pos.strumento.tipo == TipoStrumento.crypto:
            try:
                days = {"6mo": 180, "1y": 365, "2y": 730}.get(range_str, 365)
            except Exception:
                days = 365
            history = await fetch_storico_crypto(simbolo, days=days)
        else:
            history = await fetch_storico_yahoo(simbolo, range_str=range_str)
            # Fallback ticker se il primo non funziona
            if not history and simbolo in TICKER_FALLBACK:
                alt = TICKER_FALLBACK[simbolo]
                print(f"[Backfill] Fallback {simbolo} → {alt}")
                history = await fetch_storico_yahoo(alt, range_str=range_str)

        if not history:
            errori.append(simbolo)
            continue

        # Date già presenti per questa posizione
        existing_res = await db.execute(
            select(PosizioneSnapshot.rilevato_at)
            .where(PosizioneSnapshot.posizione_id == pos.id)
        )
        existing_dates: set[date] = {r[0].date() for r in existing_res.fetchall()}

        inseriti = 0
        for point in history:
            dt: datetime = point["date"]
            if dt.date() in existing_dates:
                continue
            prezzo     = Decimal(str(round(point["close"], 6)))
            valore_mkt = prezzo * pos.quantita
            var_eur    = valore_mkt - pos.valore_carico
            var_pct    = (var_eur / pos.valore_carico * 100) if pos.valore_carico else Decimal("0")
            db.add(PosizioneSnapshot(
                posizione_id=pos.id,
                quantita=pos.quantita,
                prezzo_mercato=prezzo,
                valore_mercato=valore_mkt,
                var_eur=var_eur,
                var_pct=var_pct,
                rilevato_at=dt,
            ))
            inseriti += 1

        totale_inseriti += inseriti
        print(f"[Backfill] {simbolo}: {inseriti} snapshot inseriti")

    await db.commit()
    return {"inseriti": totale_inseriti, "errori": errori}


# ─── Patrimonio snapshot ───────────────────────────────────────────────────────

async def _aggiorna_patrimonio_snapshot(db: AsyncSession, utente_id: str, now: datetime):
    """Calcola e salva lo snapshot del patrimonio netto aggregato."""
    from app.models.models import (Conto, SaldoSnapshot, Mutuo, Immobile, ImmobileSnapshot,
                                    Orologio, OrologioSnapshot, TipoConto)

    conti_result = await db.execute(
        select(Conto).where(Conto.utente_id == utente_id, Conto.attivo == True)
    )
    conti = conti_result.scalars().all()

    liquidita = Decimal("0")
    for c in conti:
        if c.tipo not in (TipoConto.carta_credito, TipoConto.investimento):
            saldo_result = await db.execute(
                select(SaldoSnapshot.saldo)
                .where(SaldoSnapshot.conto_id == c.id)
                .order_by(SaldoSnapshot.rilevato_at.desc())
                .limit(1)
            )
            s = saldo_result.scalar_one_or_none()
            if s:
                liquidita += s

    pos_result = await db.execute(
        select(Posizione).where(Posizione.utente_id == utente_id, Posizione.attivo == True)
    )
    posizioni = pos_result.scalars().all()

    portafoglio_fineco  = Decimal("0")
    portafoglio_revolut = Decimal("0")
    for pos in posizioni:
        snap_result = await db.execute(
            select(PosizioneSnapshot.valore_mercato)
            .where(PosizioneSnapshot.posizione_id == pos.id)
            .order_by(PosizioneSnapshot.rilevato_at.desc())
            .limit(1)
        )
        vm = snap_result.scalar_one_or_none()
        if vm:
            if pos.piattaforma.value == "Revolut Investimenti":
                portafoglio_revolut += vm
            else:
                portafoglio_fineco += vm

    imm_result = await db.execute(
        select(Immobile).where(Immobile.utente_id == utente_id, Immobile.attivo == True)
    )
    immobili_valore = Decimal("0")
    for imm in imm_result.scalars().all():
        v_result = await db.execute(
            select(ImmobileSnapshot.valore_mercato)
            .where(ImmobileSnapshot.immobile_id == imm.id)
            .order_by(ImmobileSnapshot.rilevato_at.desc()).limit(1)
        )
        v = v_result.scalar_one_or_none()
        if v: immobili_valore += v

    orol_result = await db.execute(
        select(Orologio).where(Orologio.utente_id == utente_id, Orologio.attivo == True)
    )
    orologi_valore = Decimal("0")
    for or_ in orol_result.scalars().all():
        o_result = await db.execute(
            select(OrologioSnapshot)
            .where(OrologioSnapshot.orologio_id == or_.id)
            .order_by(OrologioSnapshot.rilevato_at.desc()).limit(1)
        )
        os = o_result.scalar_one_or_none()
        if os: orologi_valore += (os.stima_min + os.stima_max) / 2

    mutui_result = await db.execute(
        select(Mutuo).where(Mutuo.utente_id == utente_id, Mutuo.attivo == True)
    )
    mutui = mutui_result.scalars().all()
    mutuo_uc      = sum((m.capitale_residuo for m in mutui if "unicredit" in m.banca.lower()), Decimal("0"))
    mutuo_ca      = sum((m.capitale_residuo for m in mutui if "agricole" in m.banca.lower()), Decimal("0"))
    totale_passivo = mutuo_uc + mutuo_ca

    totale_asset    = liquidita + portafoglio_fineco + portafoglio_revolut + immobili_valore + orologi_valore
    patrimonio_netto = totale_asset - totale_passivo

    db.add(PatrimonioSnapshot(
        utente_id=utente_id,
        liquidita_totale=liquidita,
        portafoglio_fineco=portafoglio_fineco,
        portafoglio_revolut=portafoglio_revolut,
        immobili_valore=immobili_valore,
        orologi_valore=orologi_valore,
        totale_asset=totale_asset,
        mutuo_uc_residuo=mutuo_uc,
        mutuo_ca_residuo=mutuo_ca,
        carte_credito=Decimal("0"),
        totale_passivo=totale_passivo,
        patrimonio_netto=patrimonio_netto,
        rilevato_at=now
    ))
