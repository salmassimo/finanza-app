from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, extract
from sqlalchemy.orm import selectinload
from app.db.session import get_db
from app.core.security import get_current_user
from app.models.models import Movimento, CategoriaSpesa, Conto, TipoMovimento
from pydantic import BaseModel
from decimal import Decimal
from datetime import date
from typing import Optional
import uuid

router = APIRouter()


class CategoriaOut(BaseModel):
    id: int
    nome: str
    colore: Optional[str] = None
    icona: Optional[str] = None
    class Config: from_attributes = True

class MovimentoOut(BaseModel):
    id: uuid.UUID
    tipo: str
    importo: Decimal
    descrizione: Optional[str] = None
    data_operazione: date
    data_valuta: Optional[date] = None
    causale: Optional[str] = None
    is_carta_credito: bool
    fonte: str
    categoria: Optional[CategoriaOut] = None
    conto_nome: Optional[str] = None
    class Config: from_attributes = True

class AggregatiItem(BaseModel):
    categoria: str
    colore: Optional[str] = None
    icona: Optional[str] = None
    totale: Decimal
    count: int

class SaldoEffettivo(BaseModel):
    saldo_conto: Decimal
    saldo_deposito: Decimal
    debito_carta: Decimal
    liquidita_effettiva: Decimal


@router.get("/categorie", response_model=list[CategoriaOut])
async def get_categorie(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    res = await db.execute(select(CategoriaSpesa).order_by(CategoriaSpesa.ordine))
    return res.scalars().all()


@router.get("/", response_model=list[MovimentoOut])
async def get_movimenti(
    mese: Optional[str] = Query(None, description="YYYY-MM"),
    is_carta: Optional[bool] = Query(None),
    categoria_id: Optional[int] = Query(None),
    conto_id: Optional[uuid.UUID] = Query(None),
    limit: int = Query(200, le=500),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = (
        select(Movimento)
        .options(selectinload(Movimento.categoria), selectinload(Movimento.conto))
        .where(Movimento.utente_id == current_user.id)
        .order_by(Movimento.data_operazione.desc(), Movimento.created_at.desc())
    )
    if mese:
        anno, m = mese.split("-")
        q = q.where(
            extract("year", Movimento.data_operazione) == int(anno),
            extract("month", Movimento.data_operazione) == int(m),
        )
    if is_carta is not None:
        q = q.where(Movimento.is_carta_credito == is_carta)
    if conto_id is not None:
        q = q.where(Movimento.conto_id == conto_id)
    if categoria_id is not None:
        q = q.where(Movimento.categoria_id == categoria_id)

    q = q.offset(offset).limit(limit)
    res = await db.execute(q)
    movimenti = res.scalars().all()

    out = []
    for mov in movimenti:
        out.append(MovimentoOut(
            id=mov.id,
            tipo=mov.tipo.value,
            importo=mov.importo,
            descrizione=mov.descrizione,
            data_operazione=mov.data_operazione,
            data_valuta=mov.data_valuta,
            causale=mov.causale,
            is_carta_credito=mov.is_carta_credito,
            fonte=mov.fonte,
            categoria=CategoriaOut.model_validate(mov.categoria) if mov.categoria else None,
            conto_nome=mov.conto.nome if mov.conto else None,
        ))
    return out


@router.get("/aggregati", response_model=list[AggregatiItem])
async def get_aggregati(
    mese: Optional[str] = Query(None, description="YYYY-MM"),
    is_carta: Optional[bool] = Query(None),
    conto_id: Optional[uuid.UUID] = Query(None),
    tipo: Optional[str] = Query("uscita", description="uscita|entrata"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Totale movimenti per categoria, filtrabili per tipo (uscita o entrata)."""
    tipo_enum = TipoMovimento.entrata if tipo == "entrata" else TipoMovimento.uscita
    q = (
        select(
            CategoriaSpesa.nome,
            CategoriaSpesa.colore,
            CategoriaSpesa.icona,
            func.sum(Movimento.importo).label("totale"),
            func.count(Movimento.id).label("count"),
        )
        .join(CategoriaSpesa, Movimento.categoria_id == CategoriaSpesa.id, isouter=True)
        .where(
            Movimento.utente_id == current_user.id,
            Movimento.tipo == tipo_enum,
        )
        .group_by(CategoriaSpesa.nome, CategoriaSpesa.colore, CategoriaSpesa.icona, CategoriaSpesa.ordine)
        .order_by(func.abs(func.sum(Movimento.importo)).desc())
    )
    if mese:
        anno, m = mese.split("-")
        q = q.where(
            extract("year", Movimento.data_operazione) == int(anno),
            extract("month", Movimento.data_operazione) == int(m),
        )
    if is_carta is not None:
        q = q.where(Movimento.is_carta_credito == is_carta)
    if conto_id is not None:
        q = q.where(Movimento.conto_id == conto_id)

    res = await db.execute(q)
    return [
        AggregatiItem(
            categoria=r.nome or "Senza categoria",
            colore=r.colore,
            icona=r.icona,
            totale=abs(r.totale or 0),
            count=r.count,
        )
        for r in res.fetchall()
    ]


@router.get("/saldo-effettivo", response_model=SaldoEffettivo)
async def get_saldo_effettivo(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Saldo conto corrente - debito carta di credito corrente (mese in corso)."""
    from app.models.models import SaldoSnapshot
    from datetime import date
    from calendar import monthrange

    # Saldo conto corrente (ultimo snapshot)
    today = date.today()
    from app.models.models import TipoConto as TC
    conti_res = await db.execute(
        select(Conto).where(
            Conto.utente_id == current_user.id,
            Conto.attivo == True,
            Conto.tipo.in_([TC.conto_corrente, TC.deposito]),
        )
    )
    conti = conti_res.scalars().all()
    saldo_conto = Decimal("0")
    saldo_deposito = Decimal("0")
    for c in conti:
        s = await db.execute(
            select(SaldoSnapshot.saldo)
            .where(SaldoSnapshot.conto_id == c.id)
            .order_by(SaldoSnapshot.rilevato_at.desc())
            .limit(1)
        )
        v = s.scalar_one_or_none()
        if v:
            if c.tipo == TC.conto_corrente:
                saldo_conto += v
            else:
                saldo_deposito += v

    # Debito carta: somma spese carta del mese corrente non ancora addebitate
    # (movimenti carta credito del mese corrente)
    primo = today.replace(day=1)
    ultimo_giorno = monthrange(today.year, today.month)[1]
    ultimo = today.replace(day=ultimo_giorno)

    debito_res = await db.execute(
        select(func.sum(Movimento.importo))
        .where(
            Movimento.utente_id == current_user.id,
            Movimento.is_carta_credito == True,
            Movimento.tipo == TipoMovimento.uscita,
            Movimento.data_operazione >= primo,
            Movimento.data_operazione <= ultimo,
        )
    )
    debito = abs(debito_res.scalar_one_or_none() or Decimal("0"))

    return SaldoEffettivo(
        saldo_conto=saldo_conto,
        saldo_deposito=saldo_deposito,
        debito_carta=debito,
        liquidita_effettiva=saldo_conto + saldo_deposito - debito,
    )


class PatchCategoriaBody(BaseModel):
    categoria_id: Optional[int] = None   # None = rimuovi categoria (→ Altro)


@router.patch("/{movimento_id}/categoria", response_model=MovimentoOut)
async def patch_categoria_movimento(
    movimento_id: uuid.UUID,
    body: PatchCategoriaBody,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Aggiorna la categoria di un singolo movimento."""
    res = await db.execute(
        select(Movimento)
        .options(selectinload(Movimento.categoria), selectinload(Movimento.conto))
        .where(Movimento.id == movimento_id, Movimento.utente_id == current_user.id)
    )
    mov = res.scalar_one_or_none()
    if not mov:
        from fastapi import HTTPException
        raise HTTPException(404, "Movimento non trovato")

    # Verifica che la categoria esista (se specificata)
    if body.categoria_id is not None:
        cat_res = await db.execute(
            select(CategoriaSpesa).where(CategoriaSpesa.id == body.categoria_id)
        )
        cat = cat_res.scalar_one_or_none()
        if not cat:
            from fastapi import HTTPException
            raise HTTPException(400, f"Categoria {body.categoria_id} non trovata")
    else:
        cat = None

    mov.categoria_id = body.categoria_id
    await db.commit()
    await db.refresh(mov)

    # Ricarica le relazioni dopo il refresh
    res2 = await db.execute(
        select(Movimento)
        .options(selectinload(Movimento.categoria), selectinload(Movimento.conto))
        .where(Movimento.id == movimento_id)
    )
    mov = res2.scalar_one()

    return MovimentoOut(
        id=mov.id, tipo=mov.tipo.value, importo=mov.importo,
        descrizione=mov.descrizione, data_operazione=mov.data_operazione,
        data_valuta=mov.data_valuta, causale=mov.causale,
        is_carta_credito=mov.is_carta_credito, fonte=mov.fonte,
        categoria=CategoriaOut.model_validate(mov.categoria) if mov.categoria else None,
        conto_nome=mov.conto.nome if mov.conto else None,
    )


@router.get("/mesi-disponibili")
async def get_mesi_disponibili(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Lista dei mesi con movimenti, sempre incluso il mese corrente."""
    from datetime import date as _date
    mese_col = func.to_char(Movimento.data_operazione, "YYYY-MM").label("mese")
    res = await db.execute(
        select(mese_col)
        .where(Movimento.utente_id == current_user.id)
        .group_by(mese_col)
        .order_by(mese_col.desc())
    )
    mesi = [r.mese for r in res.fetchall()]
    # Assicura che il mese corrente sia sempre presente, anche senza transazioni
    mese_corrente = _date.today().strftime("%Y-%m")
    if mese_corrente not in mesi:
        mesi.insert(0, mese_corrente)
    return mesi
