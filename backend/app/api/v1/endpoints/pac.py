from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.core.security import get_current_user
from app.models.models import (
    PianoAccumulo, PianoAccumuloStrumento, Posizione, PosizioneSnapshot,
    PrezzoSnapshot, Strumento, Movimento, TipoMovimento, CategoriaSpesa,
)
from pydantic import BaseModel
from decimal import Decimal
from datetime import date
from typing import Optional
import uuid

router = APIRouter()


class StrumentoIn(BaseModel):
    nome_etf: str
    simbolo: Optional[str] = None
    isin: Optional[str] = None
    importo_target: Decimal = Decimal("0")
    quantita_target: int = 1
    attivo: bool = True
    posizione_id: Optional[uuid.UUID] = None


class StrumentoOut(BaseModel):
    id: uuid.UUID
    nome_etf: str
    simbolo: Optional[str] = None
    isin: Optional[str] = None
    importo_target: Decimal
    quantita_target: int
    attivo: bool
    posizione_id: Optional[uuid.UUID] = None
    importo_stimato: Optional[Decimal] = None
    class Config: from_attributes = True


class PACIn(BaseModel):
    nome: str
    piattaforma: str = "Fineco"
    stato: str = "attivo"
    periodicita: str = "mensile"
    giorno_esecuzione: int = 1
    costo_per_strumento: Decimal = Decimal("0")
    data_inizio: Optional[date] = None
    prossimo_investimento: Optional[date] = None
    note: Optional[str] = None
    strumenti: list[StrumentoIn] = []


class PACOut(BaseModel):
    id: uuid.UUID
    nome: str
    piattaforma: str
    stato: str
    periodicita: str
    giorno_esecuzione: int
    costo_per_strumento: Decimal
    costo_mensile_totale: Decimal
    importo_mensile_totale: Decimal
    importo_mensile_stimato: Decimal
    esecuzione_pendente: bool
    data_inizio: Optional[date]
    prossimo_investimento: Optional[date]
    note: Optional[str]
    strumenti: list[StrumentoOut]
    class Config: from_attributes = True


class PACPatch(BaseModel):
    nome: Optional[str] = None
    stato: Optional[str] = None
    prossimo_investimento: Optional[date] = None
    note: Optional[str] = None


async def _build_pac_out(piano: PianoAccumulo, strumenti: list, db: AsyncSession) -> PACOut:
    n_attivi = sum(1 for s in strumenti if s.attivo)
    importo_mensile = sum(s.importo_target for s in strumenti if s.attivo)

    strumenti_out = []
    importo_stimato_totale = Decimal("0")
    for s in strumenti:
        importo_stimato = None
        if s.posizione_id:
            price_res = await db.execute(
                select(PrezzoSnapshot.prezzo)
                .join(Strumento, PrezzoSnapshot.strumento_id == Strumento.id)
                .join(Posizione, Posizione.strumento_id == Strumento.id)
                .where(Posizione.id == s.posizione_id)
                .order_by(PrezzoSnapshot.rilevato_at.desc())
                .limit(1)
            )
            prezzo = price_res.scalar_one_or_none()
            if prezzo:
                importo_stimato = Decimal(str(s.quantita_target)) * prezzo
                if s.attivo:
                    importo_stimato_totale += importo_stimato

        strumenti_out.append(StrumentoOut(
            id=s.id,
            nome_etf=s.nome_etf,
            simbolo=s.simbolo,
            isin=s.isin,
            importo_target=s.importo_target,
            quantita_target=s.quantita_target,
            attivo=s.attivo,
            posizione_id=s.posizione_id,
            importo_stimato=importo_stimato,
        ))

    esecuzione_pendente = (
        piano.stato == 'attivo'
        and piano.prossimo_investimento is not None
        and piano.prossimo_investimento <= date.today()
    )

    return PACOut(
        id=piano.id,
        nome=piano.nome,
        piattaforma=piano.piattaforma,
        stato=piano.stato,
        periodicita=piano.periodicita,
        giorno_esecuzione=piano.giorno_esecuzione,
        costo_per_strumento=piano.costo_per_strumento,
        costo_mensile_totale=piano.costo_per_strumento * n_attivi,
        importo_mensile_totale=importo_mensile,
        importo_mensile_stimato=importo_stimato_totale if importo_stimato_totale > 0 else importo_mensile,
        esecuzione_pendente=esecuzione_pendente,
        data_inizio=piano.data_inizio,
        prossimo_investimento=piano.prossimo_investimento,
        note=piano.note,
        strumenti=strumenti_out,
    )


@router.get("/", response_model=list[PACOut])
async def get_pac(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    res = await db.execute(
        select(PianoAccumulo)
        .where(PianoAccumulo.utente_id == current_user.id)
        .order_by(PianoAccumulo.created_at)
    )
    piani = res.scalars().all()
    out = []
    for piano in piani:
        res2 = await db.execute(
            select(PianoAccumuloStrumento)
            .where(PianoAccumuloStrumento.piano_id == piano.id)
            .order_by(PianoAccumuloStrumento.importo_target.desc())
        )
        strumenti = res2.scalars().all()
        out.append(await _build_pac_out(piano, strumenti, db))
    return out


@router.post("/", response_model=PACOut, status_code=201)
async def create_pac(
    body: PACIn,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    piano = PianoAccumulo(
        utente_id=current_user.id,
        nome=body.nome,
        piattaforma=body.piattaforma,
        stato=body.stato,
        periodicita=body.periodicita,
        giorno_esecuzione=body.giorno_esecuzione,
        costo_per_strumento=body.costo_per_strumento,
        data_inizio=body.data_inizio,
        prossimo_investimento=body.prossimo_investimento,
        note=body.note,
    )
    db.add(piano)
    await db.flush()

    strumenti = []
    for s in body.strumenti:
        st = PianoAccumuloStrumento(
            piano_id=piano.id,
            nome_etf=s.nome_etf,
            simbolo=s.simbolo,
            isin=s.isin,
            importo_target=s.importo_target,
            quantita_target=s.quantita_target,
            attivo=s.attivo,
            posizione_id=s.posizione_id,
        )
        db.add(st)
        strumenti.append(st)

    await db.commit()
    await db.refresh(piano)
    for st in strumenti:
        await db.refresh(st)

    return await _build_pac_out(piano, strumenti, db)


@router.patch("/{piano_id}", response_model=PACOut)
async def patch_pac(
    piano_id: uuid.UUID,
    body: PACPatch,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    piano = await db.get(PianoAccumulo, piano_id)
    if not piano or piano.utente_id != current_user.id:
        raise HTTPException(404, "Piano non trovato")
    if body.nome is not None:
        piano.nome = body.nome
    if body.stato is not None:
        piano.stato = body.stato
    if body.prossimo_investimento is not None:
        piano.prossimo_investimento = body.prossimo_investimento
    if body.note is not None:
        piano.note = body.note
    await db.commit()
    await db.refresh(piano)

    res2 = await db.execute(
        select(PianoAccumuloStrumento)
        .where(PianoAccumuloStrumento.piano_id == piano.id)
        .order_by(PianoAccumuloStrumento.importo_target.desc())
    )
    strumenti = res2.scalars().all()
    return await _build_pac_out(piano, strumenti, db)


@router.delete("/{piano_id}", status_code=204)
async def delete_pac(
    piano_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    piano = await db.get(PianoAccumulo, piano_id)
    if not piano or piano.utente_id != current_user.id:
        raise HTTPException(404, "Piano non trovato")
    await db.delete(piano)
    await db.commit()


@router.post("/{piano_id}/esegui", response_model=PACOut)
async def esegui_pac(
    piano_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    piano = await db.get(PianoAccumulo, piano_id)
    if not piano or piano.utente_id != current_user.id:
        raise HTTPException(404, "Piano non trovato")
    if piano.stato != 'attivo':
        raise HTTPException(400, "PAC non attivo")

    today = date.today()

    # Trova categoria Investimenti
    cat_res = await db.execute(select(CategoriaSpesa).where(CategoriaSpesa.nome == "Investimenti"))
    cat_inv = cat_res.scalar_one_or_none()

    # Ottieni strumenti
    str_res = await db.execute(
        select(PianoAccumuloStrumento)
        .where(PianoAccumuloStrumento.piano_id == piano.id, PianoAccumuloStrumento.attivo == True)
    )
    strumenti = str_res.scalars().all()

    for s in strumenti:
        if not s.posizione_id:
            continue

        # Prezzo corrente
        price_res = await db.execute(
            select(PrezzoSnapshot.prezzo)
            .join(Strumento, PrezzoSnapshot.strumento_id == Strumento.id)
            .join(Posizione, Posizione.strumento_id == Strumento.id)
            .where(Posizione.id == s.posizione_id)
            .order_by(PrezzoSnapshot.rilevato_at.desc())
            .limit(1)
        )
        prezzo = price_res.scalar_one_or_none()
        if not prezzo or prezzo <= 0:
            continue

        # Quote acquistabili
        qty = int(s.importo_target // prezzo)
        if qty <= 0:
            continue

        importo_effettivo = Decimal(str(qty)) * prezzo
        commissione = piano.costo_per_strumento

        # Aggiorna posizione
        pos = await db.get(Posizione, s.posizione_id)
        if pos:
            old_qty = pos.quantita
            old_carico = pos.valore_carico
            nuova_qty = old_qty + Decimal(str(qty))
            nuovo_carico = old_carico + importo_effettivo
            nuovo_prezzo_carico = nuovo_carico / nuova_qty

            pos.quantita = nuova_qty
            pos.valore_carico = nuovo_carico
            pos.prezzo_carico = nuovo_prezzo_carico

            valore_mkt = nuova_qty * prezzo
            var_eur = valore_mkt - nuovo_carico
            var_pct = (var_eur / nuovo_carico * 100) if nuovo_carico > 0 else Decimal("0")

            snap = PosizioneSnapshot(
                posizione_id=pos.id,
                quantita=nuova_qty,
                prezzo_mercato=prezzo,
                valore_mercato=valore_mkt,
                var_eur=var_eur,
                var_pct=var_pct,
            )
            db.add(snap)

        # Crea movimento
        mov = Movimento(
            utente_id=current_user.id,
            tipo=TipoMovimento.uscita,
            importo=importo_effettivo + commissione,
            descrizione=f"PAC {piano.nome} – {s.nome_etf} ({qty} quote @ {float(prezzo):.2f})",
            data_operazione=today,
            fonte="pac",
            categoria_id=cat_inv.id if cat_inv else None,
        )
        db.add(mov)

    # Avanza prossimo_investimento al mese successivo (stesso giorno)
    from calendar import monthrange
    curr = piano.prossimo_investimento or today
    m = curr.month + 1
    y = curr.year + (1 if m > 12 else 0)
    m = m if m <= 12 else 1
    d = min(piano.giorno_esecuzione, monthrange(y, m)[1])
    piano.prossimo_investimento = date(y, m, d)

    await db.commit()

    # Ricarica strumenti per il return
    str_res2 = await db.execute(
        select(PianoAccumuloStrumento)
        .where(PianoAccumuloStrumento.piano_id == piano.id)
        .order_by(PianoAccumuloStrumento.importo_target.desc())
    )
    strumenti_aggiornati = str_res2.scalars().all()
    return await _build_pac_out(piano, strumenti_aggiornati, db)
