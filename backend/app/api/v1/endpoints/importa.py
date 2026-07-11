import csv
import io
import tempfile
import os
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

import pandas as pd
from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.core.security import get_current_user
from app.models.models import (
    Conto, TipoConto, SaldoSnapshot,
    Mutuo, PianoAmmortamento,
    Immobile, ImmobileSnapshot,
    Strumento, Posizione, TipoStrumento, PiattaformaEnum,
    PosizioneSnapshot, PrezzoSnapshot,
    Orologio, OrologioSnapshot,
    Movimento, TipoMovimento,
)

router = APIRouter()


def _parse_csv(content: bytes) -> list[dict]:
    text = content.decode('utf-8-sig')
    return list(csv.DictReader(io.StringIO(text)))


def _dec(val: str) -> Decimal | None:
    if not val or not val.strip():
        return None
    try:
        return Decimal(val.strip().replace(',', '.').replace(' ', ''))
    except InvalidOperation:
        return None


def _date(val: str) -> date | None:
    if not val or not val.strip():
        return None
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y'):
        try:
            return datetime.strptime(val.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _bool(val: str) -> bool:
    return val.strip().lower() in ('true', '1', 'si', 'sì', 'yes')


def _str(row: dict, key: str) -> str | None:
    v = row.get(key, '').strip()
    return v or None


# ── CONTI ────────────────────────────────────────────────────────────────────
@router.post("/conti")
async def importa_conti(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Colonne CSV: nome, tipo, banca, iban, valuta, saldo, note
    tipo: conto_corrente | deposito | carta_credito | investimento | altro
    """
    rows = _parse_csv(await file.read())
    imported, errors = 0, []
    for i, row in enumerate(rows, 1):
        try:
            tipo_str = row.get('tipo', 'conto_corrente').strip().lower()
            tipo = TipoConto(tipo_str) if tipo_str in TipoConto._value2member_map_ else TipoConto.conto_corrente
            conto = Conto(
                utente_id=current_user.id,
                nome=row['nome'].strip(),
                tipo=tipo,
                banca=_str(row, 'banca'),
                iban=_str(row, 'iban'),
                valuta=row.get('valuta', 'EUR').strip() or 'EUR',
                note=_str(row, 'note'),
            )
            db.add(conto)
            await db.flush()
            saldo = _dec(row.get('saldo', ''))
            if saldo is not None:
                db.add(SaldoSnapshot(conto_id=conto.id, saldo=saldo, fonte='importazione'))
            imported += 1
        except Exception as e:
            errors.append(f"Riga {i}: {e}")
    await db.commit()
    return {"importati": imported, "errori": errors}


# ── MUTUI ────────────────────────────────────────────────────────────────────
@router.post("/mutui")
async def importa_mutui(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Colonne CSV: nome, banca, numero_contratto, capitale_erogato, capitale_residuo,
                 tasso_tipo, tasso_valore, rata_mensile, rate_totali, rate_pagate,
                 data_erogazione (YYYY-MM-DD), data_scadenza (YYYY-MM-DD)
    """
    rows = _parse_csv(await file.read())
    imported, errors = 0, []
    for i, row in enumerate(rows, 1):
        try:
            db.add(Mutuo(
                utente_id=current_user.id,
                nome=row['nome'].strip(),
                banca=row['banca'].strip(),
                numero_contratto=_str(row, 'numero_contratto'),
                capitale_erogato=_dec(row['capitale_erogato']),
                capitale_residuo=_dec(row['capitale_residuo']),
                tasso_tipo=row.get('tasso_tipo', 'fisso').strip() or 'fisso',
                tasso_valore=_dec(row.get('tasso_valore', '')),
                rata_mensile=_dec(row['rata_mensile']),
                rate_totali=int(row['rate_totali']),
                rate_pagate=int(row.get('rate_pagate', 0) or 0),
                data_erogazione=_date(row['data_erogazione']),
                data_scadenza=_date(row['data_scadenza']),
            ))
            imported += 1
        except Exception as e:
            errors.append(f"Riga {i}: {e}")
    await db.commit()
    return {"importati": imported, "errori": errors}


# ── PIANO AMMORTAMENTO ───────────────────────────────────────────────────────
@router.post("/piano-ammortamento")
async def importa_piano(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Colonne CSV: mutuo_nome, numero_rata, data_scadenza, quota_capitale,
                 quota_interessi, rata_totale, pagata (true/false), data_pagamento
    """
    rows = _parse_csv(await file.read())
    imported, errors = 0, []
    mutuo_cache: dict[str, object] = {}
    for i, row in enumerate(rows, 1):
        try:
            nome = row.get('mutuo_nome', '').strip()
            if nome not in mutuo_cache:
                res = await db.execute(
                    select(Mutuo).where(Mutuo.utente_id == current_user.id, Mutuo.nome == nome)
                )
                m = res.scalar_one_or_none()
                if not m:
                    errors.append(f"Riga {i}: mutuo '{nome}' non trovato — importalo prima")
                    continue
                mutuo_cache[nome] = m.id
            db.add(PianoAmmortamento(
                mutuo_id=mutuo_cache[nome],
                numero_rata=int(row['numero_rata']),
                data_scadenza=_date(row['data_scadenza']),
                quota_capitale=_dec(row['quota_capitale']),
                quota_interessi=_dec(row['quota_interessi']),
                rata_totale=_dec(row['rata_totale']),
                pagata=_bool(row.get('pagata', 'false')),
                data_pagamento=_date(row.get('data_pagamento', '')),
            ))
            imported += 1
        except Exception as e:
            errors.append(f"Riga {i}: {e}")
    await db.commit()
    return {"importati": imported, "errori": errors}


# ── IMMOBILI ─────────────────────────────────────────────────────────────────
@router.post("/immobili")
async def importa_immobili(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Colonne CSV: nome, descrizione, indirizzo, tipo, superficie_mq,
                 valore_acquisto, data_acquisto (YYYY-MM-DD), valore_mercato
    """
    rows = _parse_csv(await file.read())
    imported, errors = 0, []
    for i, row in enumerate(rows, 1):
        try:
            immobile = Immobile(
                utente_id=current_user.id,
                nome=row['nome'].strip(),
                descrizione=_str(row, 'descrizione'),
                indirizzo=_str(row, 'indirizzo'),
                tipo=row.get('tipo', 'residenziale').strip() or 'residenziale',
                superficie_mq=_dec(row.get('superficie_mq', '')),
                valore_acquisto=_dec(row.get('valore_acquisto', '')),
                data_acquisto=_date(row.get('data_acquisto', '')),
            )
            db.add(immobile)
            await db.flush()
            vm = _dec(row.get('valore_mercato', ''))
            if vm:
                db.add(ImmobileSnapshot(immobile_id=immobile.id, valore_mercato=vm, fonte='importazione'))
            imported += 1
        except Exception as e:
            errors.append(f"Riga {i}: {e}")
    await db.commit()
    return {"importati": imported, "errori": errors}


# ── PORTAFOGLIO ──────────────────────────────────────────────────────────────
@router.post("/portafoglio")
async def importa_portafoglio(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Colonne CSV: simbolo, isin, nome, tipo (etf|azione|obbligazione|crypto|fondo|altro),
                 piattaforma (Fineco|Revolut Investimenti|altro),
                 quantita, prezzo_carico, valore_carico, data_primo_acquisto, note
    """
    rows = _parse_csv(await file.read())
    imported, errors = 0, []
    for i, row in enumerate(rows, 1):
        try:
            simbolo = row['simbolo'].strip().upper()
            res = await db.execute(select(Strumento).where(Strumento.simbolo == simbolo))
            strumento = res.scalar_one_or_none()
            if not strumento:
                tipo_str = row.get('tipo', 'etf').strip().lower()
                tipo = TipoStrumento(tipo_str) if tipo_str in TipoStrumento._value2member_map_ else TipoStrumento.altro
                strumento = Strumento(
                    simbolo=simbolo,
                    isin=_str(row, 'isin'),
                    nome=row.get('nome', simbolo).strip(),
                    tipo=tipo,
                    valuta=row.get('valuta', 'EUR').strip() or 'EUR',
                    mercato=_str(row, 'mercato'),
                )
                db.add(strumento)
                await db.flush()

            try:
                piattaforma = PiattaformaEnum(row.get('piattaforma', 'Fineco').strip())
            except ValueError:
                piattaforma = PiattaformaEnum.altro

            quantita = _dec(row['quantita'])
            prezzo_carico = _dec(row['prezzo_carico'])
            valore_carico = _dec(row.get('valore_carico', '')) or (quantita * prezzo_carico)

            db.add(Posizione(
                utente_id=current_user.id,
                strumento_id=strumento.id,
                piattaforma=piattaforma,
                quantita=quantita,
                prezzo_carico=prezzo_carico,
                valore_carico=valore_carico,
                data_primo_acquisto=_date(row.get('data_primo_acquisto', '')),
                note=_str(row, 'note'),
            ))
            imported += 1
        except Exception as e:
            errors.append(f"Riga {i}: {e}")
    await db.commit()
    return {"importati": imported, "errori": errors}


# ── OROLOGI ──────────────────────────────────────────────────────────────────
@router.post("/orologi")
async def importa_orologi(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Colonne CSV: marca, modello, riferimento, anno_acquisto, prezzo_acquisto,
                 stima_min, stima_max, note
    """
    rows = _parse_csv(await file.read())
    imported, errors = 0, []
    for i, row in enumerate(rows, 1):
        try:
            anno_str = row.get('anno_acquisto', '').strip()
            orologio = Orologio(
                utente_id=current_user.id,
                marca=row['marca'].strip(),
                modello=row['modello'].strip(),
                riferimento=_str(row, 'riferimento'),
                anno_acquisto=int(anno_str) if anno_str else None,
                prezzo_acquisto=_dec(row.get('prezzo_acquisto', '')),
                note=_str(row, 'note'),
            )
            db.add(orologio)
            await db.flush()
            stima_min = _dec(row.get('stima_min', ''))
            stima_max = _dec(row.get('stima_max', ''))
            if stima_min and stima_max:
                db.add(OrologioSnapshot(
                    orologio_id=orologio.id,
                    stima_min=stima_min,
                    stima_max=stima_max,
                    fonte='importazione',
                ))
            imported += 1
        except Exception as e:
            errors.append(f"Riga {i}: {e}")
    await db.commit()
    return {"importati": imported, "errori": errors}


# ── MOVIMENTI ────────────────────────────────────────────────────────────────
@router.post("/movimenti")
async def importa_movimenti(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Colonne CSV: tipo (entrata|uscita|trasferimento|investimento|altro),
                 importo, descrizione, data_operazione (YYYY-MM-DD), conto_nome, note
    """
    rows = _parse_csv(await file.read())
    imported, errors = 0, []
    conti_cache: dict[str, object] = {}
    for i, row in enumerate(rows, 1):
        try:
            tipo_str = row.get('tipo', 'uscita').strip().lower()
            tipo = TipoMovimento(tipo_str) if tipo_str in TipoMovimento._value2member_map_ else TipoMovimento.uscita
            conto_id = None
            conto_nome = row.get('conto_nome', '').strip()
            if conto_nome:
                if conto_nome not in conti_cache:
                    res = await db.execute(
                        select(Conto).where(Conto.utente_id == current_user.id, Conto.nome == conto_nome)
                    )
                    c = res.scalar_one_or_none()
                    conti_cache[conto_nome] = c.id if c else None
                conto_id = conti_cache[conto_nome]
            db.add(Movimento(
                utente_id=current_user.id,
                conto_id=conto_id,
                tipo=tipo,
                importo=_dec(row['importo']),
                descrizione=_str(row, 'descrizione'),
                data_operazione=_date(row['data_operazione']),
                fonte='importazione',
                note=_str(row, 'note'),
            ))
            imported += 1
        except Exception as e:
            errors.append(f"Riga {i}: {e}")
    await db.commit()
    return {"importati": imported, "errori": errors}


# ── FINECO PORTAFOGLIO XLS ────────────────────────────────────────────────────
_TIPO_MAP = {
    "etf": TipoStrumento.etf, "azione": TipoStrumento.azione,
    "obbligazione": TipoStrumento.obbligazione, "fondo": TipoStrumento.fondo,
    "crypto": TipoStrumento.crypto,
}


def _parse_fineco_xls(content: bytes, filename: str) -> list[dict]:
    suffix = ".xlsx" if filename.lower().endswith(".xlsx") else ".xls"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(content)
        tmp = f.name
    try:
        engine = "openpyxl" if suffix == ".xlsx" else "xlrd"
        df = pd.read_excel(tmp, sheet_name=0, header=None, engine=engine)
    finally:
        os.unlink(tmp)

    header_row = None
    for idx, row in df.iterrows():
        if any(str(v).strip().upper() == "ISIN" for v in row):
            header_row = idx
            break
    if header_row is None:
        raise ValueError("Header row con 'ISIN' non trovata nel file")

    df.columns = [str(v).strip() for v in df.iloc[header_row]]
    df = df.iloc[header_row + 1:].reset_index(drop=True)

    rows = []
    for _, r in df.iterrows():
        titolo = str(r.get("Titolo", "")).strip()
        if not titolo or titolo.lower() in ("nan", "totale"):
            break
        isin = str(r.get("ISIN", "")).strip()
        if not isin or isin.lower() == "nan":
            continue
        quantita = next((r[k] for k in r.index if "uant" in str(k)), None)
        valore_mercato = next((r[k] for k in r.index if "mercato" in str(k).lower() and ("\u20ac" in str(k) or str(k).lower().endswith("mercato"))), None)
        var_eur = next((r[k] for k in r.index if str(k).strip().lower() in ("var \u20ac", "var \u20ac", "var")), None)
        rows.append({
            "titolo": titolo, "isin": isin,
            "simbolo": str(r.get("Simbolo", "")).strip(),
            "mercato": str(r.get("Mercato", "")).strip(),
            "strumento": str(r.get("Strumento", "")).strip().lower(),
            "valuta": str(r.get("Valuta", "EUR")).strip(),
            "quantita": quantita,
            "prezzo_carico": r.get("P.zo medio di carico"),
            "valore_carico": r.get("Valore di carico"),
            "prezzo_mercato": r.get("P.zo di mercato"),
            "valore_mercato": valore_mercato,
            "var_pct": r.get("Var%"),
            "var_eur": var_eur,
        })
    return rows


@router.post("/fineco-portafoglio")
async def importa_fineco_portafoglio(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from app.models.models import PosizioneSnapshot
    from fastapi import HTTPException
    now = datetime.utcnow()
    content = await file.read()
    try:
        rows = _parse_fineco_xls(content, file.filename or "export.xls")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Errore lettura file: {e}")

    creati, aggiornati, snapshot_count, errors = 0, 0, 0, []
    isin_nel_file: set[str] = set()

    for i, row in enumerate(rows, 1):
        try:
            isin = row["isin"]
            isin_nel_file.add(isin)

            def to_dec(v):
                if v is None:
                    return Decimal("0")
                try:
                    f = float(v)
                    return Decimal("0") if f != f else Decimal(str(round(f, 10)))
                except (TypeError, ValueError):
                    return Decimal("0")

            quantita       = to_dec(row["quantita"])
            prezzo_carico  = to_dec(row["prezzo_carico"])
            valore_carico  = to_dec(row["valore_carico"]) or quantita * prezzo_carico
            prezzo_mercato = to_dec(row["prezzo_mercato"])
            valore_mercato = to_dec(row["valore_mercato"]) or (prezzo_mercato * quantita)
            var_pct        = to_dec(row["var_pct"])
            var_eur        = to_dec(row["var_eur"])

            res = await db.execute(select(Strumento).where(Strumento.isin == isin))
            strumento = res.scalar_one_or_none()
            if not strumento:
                tipo = _TIPO_MAP.get(row["strumento"], TipoStrumento.altro)
                strumento = Strumento(
                    simbolo=row["simbolo"] or isin, isin=isin, nome=row["titolo"],
                    tipo=tipo, valuta=row["valuta"] or "EUR", mercato=row["mercato"] or None,
                )
                db.add(strumento)
                await db.flush()

            res = await db.execute(
                select(Posizione).where(
                    Posizione.utente_id == current_user.id,
                    Posizione.strumento_id == strumento.id,
                    Posizione.piattaforma == PiattaformaEnum.fineco,
                )
            )
            posizione = res.scalar_one_or_none()
            if posizione:
                posizione.quantita = quantita
                posizione.prezzo_carico = prezzo_carico
                posizione.valore_carico = valore_carico
                posizione.attivo = True
                aggiornati += 1
            else:
                posizione = Posizione(
                    utente_id=current_user.id, strumento_id=strumento.id,
                    piattaforma=PiattaformaEnum.fineco,
                    quantita=quantita, prezzo_carico=prezzo_carico, valore_carico=valore_carico,
                )
                db.add(posizione)
                await db.flush()
                creati += 1

            db.add(PosizioneSnapshot(
                posizione_id=posizione.id, quantita=quantita,
                prezzo_mercato=prezzo_mercato, valore_mercato=valore_mercato,
                var_eur=var_eur, var_pct=var_pct, rilevato_at=now,
            ))
            snapshot_count += 1
        except Exception as e:
            errors.append(f"Riga {i} ({row.get('isin','?')}): {e}")

    disattivati = 0
    res = await db.execute(
        select(Posizione).where(
            Posizione.utente_id == current_user.id,
            Posizione.piattaforma == PiattaformaEnum.fineco,
            Posizione.attivo == True,
        )
    )
    for pos in res.scalars().all():
        s_res = await db.execute(select(Strumento).where(Strumento.id == pos.strumento_id))
        s = s_res.scalar_one_or_none()
        if s and s.isin and s.isin not in isin_nel_file:
            pos.attivo = False
            disattivati += 1

    await db.commit()
    return {
        "creati": creati, "aggiornati": aggiornati, "disattivati": disattivati,
        "snapshot": snapshot_count, "errori": errors, "timestamp": now.isoformat(),
    }


# ── HELPERS UNICREDIT ─────────────────────────────────────────────────────────

def _excel_date_to_date(val) -> date | None:
    """Converte serial Excel (float) in date."""
    try:
        n = int(float(val))
        # Excel epoch = 1900-01-01, con bug bisestile 1900
        from datetime import timedelta
        base = date(1899, 12, 30)
        return base + timedelta(days=n)
    except Exception:
        return None

def _parse_date_it(val: str) -> date | None:
    """Converte DD/MM/YYYY in date."""
    try:
        return datetime.strptime(str(val).strip(), "%d/%m/%Y").date()
    except Exception:
        return None

def _importo_dec(val) -> Decimal:
    try:
        return Decimal(str(val)).quantize(Decimal("0.01"))
    except Exception:
        return Decimal("0")

def _ext_id(parts: list) -> str:
    import hashlib
    return hashlib.md5("|".join(str(p) for p in parts).encode()).hexdigest()


async def _get_or_create_conto(db: AsyncSession, utente_id, nome: str, tipo: str, banca: str, iban: str | None = None):
    from app.models.models import TipoConto as TC
    tipo_enum = TC(tipo) if tipo in TC._value2member_map_ else TC.altro
    res = await db.execute(select(Conto).where(Conto.utente_id == utente_id, Conto.nome == nome))
    c = res.scalar_one_or_none()
    if not c:
        c = Conto(utente_id=utente_id, nome=nome, tipo=tipo_enum, banca=banca, iban=iban)
        db.add(c)
        await db.flush()
    return c


async def _get_categoria_id(db: AsyncSession, nome: str) -> int | None:
    from app.models.models import CategoriaSpesa
    res = await db.execute(select(CategoriaSpesa).where(CategoriaSpesa.nome == nome))
    c = res.scalar_one_or_none()
    return c.id if c else None


# ── IMPORT UNICREDIT CONTO CORRENTE ──────────────────────────────────────────

@router.post("/unicredit-conto")
async def importa_unicredit_conto(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from app.services.categorizza import auto_categorizza
    from fastapi import HTTPException
    import xlrd

    content = await file.read()
    try:
        wb = xlrd.open_workbook(file_contents=content)
        ws = wb.sheet_by_index(0)
    except Exception as e:
        raise HTTPException(400, f"Errore apertura file: {e}")

    # Estrai IBAN e saldo dall'intestazione (scansiona tutte le righe pre-header)
    import re
    iban = None
    saldo_contabile = None
    max_header_scan = min(ws.nrows, 10)
    for i in range(max_header_scan):
        row_val = str(ws.cell_value(i, 0))
        if iban is None and "IT" in row_val and len(row_val) > 10:
            # es: "Rapporto IT 48 R 02008 05226 000102950820EUR - ..."
            parts = row_val.split("-")[0].strip().split()
            iban_parts = [p for p in parts if p not in ("Rapporto", "EUR")]
            iban = "".join(iban_parts[:7]) if len(iban_parts) >= 7 else None
        if saldo_contabile is None and "saldo contabile" in row_val.lower():
            m = re.search(r"([\d\.]+,\d+)", row_val)
            if m:
                saldo_contabile = Decimal(m.group(1).replace(".", "").replace(",", "."))
        if iban and saldo_contabile:
            break

    # Conto corrente
    conto = await _get_or_create_conto(
        db, current_user.id,
        "Conto Corrente UniCredit", "conto_corrente", "UniCredit", iban
    )

    # Salva saldo — rilevato_at = now garantisce che vinca su snapshot precedenti
    if saldo_contabile:
        db.add(SaldoSnapshot(
            conto_id=conto.id,
            saldo=saldo_contabile,
            fonte="unicredit_xls",
            rilevato_at=datetime.utcnow(),
        ))

    # Trova riga header (case-insensitive: UniCredit usa "Data registrazione")
    header_row = None
    for i in range(ws.nrows):
        if str(ws.cell_value(i, 0)).strip().lower().startswith("data registr"):
            header_row = i
            break
    if header_row is None:
        raise HTTPException(400, "Header non trovato nel file")

    importati, saltati, errori = 0, 0, []
    for i in range(header_row + 1, ws.nrows):
        try:
            data_reg_raw = ws.cell_value(i, 0)
            data_val_raw = ws.cell_value(i, 1)
            causale      = str(ws.cell_value(i, 2)).strip()
            descrizione  = str(ws.cell_value(i, 3)).strip()
            importo_raw  = ws.cell_value(i, 4)

            if not data_reg_raw or not importo_raw:
                continue

            data_op  = _excel_date_to_date(data_reg_raw)
            data_val = _excel_date_to_date(data_val_raw)
            importo  = _importo_dec(importo_raw)
            if not data_op:
                continue

            ext_id = _ext_id([data_op, causale, importo, descrizione[:50]])
            exists = await db.execute(select(Movimento).where(Movimento.external_id == ext_id))
            if exists.scalar_one_or_none():
                saltati += 1
                continue

            tipo = TipoMovimento.entrata if importo > 0 else TipoMovimento.uscita
            cat_nome = auto_categorizza(descrizione, causale)
            cat_id   = await _get_categoria_id(db, cat_nome)

            db.add(Movimento(
                utente_id=current_user.id,
                conto_id=conto.id,
                tipo=tipo,
                importo=importo,
                descrizione=descrizione[:250],
                data_operazione=data_op,
                data_valuta=data_val,
                causale=causale[:20] if causale else None,
                is_carta_credito=False,
                fonte="unicredit_conto",
                external_id=ext_id,
                categoria_id=cat_id,
            ))
            importati += 1
        except Exception as e:
            errori.append(f"Riga {i}: {e}")

    await db.commit()
    return {
        "importati": importati,
        "saltati": saltati,
        "errori": errori,
        "saldo_contabile": float(saldo_contabile) if saldo_contabile else None,
    }


# ── IMPORT UNICREDIT CARTA DI CREDITO ────────────────────────────────────────

@router.post("/unicredit-carta")
async def importa_unicredit_carta(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from app.services.categorizza import auto_categorizza
    from fastapi import HTTPException
    import xlrd

    content = await file.read()
    try:
        wb = xlrd.open_workbook(file_contents=content)
        ws = wb.sheet_by_index(0)
    except Exception as e:
        raise HTTPException(400, f"Errore apertura file: {e}")

    conto = await _get_or_create_conto(
        db, current_user.id,
        "Carta UniCredit Flexia Gold", "carta_credito", "UniCredit"
    )

    # Trova header e mappa le colonne per nome (robusto a vecchio/nuovo formato UniCredit)
    header_row = None
    cols: dict[str, int] = {}
    for i in range(min(ws.nrows, 15)):
        row = [str(ws.cell_value(i, c)).strip().lower() for c in range(ws.ncols)]
        if any(h.startswith("data") for h in row) and any("importo" in h for h in row) and any("descriz" in h for h in row):
            for c, h in enumerate(row):
                if "valuta" in h:
                    cols["valuta"] = c
                elif h.startswith("data"):
                    cols["data"] = c
                elif h.startswith("ora"):
                    cols["ora"] = c
                elif "descriz" in h:
                    cols["descr"] = c
                elif "importo" in h:
                    cols["importo"] = c
            header_row = i
            break
    if header_row is None or not {"data", "descr", "importo"} <= cols.keys():
        raise HTTPException(400, "Header non trovato (colonne Data/Descrizione/Importo)")

    importati, saltati, errori = 0, 0, []
    for i in range(header_row + 1, ws.nrows):
        try:
            data_reg_raw = str(ws.cell_value(i, cols["data"])).strip()
            ora          = str(ws.cell_value(i, cols["ora"])).strip() if "ora" in cols else ""
            data_val_raw = str(ws.cell_value(i, cols["valuta"])).strip() if "valuta" in cols else data_reg_raw
            descrizione  = str(ws.cell_value(i, cols["descr"])).strip()
            importo_raw  = ws.cell_value(i, cols["importo"])

            if not data_reg_raw or importo_raw in ("", None):
                continue

            data_op  = _parse_date_it(data_reg_raw)
            data_val = _parse_date_it(data_val_raw)
            importo  = _importo_dec(importo_raw)
            if not data_op:
                continue

            ext_id = _ext_id(["carta", data_reg_raw, ora, importo, descrizione[:50]])
            exists = await db.execute(select(Movimento).where(Movimento.external_id == ext_id))
            if exists.scalar_one_or_none():
                saltati += 1
                continue

            tipo = TipoMovimento.entrata if importo > 0 else TipoMovimento.uscita
            cat_nome = auto_categorizza(descrizione)
            cat_id   = await _get_categoria_id(db, cat_nome)

            db.add(Movimento(
                utente_id=current_user.id,
                conto_id=conto.id,
                tipo=tipo,
                importo=importo,
                descrizione=descrizione[:250],
                data_operazione=data_op,
                data_valuta=data_val,
                is_carta_credito=True,
                fonte="unicredit_carta",
                external_id=ext_id,
                categoria_id=cat_id,
            ))
            importati += 1
        except Exception as e:
            errori.append(f"Riga {i}: {e}")

    await db.commit()
    return {"importati": importati, "saltati": saltati, "errori": errori}


# ── IMPORT MUTUO UNICREDIT (PDF) ─────────────────────────────────────────────

@router.post("/unicredit-mutuo")
async def importa_unicredit_mutuo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from fastapi import HTTPException
    import re

    content = await file.read()
    try:
        import pdfplumber
        import io as _io
        text = ""
        with pdfplumber.open(_io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                text += page.extract_text() or ""
    except Exception as e:
        raise HTTPException(400, f"Errore lettura PDF: {e}")

    # Estrai intestazione
    num_match      = re.search(r"Numero\s+(\d+)", text)
    cap_er_match   = re.search(r"Capitale erogato\s+([\d\.]+,\d+)", text)
    cap_res_match  = re.search(r"Capitale residuo\s+([\d\.]+,\d+)", text)
    n_rate_match   = re.search(r"Numero rate\s+(\d+)", text)
    data_er_match  = re.search(r"Data di erogazione\s+(\d{2}/\d{2}/\d{4})", text)

    if not num_match:
        raise HTTPException(400, "Numero contratto non trovato nel PDF")

    numero_contratto = num_match.group(1)
    capitale_erogato = Decimal(cap_er_match.group(1).replace(".", "").replace(",", ".")) if cap_er_match else Decimal("0")
    capitale_residuo = Decimal(cap_res_match.group(1).replace(".", "").replace(",", ".")) if cap_res_match else Decimal("0")
    rate_totali      = int(n_rate_match.group(1)) if n_rate_match else 240
    data_erogazione  = datetime.strptime(data_er_match.group(1), "%d/%m/%Y").date() if data_er_match else date(2022, 3, 4)

    # Upsert mutuo
    res = await db.execute(
        select(Mutuo).where(Mutuo.utente_id == current_user.id, Mutuo.numero_contratto == numero_contratto)
    )
    mutuo = res.scalar_one_or_none()

    # Calcola data scadenza (ultima rata) e rata mensile dalla tabella
    # pdfplumber merge: "1 01/05/2022406,76 246,13 655,89" (no space between date and q_cap)
    rate_lines = re.findall(
        r"(\d+)\s+(\d{2}/\d{2}/\d{4})([\d\.]+,\d+)\s+([\d\.]+,\d+)\s+([\d\.]+,\d+)", text
    )

    if not rate_lines:
        raise HTTPException(400, "Piano ammortamento non trovato nel PDF")

    # Usa il valore di rata più comune (escludendo la prima rata che può essere parziale)
    from collections import Counter
    all_rate_vals = [Decimal(line[4].replace(".", "").replace(",", ".")) for line in rate_lines]
    # Escludi la prima rata se tutte le altre sono uguali (rata parziale/pre-ammortamento)
    regular_rates = all_rate_vals[1:] if len(all_rate_vals) > 1 else all_rate_vals
    rata_mensile = Counter(regular_rates).most_common(1)[0][0]
    data_scadenza = datetime.strptime(rate_lines[-1][1], "%d/%m/%Y").date()

    # Calcola TAN da rata standard (French amortization): r_monthly = quota_interessi / capitale_prima
    # Usa la seconda rata (indice 1) dove capitale_prima = capitale_erogato - quota_cap_rata1
    cap_prima_2 = capitale_erogato - Decimal(rate_lines[0][2].replace(".", "").replace(",", "."))
    int_rata_2  = Decimal(rate_lines[1][3].replace(".", "").replace(",", ".")) if len(rate_lines) > 1 else Decimal("0")
    tasso_valore_pct = round((float(int_rata_2) / float(cap_prima_2)) * 12 * 100, 4) if cap_prima_2 > 0 else None

    if not mutuo:
        mutuo = Mutuo(
            utente_id=current_user.id,
            nome=f"Mutuo Focene UniCredit {numero_contratto}",
            banca="UniCredit",
            numero_contratto=numero_contratto,
            capitale_erogato=capitale_erogato,
            capitale_residuo=capitale_residuo,
            tasso_tipo="fisso",
            tasso_valore=Decimal(str(tasso_valore_pct)) if tasso_valore_pct else None,
            rata_mensile=rata_mensile,
            rate_totali=rate_totali,
            rate_pagate=rate_totali - len([r for r in rate_lines if datetime.strptime(r[1], "%d/%m/%Y").date() > date.today()]),
            data_erogazione=data_erogazione,
            data_scadenza=data_scadenza,
        )
        db.add(mutuo)
        await db.flush()
    else:
        mutuo.capitale_residuo = capitale_residuo
        mutuo.rata_mensile     = rata_mensile
        mutuo.tasso_valore     = Decimal(str(tasso_valore_pct)) if tasso_valore_pct else mutuo.tasso_valore
        mutuo.data_scadenza    = data_scadenza
        # Elimina vecchio piano
        old_piano = await db.execute(select(PianoAmmortamento).where(PianoAmmortamento.mutuo_id == mutuo.id))
        for r in old_piano.scalars().all():
            await db.delete(r)
        await db.flush()

    # Parsa le rate in un dizionario per numero (il PDF può saltare righe sui
    # cambi pagina → le ricostruiamo dalla formula di ammortamento).
    parsed: dict[int, dict] = {}
    for line in rate_lines:
        numero = int(line[0])
        parsed[numero] = {
            "scad":   datetime.strptime(line[1], "%d/%m/%Y").date(),
            "q_cap":  Decimal(line[2].replace(".", "").replace(",", ".")),
            "q_int":  Decimal(line[3].replace(".", "").replace(",", ".")),
            "totale": Decimal(line[4].replace(".", "").replace(",", ".")),
        }

    from calendar import monthrange as _monthrange

    def _add_months(d: date, k: int) -> date:
        m0 = d.month - 1 + k
        y = d.year + m0 // 12
        mth = m0 % 12 + 1
        return date(y, mth, min(d.day, _monthrange(y, mth)[1]))

    n_max       = max(rate_totali, max(parsed.keys()))
    first_date  = parsed[min(parsed.keys())]["scad"]
    i_mensile   = (Decimal(str(tasso_valore_pct)) / Decimal("100") / Decimal("12")) if tasso_valore_pct else Decimal("0")

    cumulativo_cap = Decimal("0")
    ricostruite = 0
    for n in range(1, n_max + 1):
        r = parsed.get(n)
        if r is not None:
            q_cap, q_int, totale, scad = r["q_cap"], r["q_int"], r["totale"], r["scad"]
        else:
            # Rata mancante (salto pagina PDF): ricostruzione French amortization
            residuo_before = capitale_erogato - cumulativo_cap
            q_int  = (residuo_before * i_mensile).quantize(Decimal("0.01"))
            q_cap  = (rata_mensile - q_int).quantize(Decimal("0.01"))
            totale = rata_mensile
            scad   = _add_months(first_date, n - 1)
            ricostruite += 1
        cumulativo_cap += q_cap
        db.add(PianoAmmortamento(
            mutuo_id=mutuo.id,
            numero_rata=n,
            data_scadenza=scad,
            quota_capitale=q_cap,
            quota_interessi=q_int,
            rata_totale=totale,
            pagata=scad <= date.today(),
        ))

    await db.commit()
    return {
        "numero_contratto": numero_contratto,
        "rate_importate": len(parsed),
        "rate_ricostruite": ricostruite,
        "rate_totali_piano": n_max,
        "capitale_erogato": str(capitale_erogato),
        "capitale_residuo": str(capitale_residuo),
    }


# ── IMPORT MUTUO CRÉDIT AGRICOLE (EXCEL) ─────────────────────────────────────

def _dec_it(val) -> Decimal:
    """Parse Italian-formatted decimal from Excel cell value (e.g. '530.000,00' or float)."""
    import math
    if val is None:
        return Decimal("0")
    # Handle pandas NaN / float NaN
    try:
        if math.isnan(float(val)):
            return Decimal("0")
    except (TypeError, ValueError):
        pass
    s = str(val).strip()
    if not s or s.lower() == "nan":
        return Decimal("0")
    # Italian format: thousands separator ".", decimal separator ","
    s = s.replace(".", "").replace(",", ".")
    try:
        return Decimal(s)
    except Exception:
        return Decimal("0")


@router.post("/ca-mutuo")
async def importa_ca_mutuo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Importa piano di ammortamento Crédit Agricole da file Excel (.xlsx).
    Struttura attesa:
      - Riga 3 (0-indexed): intestazione capitale erogato  -> col 1
      - Riga 4 (0-indexed): intestazione capitale rimborsato -> col 1
      - Riga 7 (0-indexed): header colonne (ignorato)
      - Righe 8+ (0-indexed): dati piano ammortamento
    """
    from fastapi import HTTPException
    import math

    content = await file.read()
    filename = file.filename or "ca_mutuo.xlsx"

    # Salva su file temporaneo per pandas
    suffix = ".xlsx" if filename.lower().endswith(".xlsx") else ".xls"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_f:
        tmp_f.write(content)
        tmp_path = tmp_f.name

    try:
        engine_xls = "openpyxl" if suffix == ".xlsx" else "xlrd"
        df_full = pd.read_excel(tmp_path, sheet_name=0, header=None, engine=engine_xls)
    except Exception as e:
        os.unlink(tmp_path)
        raise HTTPException(400, f"Errore lettura file Excel: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    # ── Leggi intestazione (righe 3 e 4, colonna 1) ──────────────────────────
    try:
        raw_cap_erogato    = df_full.iat[3, 1]
        raw_cap_rimborsato = df_full.iat[4, 1]
    except IndexError as e:
        raise HTTPException(400, f"Struttura file non valida (intestazione): {e}")

    capitale_erogato    = _dec_it(raw_cap_erogato)
    capitale_rimborsato = _dec_it(raw_cap_rimborsato)
    capitale_residuo    = capitale_erogato - capitale_rimborsato

    # ── Leggi righe dati (dalla riga 8, 0-indexed) ───────────────────────────
    df_data = df_full.iloc[8:].reset_index(drop=True)

    data_rows = []
    for idx, row in df_data.iterrows():
        # Col 0: data_scadenza (stringa DD/MM/YYYY o NaN)
        raw_data = row.iloc[0] if len(row) > 0 else None
        if raw_data is None or (isinstance(raw_data, float) and math.isnan(raw_data)):
            continue
        data_str = str(raw_data).strip()
        if not data_str or data_str.lower() == "nan":
            continue

        try:
            data_scad = datetime.strptime(data_str, "%d/%m/%Y").date()
        except ValueError:
            continue  # salta righe con data non valida

        rata_totale       = _dec_it(row.iloc[1] if len(row) > 1 else None)
        quota_capitale    = _dec_it(row.iloc[2] if len(row) > 2 else None)
        quota_interessi   = _dec_it(row.iloc[3] if len(row) > 3 else None)
        # col 4: contributo (ignorato)
        raw_stato         = str(row.iloc[5]).strip().upper() if len(row) > 5 else ""
        pagata            = raw_stato == "PAGATA"
        cap_residuo_dopo  = _dec_it(row.iloc[6] if len(row) > 6 else None)

        data_rows.append({
            "data_scadenza":        data_scad,
            "rata_totale":          rata_totale,
            "quota_capitale":       quota_capitale,
            "quota_interessi":      quota_interessi,
            "pagata":               pagata,
            "capitale_residuo_dopo": cap_residuo_dopo,
        })

    if not data_rows:
        raise HTTPException(400, "Nessuna riga dati trovata nel file")

    # ── Deriva metadati mutuo ─────────────────────────────────────────────────
    # Usa il valore di rata più comune (la prima può essere parziale/pre-ammortamento)
    from collections import Counter as _Counter
    all_rate_vals = [r["rata_totale"] for r in data_rows]
    regular_rates = all_rate_vals[1:] if len(all_rate_vals) > 1 else all_rate_vals
    rata_mensile  = _Counter(regular_rates).most_common(1)[0][0]
    rate_totali   = len(data_rows)
    rate_pagate   = sum(1 for r in data_rows if r["pagata"])

    # Calcola TAN: usa la seconda rata dove capitale_prima = capitale_erogato
    # (la prima rata CA è solo interessi, quindi capitale_erogato rimane invariato)
    r2 = data_rows[1] if len(data_rows) > 1 else data_rows[0]
    cap_prima_r2  = capitale_erogato  # prima rata è solo interessi, nessun capitale rimborsato
    int_r2        = r2["quota_interessi"]
    tasso_valore_ca = round((float(int_r2) / float(cap_prima_r2)) * 12 * 100, 4) if cap_prima_r2 > 0 else None

    # data_erogazione: primo giorno del mese precedente la prima scadenza
    prima_scadenza = data_rows[0]["data_scadenza"]
    if prima_scadenza.month == 1:
        data_erogazione = date(prima_scadenza.year - 1, 12, 1)
    else:
        data_erogazione = date(prima_scadenza.year, prima_scadenza.month - 1, 1)

    data_scadenza_mutuo = data_rows[-1]["data_scadenza"]

    # Numero contratto: dal nome file o fisso
    import re as _re
    nc_match = _re.search(r"[\w-]+", filename.replace(".xlsx", "").replace(".xls", ""))
    numero_contratto = nc_match.group(0) if nc_match else "CAI-001"

    # ── Upsert Mutuo ──────────────────────────────────────────────────────────
    res = await db.execute(
        select(Mutuo).where(
            Mutuo.utente_id == current_user.id,
            Mutuo.banca == "Crédit Agricole",
        )
    )
    mutuo = res.scalar_one_or_none()

    if mutuo is None:
        mutuo = Mutuo(
            utente_id=current_user.id,
            nome="Mutuo Focene Crédit Agricole",
            banca="Crédit Agricole",
            numero_contratto=numero_contratto,
            capitale_erogato=capitale_erogato,
            capitale_residuo=capitale_residuo,
            tasso_tipo="fisso",
            tasso_valore=Decimal(str(tasso_valore_ca)) if tasso_valore_ca else None,
            rata_mensile=rata_mensile,
            rate_totali=rate_totali,
            rate_pagate=rate_pagate,
            data_erogazione=data_erogazione,
            data_scadenza=data_scadenza_mutuo,
        )
        db.add(mutuo)
        await db.flush()
    else:
        mutuo.nome              = "Mutuo Focene Crédit Agricole"
        mutuo.numero_contratto  = numero_contratto
        mutuo.capitale_erogato  = capitale_erogato
        mutuo.capitale_residuo  = capitale_residuo
        mutuo.tasso_valore      = Decimal(str(tasso_valore_ca)) if tasso_valore_ca else mutuo.tasso_valore
        mutuo.rata_mensile      = rata_mensile
        mutuo.rate_totali       = rate_totali
        mutuo.rate_pagate       = rate_pagate
        mutuo.data_erogazione   = data_erogazione
        mutuo.data_scadenza     = data_scadenza_mutuo

        # Elimina piano esistente
        old_piano = await db.execute(
            select(PianoAmmortamento).where(PianoAmmortamento.mutuo_id == mutuo.id)
        )
        for r in old_piano.scalars().all():
            await db.delete(r)
        await db.flush()

    # ── Inserisci piano ammortamento ──────────────────────────────────────────
    for i, row_data in enumerate(data_rows, start=1):
        db.add(PianoAmmortamento(
            mutuo_id=mutuo.id,
            numero_rata=i,
            data_scadenza=row_data["data_scadenza"],
            quota_capitale=row_data["quota_capitale"],
            quota_interessi=row_data["quota_interessi"],
            rata_totale=row_data["rata_totale"],
            pagata=row_data["pagata"],
            capitale_residuo_dopo=row_data["capitale_residuo_dopo"],
        ))

    await db.commit()
    return {
        "importati": rate_totali,
        "rate_pagate": rate_pagate,
        "capitale_erogato": str(capitale_erogato),
        "capitale_residuo": str(capitale_residuo),
    }


# ── IMPORT REVOLUT CONTO CORRENTE ────────────────────────────────────────────

@router.post("/revolut-conto")
async def importa_revolut_conto(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Importa l'estratto conto Revolut (account-statement_*.csv).
    Colonne: Tipo,Prodotto,Data di inizio,Data di completamento,
             Descrizione,Importo,Costo,Valuta,State,Saldo
    Gestisce solo le righe con Prodotto="Attuale".
    """
    from app.services.categorizza import auto_categorizza

    content = await file.read()
    rows = _parse_csv(content)

    # Filtra solo righe conto corrente (Attuale) completate in EUR
    attuale_rows = [
        r for r in rows
        if r.get("Prodotto", "").strip() == "Attuale"
        and r.get("Valuta", "").strip() == "EUR"
        and r.get("State", "").strip() == "COMPLETATO"
    ]

    if not attuale_rows:
        from fastapi import HTTPException
        raise HTTPException(400, "Nessuna transazione 'Attuale' trovata nel file")

    # Ultimo saldo dalle righe completate
    last_saldo = None
    for r in attuale_rows:
        s = r.get("Saldo", "").strip()
        if s:
            try:
                last_saldo = Decimal(s)
            except Exception:
                pass

    # Upsert conto corrente Revolut
    conto = await _get_or_create_conto(
        db, current_user.id,
        "Conto Corrente Revolut", "conto_corrente", "Revolut"
    )

    if last_saldo is not None:
        db.add(SaldoSnapshot(
            conto_id=conto.id,
            saldo=last_saldo.quantize(Decimal("0.01")),
            fonte="revolut_csv"
        ))

    importati, saltati, errori = 0, 0, []
    for r in attuale_rows:
        try:
            data_raw = r.get("Data di completamento", "").strip()
            descrizione = r.get("Descrizione", "").strip()
            importo_raw = r.get("Importo", "0").strip()
            costo_raw   = r.get("Costo", "0").strip()
            tipo_op     = r.get("Tipo", "").strip()

            if not data_raw:
                continue

            data_op = datetime.strptime(data_raw[:10], "%Y-%m-%d").date()

            importo = _importo_dec(importo_raw) if importo_raw else Decimal("0")
            costo   = _importo_dec(costo_raw)   if costo_raw   else Decimal("0")

            # Per "Addebita" (es. canone Metal) l'importo è 0, il costo è il vero addebito
            if importo == Decimal("0") and costo > Decimal("0"):
                importo = -costo
            elif importo == Decimal("0") and costo == Decimal("0"):
                saltati += 1
                continue

            ext_id = _ext_id([data_op, tipo_op, importo, descrizione[:50]])
            exists = await db.execute(select(Movimento).where(Movimento.external_id == ext_id))
            if exists.scalar_one_or_none():
                saltati += 1
                continue

            tipo_mov = TipoMovimento.entrata if importo > 0 else TipoMovimento.uscita
            cat_nome = auto_categorizza(descrizione, tipo_op)
            cat_id   = await _get_categoria_id(db, cat_nome)

            db.add(Movimento(
                utente_id=current_user.id,
                conto_id=conto.id,
                tipo=tipo_mov,
                importo=importo,
                descrizione=descrizione[:250],
                data_operazione=data_op,
                causale=tipo_op[:20] if tipo_op else None,
                is_carta_credito=False,
                fonte="revolut_conto",
                external_id=ext_id,
                categoria_id=cat_id,
            ))
            importati += 1
        except Exception as e:
            errori.append(f"Riga: {e}")

    await db.commit()
    return {
        "importati": importati,
        "saltati": saltati,
        "saldo_corrente": str(last_saldo) if last_saldo else None,
        "errori": errori,
    }


# ── IMPORT REVOLUT COMPLETO (Attuale + Deposito dallo stesso CSV) ────────────

@router.post("/revolut-completo")
async def importa_revolut_completo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Importa l'estratto conto Revolut completo (account-statement_*.csv).
    Gestisce sia le righe Prodotto=Attuale (conto corrente) sia Prodotto=Deposito.
    Crea/aggiorna:
      - "Conto Corrente Revolut" (tipo conto_corrente) per le righe Attuale
      - "Deposito Revolut" (tipo deposito) per le righe Deposito
    Disattiva l'eventuale Posizione RDEP se presente (evita doppio conteggio).
    """
    from app.services.categorizza import auto_categorizza

    content = await file.read()
    rows = _parse_csv(content)

    attuale_rows = [
        r for r in rows
        if r.get("Prodotto", "").strip() == "Attuale"
        and r.get("Valuta", "").strip() == "EUR"
        and r.get("State", "").strip() == "COMPLETATO"
    ]
    deposito_rows = [
        r for r in rows
        if r.get("Prodotto", "").strip() == "Deposito"
        and r.get("Valuta", "").strip() == "EUR"
        and r.get("State", "").strip() == "COMPLETATO"
    ]

    # ── Conto corrente Attuale ─────────────────────────────────────────────────
    conto_cc = await _get_or_create_conto(
        db, current_user.id, "Conto Corrente Revolut", "conto_corrente", "Revolut"
    )

    last_saldo_cc = None
    for r in attuale_rows:
        s = r.get("Saldo", "").strip()
        if s:
            try:
                last_saldo_cc = Decimal(s)
            except Exception:
                pass

    if last_saldo_cc is not None:
        db.add(SaldoSnapshot(
            conto_id=conto_cc.id,
            saldo=last_saldo_cc.quantize(Decimal("0.01")),
            fonte="revolut_completo",
        ))

    imp_cc, sal_cc, err_cc = 0, 0, []
    for r in attuale_rows:
        try:
            data_raw = r.get("Data di completamento", "").strip()
            descrizione = r.get("Descrizione", "").strip()
            importo_raw = r.get("Importo", "0").strip()
            costo_raw   = r.get("Costo", "0").strip()
            tipo_op     = r.get("Tipo", "").strip()

            if not data_raw:
                continue

            data_op = datetime.strptime(data_raw[:10], "%Y-%m-%d").date()
            importo = _importo_dec(importo_raw) if importo_raw else Decimal("0")
            costo   = _importo_dec(costo_raw)   if costo_raw   else Decimal("0")

            if importo == Decimal("0") and costo > Decimal("0"):
                importo = -costo
            elif importo == Decimal("0") and costo == Decimal("0"):
                sal_cc += 1
                continue

            ext_id = _ext_id(["rev_cc", data_op, tipo_op, importo, descrizione[:50]])
            exists = await db.execute(select(Movimento).where(Movimento.external_id == ext_id))
            if exists.scalar_one_or_none():
                sal_cc += 1
                continue

            tipo_mov = TipoMovimento.entrata if importo > 0 else TipoMovimento.uscita
            cat_nome = auto_categorizza(descrizione, tipo_op)
            cat_id   = await _get_categoria_id(db, cat_nome)

            db.add(Movimento(
                utente_id=current_user.id,
                conto_id=conto_cc.id,
                tipo=tipo_mov,
                importo=importo,
                descrizione=descrizione[:250],
                data_operazione=data_op,
                causale=tipo_op[:20] if tipo_op else None,
                is_carta_credito=False,
                fonte="revolut_completo",
                external_id=ext_id,
                categoria_id=cat_id,
            ))
            imp_cc += 1
        except Exception as e:
            err_cc.append(f"Attuale: {e}")

    # ── Conto deposito ─────────────────────────────────────────────────────────
    conto_dep = await _get_or_create_conto(
        db, current_user.id, "Deposito Revolut", "deposito", "Revolut"
    )

    last_saldo_dep = None
    for r in deposito_rows:
        s = r.get("Saldo", "").strip()
        if s:
            try:
                last_saldo_dep = Decimal(s)
            except Exception:
                pass

    if last_saldo_dep is not None:
        db.add(SaldoSnapshot(
            conto_id=conto_dep.id,
            saldo=last_saldo_dep.quantize(Decimal("0.01")),
            fonte="revolut_completo",
        ))

    imp_dep, sal_dep, err_dep = 0, 0, []
    for r in deposito_rows:
        try:
            data_raw = r.get("Data di completamento", "").strip()
            descrizione = r.get("Descrizione", "").strip()
            importo_raw = r.get("Importo", "0").strip()
            costo_raw   = r.get("Costo", "0").strip()
            tipo_op     = r.get("Tipo", "").strip()

            if not data_raw:
                continue

            data_op = datetime.strptime(data_raw[:10], "%Y-%m-%d").date()
            importo = _importo_dec(importo_raw) if importo_raw else Decimal("0")
            costo   = _importo_dec(costo_raw)   if costo_raw   else Decimal("0")

            if importo == Decimal("0") and costo > Decimal("0"):
                importo = -costo
            elif importo == Decimal("0") and costo == Decimal("0"):
                sal_dep += 1
                continue

            ext_id = _ext_id(["rev_dep", data_op, tipo_op, importo, descrizione[:50]])
            exists = await db.execute(select(Movimento).where(Movimento.external_id == ext_id))
            if exists.scalar_one_or_none():
                sal_dep += 1
                continue

            tipo_mov = TipoMovimento.entrata if importo > 0 else TipoMovimento.uscita
            cat_nome = auto_categorizza(descrizione, tipo_op)
            cat_id   = await _get_categoria_id(db, cat_nome)

            db.add(Movimento(
                utente_id=current_user.id,
                conto_id=conto_dep.id,
                tipo=tipo_mov,
                importo=importo,
                descrizione=descrizione[:250],
                data_operazione=data_op,
                causale=tipo_op[:20] if tipo_op else None,
                is_carta_credito=False,
                fonte="revolut_completo",
                external_id=ext_id,
                categoria_id=cat_id,
            ))
            imp_dep += 1
        except Exception as e:
            err_dep.append(f"Deposito: {e}")

    # Disattiva Posizione RDEP se presente (evita doppio conteggio col nuovo Conto deposito)
    rdep_deactivated = 0
    rdep_res = await db.execute(select(Strumento).where(Strumento.simbolo == "RDEP"))
    rdep_str = rdep_res.scalar_one_or_none()
    if rdep_str:
        pos_res = await db.execute(
            select(Posizione).where(
                Posizione.utente_id == current_user.id,
                Posizione.strumento_id == rdep_str.id,
                Posizione.attivo == True,
            )
        )
        for p in pos_res.scalars().all():
            p.attivo = False
            rdep_deactivated += 1

    await db.commit()
    return {
        "attuale": {"importati": imp_cc, "saltati": sal_cc, "saldo": str(last_saldo_cc) if last_saldo_cc else None, "errori": err_cc},
        "deposito": {"importati": imp_dep, "saltati": sal_dep, "saldo": str(last_saldo_dep) if last_saldo_dep else None, "errori": err_dep},
        "rdep_posizione_disattivata": rdep_deactivated,
    }


# ── IMPORT REVOLUT CONTO DEPOSITO (Investimenti) ─────────────────────────────

@router.post("/revolut-deposito")
async def importa_revolut_deposito(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Importa il rendiconto risparmio Revolut (savings-statement_*.csv).
    Colonne: Data,Descrizione,Tasso di interesse lordo guadagnato,Entrate,Uscite,Saldo
    Crea/aggiorna una Posizione di tipo conto_deposito in Revolut Investimenti.
    """
    content = await file.read()

    def _parse_eur(val: str) -> Decimal:
        """Converte '1.000,05€' o '1.000,05' in Decimal."""
        v = val.strip().replace("€", "").replace(".", "").replace(",", ".").strip()
        return Decimal(v) if v else Decimal("0")

    def _parse_date_revolut(val: str) -> date | None:
        mesi = {
            "gen": 1, "feb": 2, "mar": 3, "apr": 4,
            "mag": 5, "giu": 6, "lug": 7, "ago": 8,
            "set": 9, "ott": 10, "nov": 11, "dic": 12,
        }
        parts = val.strip().split()
        if len(parts) == 3:
            try:
                g = int(parts[0])
                m = mesi.get(parts[1].lower(), 0)
                a = int(parts[2])
                if m:
                    return date(a, m, g)
            except Exception:
                pass
        return None

    rows = _parse_csv(content)
    if not rows:
        from fastapi import HTTPException
        raise HTTPException(400, "File vuoto o formato non riconosciuto")

    # Calcola capitale netto (solo depositi e prelievi, non interessi)
    depositi   = Decimal("0")
    prelievi   = Decimal("0")
    last_saldo = Decimal("0")

    for r in rows:
        desc    = r.get("Descrizione", "").strip()
        entrata = r.get("Entrate", "").strip()
        uscita  = r.get("Uscite", "").strip()
        saldo   = r.get("Saldo", "").strip()

        if saldo:
            try:
                last_saldo = _parse_eur(saldo)
            except Exception:
                pass

        # Solo movimenti di capitale (non interessi)
        if "Deposito sul conto" in desc and entrata:
            try:
                depositi += _parse_eur(entrata)
            except Exception:
                pass
        elif "Prelievo dal conto" in desc and uscita:
            try:
                prelievi += _parse_eur(uscita)
            except Exception:
                pass

    net_capital    = (depositi - prelievi).quantize(Decimal("0.01"))
    interessi_maturati = (last_saldo - net_capital).quantize(Decimal("0.01"))
    var_pct = (interessi_maturati / net_capital * 100).quantize(Decimal("0.0001")) if net_capital > 0 else Decimal("0")
    tasso   = Decimal("2.25")  # TAN lordo dal CSV

    now = datetime.utcnow()
    revolut = PiattaformaEnum("Revolut Investimenti")

    # Upsert Strumento
    res = await db.execute(select(Strumento).where(Strumento.simbolo == "RDEP"))
    strumento = res.scalar_one_or_none()
    if not strumento:
        strumento = Strumento(
            simbolo="RDEP",
            isin=None,
            nome="Revolut Conto Deposito",
            tipo=TipoStrumento.conto_deposito,
            valuta="EUR",
            mercato="Deposito",
        )
        db.add(strumento)
        await db.flush()

    # Upsert Posizione (cancella la vecchia, ricrea)
    res = await db.execute(
        select(Posizione).where(
            Posizione.utente_id == current_user.id,
            Posizione.strumento_id == strumento.id,
            Posizione.piattaforma == revolut,
        )
    )
    for p in res.scalars().all():
        snaps = await db.execute(
            select(PosizioneSnapshot).where(PosizioneSnapshot.posizione_id == p.id)
        )
        for s in snaps.scalars().all():
            await db.delete(s)
        await db.delete(p)
    await db.flush()

    pos = Posizione(
        utente_id=current_user.id,
        strumento_id=strumento.id,
        piattaforma=revolut,
        quantita=Decimal("1.000000"),
        prezzo_carico=net_capital,
        valore_carico=net_capital,
        attivo=True,
        note=f"TAN lordo {tasso}% — Conto deposito senza vincoli Revolut",
    )
    db.add(pos)
    await db.flush()

    db.add(PosizioneSnapshot(
        posizione_id=pos.id,
        quantita=Decimal("1.000000"),
        prezzo_mercato=last_saldo,
        valore_mercato=last_saldo,
        var_eur=interessi_maturati,
        var_pct=var_pct,
        rilevato_at=now,
    ))
    db.add(PrezzoSnapshot(
        strumento_id=strumento.id,
        prezzo=last_saldo,
        valuta="EUR",
        fonte="revolut_savings",
        rilevato_at=now,
    ))

    await db.commit()
    return {
        "saldo_corrente": str(last_saldo),
        "capitale_netto": str(net_capital),
        "interessi_maturati": str(interessi_maturati),
        "var_pct": str(var_pct),
        "tasso_lordo": str(tasso),
    }


# ── IMPORT FINECO CONTO CORRENTE ─────────────────────────────────────────────

@router.post("/fineco-conto")
async def importa_fineco_conto(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Importa l'estratto del conto corrente Fineco (movements_*.xlsx).
    Header: Data_Operazione | Data_Valuta | Entrate | Uscite | Descrizione |
    Descrizione_Completa | Stato | Moneymap. 'Saldo Finale: X' nell'intestazione.
    Stessa logica degli altri conti: dedup external_id, auto-categorizzazione,
    snapshot saldo. Il conto viene incluso nei calcoli liquidità (tipo conto_corrente).
    """
    from app.services.categorizza import auto_categorizza
    from fastapi import HTTPException
    import re

    content = await file.read()
    suffix = ".xlsx" if file.filename.lower().endswith(".xlsx") else ".xls"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(content)
        tmp = f.name
    try:
        engine = "openpyxl" if suffix == ".xlsx" else "xlrd"
        df = pd.read_excel(tmp, sheet_name=0, header=None, engine=engine)
    except Exception as e:
        raise HTTPException(400, f"Errore apertura file: {e}")
    finally:
        os.unlink(tmp)

    # Saldo finale + riga header
    saldo_finale = None
    header_row = None
    for idx, row in df.iterrows():
        joined = " ".join(str(v) for v in row if v is not None and str(v) != "nan")
        if saldo_finale is None and "Saldo Finale" in joined:
            m = re.search(r"([\d\.]+,\d+)", joined)
            if m:
                saldo_finale = Decimal(m.group(1).replace(".", "").replace(",", "."))
        if any(str(v).strip() == "Data_Operazione" for v in row):
            header_row = idx
            break
    if header_row is None:
        raise HTTPException(400, "Header 'Data_Operazione' non trovato nel file")

    headers = [str(v).strip() for v in df.iloc[header_row]]
    col = {name: i for i, name in enumerate(headers)}

    conto = await _get_or_create_conto(
        db, current_user.id, "Conto Corrente Fineco", "conto_corrente", "Fineco"
    )

    if saldo_finale is not None:
        db.add(SaldoSnapshot(
            conto_id=conto.id, saldo=saldo_finale,
            fonte="fineco_conto_xls", rilevato_at=datetime.utcnow(),
        ))

    def _to_date(v):
        if v is None:
            return None
        if not isinstance(v, str) and hasattr(v, "date"):
            try:
                return v.date()
            except Exception:
                return None
        return _parse_date_it(str(v))

    def _to_dec(v):
        if v is None or str(v).strip().lower() in ("", "nan", "nat"):
            return None
        try:
            return Decimal(str(v)).quantize(Decimal("0.01"))
        except Exception:
            return None

    importati, saltati, errori = 0, 0, []
    for i, r in df.iloc[header_row + 1:].iterrows():
        try:
            data_op = _to_date(r[col["Data_Operazione"]]) if "Data_Operazione" in col else None
            if not data_op:
                continue
            data_val = _to_date(r[col["Data_Valuta"]]) if "Data_Valuta" in col else None
            entrate  = _to_dec(r[col["Entrate"]]) if "Entrate" in col else None
            uscite   = _to_dec(r[col["Uscite"]]) if "Uscite" in col else None
            descr      = str(r[col["Descrizione"]]).strip() if "Descrizione" in col else ""
            descr_full = str(r[col["Descrizione_Completa"]]).strip() if "Descrizione_Completa" in col else ""
            moneymap   = str(r[col["Moneymap"]]).strip() if "Moneymap" in col else ""
            descr      = "" if descr.lower() == "nan" else descr
            descr_full = "" if descr_full.lower() == "nan" else descr_full
            moneymap   = "" if moneymap.lower() == "nan" else moneymap

            if entrate is not None and entrate != 0:
                importo = entrate
            elif uscite is not None and uscite != 0:
                importo = uscite if uscite < 0 else -uscite
            else:
                continue

            ext_id = _ext_id(["fineco_cc", data_op, importo, descr[:50]])
            exists = await db.execute(select(Movimento).where(Movimento.external_id == ext_id))
            if exists.scalar_one_or_none():
                saltati += 1
                continue

            tipo = TipoMovimento.entrata if importo > 0 else TipoMovimento.uscita
            cat_nome = auto_categorizza(descr or descr_full, moneymap)
            cat_id = await _get_categoria_id(db, cat_nome)

            db.add(Movimento(
                utente_id=current_user.id, conto_id=conto.id,
                tipo=tipo, importo=importo,
                descrizione=(descr or descr_full)[:250],
                data_operazione=data_op, data_valuta=data_val,
                causale=None, is_carta_credito=False,
                fonte="fineco_conto", external_id=ext_id, categoria_id=cat_id,
            ))
            importati += 1
        except Exception as e:
            errori.append(f"Riga {i}: {e}")

    await db.commit()
    return {
        "importati": importati,
        "saltati": saltati,
        "errori": errori[:10],
        "saldo_finale": float(saldo_finale) if saldo_finale is not None else None,
    }


# ── IMPORT BUSTA PAGA (PDF → analisi AI) ─────────────────────────────────────

@router.post("/busta-paga")
async def importa_busta_paga(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Importa una busta paga PDF: estrae il testo e la fa analizzare a Claude per
    ricavare periodo, azienda, tipo mensilità (ordinaria/13/14/premio/una tantum),
    competenze/trattenute e netto. Dedup per anno+mese+tipo+netto.
    """
    from fastapi import HTTPException
    import io as _io, json
    from app.models.models import BustaPaga
    from app.api.v1.endpoints.advisor import _call_claude

    content = await file.read()
    try:
        import pdfplumber
        with pdfplumber.open(_io.BytesIO(content)) as pdf:
            testo = "\n".join((p.extract_text() or "") for p in pdf.pages)
    except Exception as e:
        raise HTTPException(400, f"Errore lettura PDF: {e}")
    if not testo.strip():
        raise HTTPException(400, "PDF senza testo leggibile (forse è una scansione immagine)")

    prompt = (
        "Sei un parser di buste paga italiane (modello Zucchetti e simili). "
        "Estrai i dati e rispondi SOLO con JSON valido:\n"
        '{"anno":int,"mese":int,"azienda":str,'
        '"tipo_mensilita":"ordinaria|tredicesima|quattordicesima|premio|una_tantum|altro",'
        '"totale_competenze":float,"totale_trattenute":float,"netto":float,'
        '"voci":[{"descrizione":str,"importo":float}]}\n'
        "Regole: netto = riga NETTO in busta (spesso con asterischi, es. ***1.234,00 -> 1234.00). "
        "mese/anno dal PERIODO DI RETRIBUZIONE. Importi in formato italiano (virgola decimale) -> float. "
        "tipo_mensilita: 'tredicesima' se gratifica natalizia/dicembre aggiuntiva, 'quattordicesima' se mensilità aggiuntiva estiva, "
        "'premio' per premio di produzione/risultato, 'una_tantum' per erogazioni straordinarie, altrimenti 'ordinaria'. "
        "voci: massimo 10 principali (stipendio base, superminimo, indennità, premi, TFR, ritenute principali). "
        "Ignora i nomi di esempio del modello (es. BIANCHINI MICHELE / codici BNC...).\n\nBUSTA:\n"
        + testo[:12000]
    )

    raw = await _call_claude(
        system="Sei un parser di buste paga. Rispondi solo con JSON valido, nessun altro testo.",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1500,
    )
    if "```" in raw:
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else parts[0]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        d = json.loads(raw.strip())
    except Exception:
        raise HTTPException(502, "Analisi busta non interpretabile. Riprova.")

    anno = int(d.get("anno") or 0)
    mese = int(d.get("mese") or 0)
    if not (anno and 1 <= mese <= 12):
        raise HTTPException(400, "Periodo (mese/anno) non riconosciuto nella busta")

    tipo = d.get("tipo_mensilita") or "ordinaria"
    netto = Decimal(str(d.get("netto") or 0))
    ext_id = _ext_id(["busta", anno, mese, tipo, netto])

    exists = await db.execute(
        select(BustaPaga).where(BustaPaga.external_id == ext_id, BustaPaga.utente_id == current_user.id)
    )
    gia = exists.scalar_one_or_none()
    if gia:
        # Archivia il PDF se mancante (es. busta importata prima di questa feature)
        if not gia.file_pdf:
            gia.file_pdf = content
            gia.file_nome = file.filename
            await db.commit()
        return {"stato": "gia_presente", "anno": anno, "mese": mese, "tipo": tipo, "netto": float(netto)}

    bp = BustaPaga(
        utente_id=current_user.id, anno=anno, mese=mese,
        azienda=(d.get("azienda") or None), tipo_mensilita=tipo,
        totale_competenze=Decimal(str(d.get("totale_competenze") or 0)),
        totale_trattenute=Decimal(str(d.get("totale_trattenute") or 0)),
        netto=netto, voci=d.get("voci") or [], fonte="pdf", external_id=ext_id,
        file_nome=file.filename, file_pdf=content,
    )
    db.add(bp)
    await db.commit()
    return {
        "stato": "importata", "anno": anno, "mese": mese, "tipo": tipo,
        "azienda": d.get("azienda"), "netto": float(netto),
        "lordo": float(bp.totale_competenze),
    }
