from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.db.session import get_db
from app.core.security import get_current_user
from pydantic import BaseModel
from decimal import Decimal
from datetime import date
from typing import Optional
import uuid

router = APIRouter()


# ── MODELS ──────────────────────────────────────────────────────────────────

class GaranziaOut(BaseModel):
    id: int
    tipo_garanzia: str
    descrizione: Optional[str] = None
    capitale_garantito: Optional[Decimal] = None
    percentuale_debito: Optional[Decimal] = None
    franchigia_giorni: Optional[int] = None
    massimale_mensile: Optional[Decimal] = None
    durata_massima_mesi: Optional[int] = None
    attiva: bool
    note: Optional[str] = None
    class Config: from_attributes = True

class BeneficiarioOut(BaseModel):
    id: int
    nome_cognome: str
    relazione: Optional[str] = None
    codice_fiscale: Optional[str] = None
    data_nascita: Optional[date] = None
    recapito_telefono: Optional[str] = None
    recapito_email: Optional[str] = None
    percentuale_quota: Optional[Decimal] = None
    ordine: int
    note: Optional[str] = None
    class Config: from_attributes = True

class PolizzaOut(BaseModel):
    id: uuid.UUID
    tipo: str
    stato: str
    nome: str
    compagnia: Optional[str] = None
    numero_polizza: Optional[str] = None
    intermediario: Optional[str] = None
    data_stipula: date
    data_scadenza: Optional[date] = None
    data_revisione: Optional[date] = None
    premio_importo: Optional[Decimal] = None
    premio_periodicita: Optional[str] = None
    premio_indicizzato: bool
    mutuo_id: Optional[uuid.UUID] = None
    mutuo_nome: Optional[str] = None
    copertura_percentuale: Optional[Decimal] = None
    capitale_assicurato: Optional[Decimal] = None
    # Calcolato live per CPI
    copertura_effettiva_live: Optional[Decimal] = None
    istruzioni_eredi: Optional[str] = None
    documenti_dove: Optional[str] = None
    contatto_liquidazione: Optional[str] = None
    note: Optional[str] = None
    attiva: bool
    garanzie: list[GaranziaOut] = []
    beneficiari: list[BeneficiarioOut] = []
    class Config: from_attributes = True

class PolizzaCreate(BaseModel):
    tipo: str
    stato: str = "attiva"
    nome: str
    compagnia: Optional[str] = None
    numero_polizza: Optional[str] = None
    intermediario: Optional[str] = None
    data_stipula: date
    data_scadenza: Optional[date] = None
    data_revisione: Optional[date] = None
    premio_importo: Optional[Decimal] = None
    premio_periodicita: Optional[str] = "mensile"
    premio_indicizzato: bool = False
    mutuo_id: Optional[uuid.UUID] = None
    copertura_percentuale: Optional[Decimal] = None
    capitale_assicurato: Optional[Decimal] = None
    istruzioni_eredi: Optional[str] = None
    documenti_dove: Optional[str] = None
    contatto_liquidazione: Optional[str] = None
    note: Optional[str] = None

class BeneficiarioCreate(BaseModel):
    nome_cognome: str
    relazione: Optional[str] = None
    codice_fiscale: Optional[str] = None
    data_nascita: Optional[date] = None
    recapito_telefono: Optional[str] = None
    recapito_email: Optional[str] = None
    percentuale_quota: Optional[Decimal] = None
    ordine: int = 1
    note: Optional[str] = None

class GaranziaCreate(BaseModel):
    tipo_garanzia: str
    descrizione: Optional[str] = None
    capitale_garantito: Optional[Decimal] = None
    percentuale_debito: Optional[Decimal] = None
    franchigia_giorni: Optional[int] = None
    massimale_mensile: Optional[Decimal] = None
    durata_massima_mesi: Optional[int] = None
    note: Optional[str] = None

class RiepilogoProtezione(BaseModel):
    totale_premio_mensile: Decimal
    n_polizze_attive: int
    copertura_caso_morte_totale: Decimal  # solo polizze rischio puro (TCM, vita_termine)
    copertura_cpi_effettiva: Decimal      # valore live basato su debiti residui
    valore_maturato_totale: Decimal       # valore riscatto polizze miste/risparmio (vita_intera)
    polizze: list[PolizzaOut]

class ReportEredi(BaseModel):
    generato_at: str
    sezioni: list[dict]  # struttura flessibile per rendering frontend


# ── HELPERS ─────────────────────────────────────────────────────────────────

async def _build_polizza_out(db: AsyncSession, row) -> PolizzaOut:
    """Costruisce PolizzaOut con garanzie, beneficiari e copertura live."""
    from sqlalchemy import text

    # Garanzie
    g_res = await db.execute(
        text("SELECT * FROM garanzie_polizza WHERE polizza_id = :pid ORDER BY id")
        .bindparams(pid=row.id)
    )
    garanzie = [GaranziaOut(**dict(r._mapping)) for r in g_res.fetchall()]

    # Beneficiari
    b_res = await db.execute(
        text("SELECT * FROM beneficiari_polizza WHERE polizza_id = :pid ORDER BY ordine, id")
        .bindparams(pid=row.id)
    )
    beneficiari = [BeneficiarioOut(**dict(r._mapping)) for r in b_res.fetchall()]

    # Mutuo nome + copertura effettiva live (per CPI)
    mutuo_nome = None
    copertura_live = None
    if row.mutuo_id:
        m_res = await db.execute(
            text("""
                SELECT m.nome,
                       m.capitale_erogato - COALESCE(SUM(pa.quota_capitale),0) as residuo_live
                FROM mutui m
                LEFT JOIN piano_ammortamento pa
                  ON pa.mutuo_id = m.id AND pa.data_scadenza <= CURRENT_DATE
                WHERE m.id = :mid
                GROUP BY m.nome, m.capitale_erogato
            """).bindparams(mid=row.mutuo_id)
        )
        mr = m_res.fetchone()
        if mr:
            mutuo_nome = mr.nome
            if row.copertura_percentuale:
                copertura_live = Decimal(str(mr.residuo_live)) * (row.copertura_percentuale / 100)

    return PolizzaOut(
        id=row.id,
        tipo=row.tipo,
        stato=row.stato,
        nome=row.nome,
        compagnia=row.compagnia,
        numero_polizza=row.numero_polizza,
        intermediario=row.intermediario,
        data_stipula=row.data_stipula,
        data_scadenza=row.data_scadenza,
        data_revisione=row.data_revisione,
        premio_importo=row.premio_importo,
        premio_periodicita=row.premio_periodicita,
        premio_indicizzato=row.premio_indicizzato,
        mutuo_id=row.mutuo_id,
        mutuo_nome=mutuo_nome,
        copertura_percentuale=row.copertura_percentuale,
        capitale_assicurato=row.capitale_assicurato,
        copertura_effettiva_live=copertura_live,
        istruzioni_eredi=row.istruzioni_eredi,
        documenti_dove=row.documenti_dove,
        contatto_liquidazione=row.contatto_liquidazione,
        note=row.note,
        attiva=row.attiva,
        garanzie=garanzie,
        beneficiari=beneficiari,
    )


# ── ENDPOINTS ────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[PolizzaOut])
async def get_polizze(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from sqlalchemy import text
    res = await db.execute(
        text("SELECT * FROM polizze_assicurative WHERE utente_id = :uid AND attiva = TRUE ORDER BY data_stipula DESC")
        .bindparams(uid=current_user.id)
    )
    rows = res.fetchall()
    out = []
    for row in rows:
        out.append(await _build_polizza_out(db, row))
    return out


@router.get("/riepilogo", response_model=RiepilogoProtezione)
async def get_riepilogo_protezione(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Riepilogo coperture assicurative: premi, capitali, CPI live."""
    from sqlalchemy import text
    res = await db.execute(
        text("SELECT * FROM polizze_assicurative WHERE utente_id = :uid AND attiva = TRUE AND stato = 'attiva'")
        .bindparams(uid=current_user.id)
    )
    rows = res.fetchall()

    polizze = []
    totale_premio_mensile = Decimal("0")
    copertura_morte_totale = Decimal("0")
    copertura_cpi_live = Decimal("0")
    valore_maturato_totale = Decimal("0")

    # Tipi rischio puro (non risparmio): hanno un capitale caso morte
    TIPI_RISCHIO_PURO = {"vita_termine", "tcm"}
    # Tipi misti risparmio: capitale_assicurato = valore riscatto, non copertura caso morte
    TIPI_RISPARMIO = {"vita_intera", "altro"}

    for row in rows:
        p = await _build_polizza_out(db, row)
        polizze.append(p)

        # Premio mensile equivalente (solo premio principale — garanzie monoannuali escluse)
        if p.premio_importo:
            factor = {"mensile": 1, "trimestrale": Decimal("1")/3, "semestrale": Decimal("1")/6,
                      "annuale": Decimal("1")/12, "unico": Decimal("0")}.get(p.premio_periodicita or "mensile", 1)
            totale_premio_mensile += p.premio_importo * Decimal(str(factor))

        # Capitale caso morte: solo polizze rischio puro
        if p.capitale_assicurato and p.tipo in TIPI_RISCHIO_PURO:
            copertura_morte_totale += p.capitale_assicurato

        # Valore maturato/riscatto: polizze risparmio (vita_intera = Capitale Differito)
        if p.capitale_assicurato and p.tipo in TIPI_RISPARMIO:
            valore_maturato_totale += p.capitale_assicurato

        # CPI live
        if p.copertura_effettiva_live:
            copertura_cpi_live += p.copertura_effettiva_live

    return RiepilogoProtezione(
        totale_premio_mensile=round(totale_premio_mensile, 2),
        n_polizze_attive=len(polizze),
        copertura_caso_morte_totale=copertura_morte_totale,
        copertura_cpi_effettiva=copertura_cpi_live,
        valore_maturato_totale=valore_maturato_totale,
        polizze=polizze,
    )


@router.get("/report-eredi", response_model=ReportEredi)
async def get_report_eredi(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Genera il report strutturato per gli eredi."""
    from datetime import datetime
    from sqlalchemy import text

    # Tutti i dati rilevanti
    pol_res = await db.execute(
        text("SELECT * FROM polizze_assicurative WHERE utente_id = :uid AND attiva = TRUE ORDER BY tipo, nome")
        .bindparams(uid=current_user.id)
    )
    polizze = []
    for row in pol_res.fetchall():
        polizze.append(await _build_polizza_out(db, row))

    # Mutui attivi
    mut_res = await db.execute(
        text("""
            SELECT m.nome, m.banca, m.capitale_erogato, m.rata_mensile, m.data_scadenza,
                   m.capitale_erogato - COALESCE(SUM(pa.quota_capitale),0) as residuo_live
            FROM mutui m
            LEFT JOIN piano_ammortamento pa ON pa.mutuo_id = m.id AND pa.data_scadenza <= CURRENT_DATE
            WHERE m.utente_id = :uid AND m.attivo = TRUE
            GROUP BY m.id, m.nome, m.banca, m.capitale_erogato, m.rata_mensile, m.data_scadenza
        """).bindparams(uid=current_user.id)
    )
    mutui = [dict(r._mapping) for r in mut_res.fetchall()]

    # Costruisci sezioni report
    sezioni = []

    # Sezione 1: Intestazione
    sezioni.append({
        "tipo": "intestazione",
        "titolo": "ISTRUZIONI OPERATIVE PER GLI EREDI",
        "testo": f"Documento generato il {datetime.now().strftime('%d/%m/%Y')}. "
                 "Questo documento contiene tutte le informazioni necessarie per gestire le pratiche assicurative "
                 "in caso di decesso o grave invalidità del titolare."
    })

    # Sezione 2a: Polizze miste/risparmio (vita_intera = Capitale Differito Antonio Pastore)
    polizze_risparmio = [p for p in polizze if p.tipo == 'vita_intera']
    if polizze_risparmio:
        items = []
        for p in polizze_risparmio:
            # Estrai garanzie complementari per il report
            garanzie_desc = [
                f"• {g.descrizione} ({g.note.split('Premio')[1].split('.')[0].strip() if g.note and 'Premio' in g.note else 'vedi condizioni'})"
                for g in p.garanzie
            ]
            item = {
                "nome": p.nome,
                "compagnia": p.compagnia,
                "numero_polizza": p.numero_polizza,
                "intermediario": p.intermediario,
                "stato": p.stato,
                "tipo_label": "Polizza Mista Rivalutabile (Capitale Differito)",
                "valore_riscatto_attuale": float(p.capitale_assicurato) if p.capitale_assicurato else None,
                "premio_rata": float(p.premio_importo) if p.premio_importo else None,
                "premio_periodicita": p.premio_periodicita,
                "scadenza": p.data_scadenza.isoformat() if p.data_scadenza else "Alla scadenza contrattuale (65° anno di età, differimento max 75 anni)",
                "garanzie_complementari": garanzie_desc,
                "beneficiari": [
                    {"nome": b.nome_cognome, "quota": float(b.percentuale_quota) if b.percentuale_quota else None,
                     "relazione": b.relazione, "telefono": b.recapito_telefono}
                    for b in p.beneficiari
                ],
                "documenti_dove": p.documenti_dove,
                "contatto_liquidazione": p.contatto_liquidazione,
                "istruzioni": p.istruzioni_eredi,
                "note_importanti": [
                    "Il capitale maturato (valore di riscatto) viene corrisposto agli aventi diritto in caso di decesso.",
                    "Per liquidare contattare l'intermediario ASSIDIR con: certificato di morte, documento identità erede, codice fiscale.",
                    "La polizza include garanzie complementari monoannuali (TCM, Dread Disease, Invalidità, LTC, Infortuni).",
                ]
            }
            items.append(item)
        sezioni.append({"tipo": "polizze_risparmio", "titolo": "POLIZZA MISTA / RISPARMIO ASSICURATIVO", "polizze": items})

    # Sezione 2b: Polizze vita rischio puro (TCM, vita_termine)
    polizze_vita = [p for p in polizze if p.tipo in ('vita_termine', 'tcm')]
    if polizze_vita:
        items = []
        for p in polizze_vita:
            item = {
                "nome": p.nome,
                "compagnia": p.compagnia,
                "numero_polizza": p.numero_polizza,
                "stato": p.stato,
                "capitale_assicurato": float(p.capitale_assicurato) if p.capitale_assicurato else None,
                "scadenza": p.data_scadenza.isoformat() if p.data_scadenza else "Vita intera",
                "beneficiari": [
                    {"nome": b.nome_cognome, "quota": float(b.percentuale_quota) if b.percentuale_quota else None,
                     "relazione": b.relazione, "telefono": b.recapito_telefono}
                    for b in p.beneficiari
                ],
                "documenti_dove": p.documenti_dove,
                "contatto_liquidazione": p.contatto_liquidazione,
                "istruzioni": p.istruzioni_eredi,
            }
            items.append(item)
        sezioni.append({"tipo": "polizze_vita", "titolo": "POLIZZE VITA (RISCHIO PURO)", "polizze": items})

    # Sezione 3: CPI mutui
    polizze_cpi = [p for p in polizze if p.tipo == 'cpi_mutuo']
    if polizze_cpi:
        items = []
        for p in polizze_cpi:
            item = {
                "nome": p.nome,
                "compagnia": p.compagnia,
                "mutuo_nome": p.mutuo_nome,
                "copertura_percentuale": float(p.copertura_percentuale) if p.copertura_percentuale else None,
                "copertura_effettiva_oggi": float(p.copertura_effettiva_live) if p.copertura_effettiva_live else None,
                "beneficiari": [{"nome": b.nome_cognome, "relazione": b.relazione} for b in p.beneficiari],
                "documenti_dove": p.documenti_dove,
                "contatto_liquidazione": p.contatto_liquidazione,
                "istruzioni": p.istruzioni_eredi,
            }
            items.append(item)
        sezioni.append({"tipo": "cpi_mutui", "titolo": "ASSICURAZIONI CPI SUI MUTUI", "polizze": items})

    # Sezione 4: Mutui con stato CPI
    if mutui:
        items_mutui = []
        for m in mutui:
            cpi_linked = [p for p in polizze_cpi if p.mutuo_nome and m["nome"] in p.mutuo_nome]
            items_mutui.append({
                "nome": m["nome"],
                "banca": m["banca"],
                "residuo_live": float(m["residuo_live"]),
                "rata_mensile": float(m["rata_mensile"]),
                "scadenza": m["data_scadenza"].isoformat() if m["data_scadenza"] else None,
                "coperto_da_cpi": len(cpi_linked) > 0,
                "cpi_note": cpi_linked[0].istruzioni_eredi if cpi_linked else "Nessuna CPI collegata",
            })
        sezioni.append({"tipo": "mutui", "titolo": "MUTUI IN CORSO", "mutui": items_mutui})

    # Sezione 5: Azioni immediate
    azioni = [
        "1. Notificare il decesso all'INPS/ente previdenziale entro 30 giorni",
        "2. Contattare le compagnie assicurative elencate sopra con certificato di morte",
        "3. Per le polizze CPI: contattare la banca mutuante per attivare la copertura sul mutuo",
        "4. Raccogliere tutti i documenti indicati nella sezione 'Dove trovare i documenti'",
        "5. Contattare il consulente finanziario/broker per supporto nelle pratiche di liquidazione",
    ]
    sezioni.append({"tipo": "azioni_immediate", "titolo": "AZIONI IMMEDIATE DA COMPIERE", "azioni": azioni})

    return ReportEredi(
        generato_at=datetime.now().isoformat(),
        sezioni=sezioni,
    )


@router.get("/{polizza_id}", response_model=PolizzaOut)
async def get_polizza(
    polizza_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from sqlalchemy import text
    res = await db.execute(
        text("SELECT * FROM polizze_assicurative WHERE id = :pid AND utente_id = :uid")
        .bindparams(pid=polizza_id, uid=current_user.id)
    )
    row = res.fetchone()
    if not row:
        raise HTTPException(404, "Polizza non trovata")
    return await _build_polizza_out(db, row)


@router.post("/", response_model=PolizzaOut, status_code=201)
async def create_polizza(
    body: PolizzaCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from sqlalchemy import text
    res = await db.execute(
        text("""
            INSERT INTO polizze_assicurative (
                utente_id, tipo, stato, nome, compagnia, numero_polizza, intermediario,
                data_stipula, data_scadenza, data_revisione,
                premio_importo, premio_periodicita, premio_indicizzato,
                mutuo_id, copertura_percentuale, capitale_assicurato,
                istruzioni_eredi, documenti_dove, contatto_liquidazione, note
            ) VALUES (
                :uid, :tipo, :stato, :nome, :compagnia, :num_pol, :interm,
                :data_stip, :data_scad, :data_rev,
                :premio, :periodicita, :indicizzato,
                :mutuo_id, :copertura_pct, :capitale,
                :istruzioni, :doc_dove, :contatto, :note
            ) RETURNING *
        """).bindparams(
            uid=current_user.id, tipo=body.tipo, stato=body.stato,
            nome=body.nome, compagnia=body.compagnia, num_pol=body.numero_polizza,
            interm=body.intermediario, data_stip=body.data_stipula,
            data_scad=body.data_scadenza, data_rev=body.data_revisione,
            premio=body.premio_importo, periodicita=body.premio_periodicita,
            indicizzato=body.premio_indicizzato, mutuo_id=body.mutuo_id,
            copertura_pct=body.copertura_percentuale, capitale=body.capitale_assicurato,
            istruzioni=body.istruzioni_eredi, doc_dove=body.documenti_dove,
            contatto=body.contatto_liquidazione, note=body.note,
        )
    )
    row = res.fetchone()
    await db.commit()
    return await _build_polizza_out(db, row)


@router.patch("/{polizza_id}", response_model=PolizzaOut)
async def update_polizza(
    polizza_id: uuid.UUID,
    body: PolizzaCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from sqlalchemy import text
    # Verifica ownership
    check = await db.execute(
        text("SELECT id FROM polizze_assicurative WHERE id = :pid AND utente_id = :uid")
        .bindparams(pid=polizza_id, uid=current_user.id)
    )
    if not check.fetchone():
        raise HTTPException(404, "Polizza non trovata")

    res = await db.execute(
        text("""
            UPDATE polizze_assicurative SET
                tipo=:tipo, stato=:stato, nome=:nome, compagnia=:compagnia,
                numero_polizza=:num_pol, intermediario=:interm,
                data_stipula=:data_stip, data_scadenza=:data_scad, data_revisione=:data_rev,
                premio_importo=:premio, premio_periodicita=:periodicita,
                premio_indicizzato=:indicizzato, mutuo_id=:mutuo_id,
                copertura_percentuale=:copertura_pct, capitale_assicurato=:capitale,
                istruzioni_eredi=:istruzioni, documenti_dove=:doc_dove,
                contatto_liquidazione=:contatto, note=:note,
                updated_at=NOW()
            WHERE id = :pid
            RETURNING *
        """).bindparams(
            pid=polizza_id, tipo=body.tipo, stato=body.stato,
            nome=body.nome, compagnia=body.compagnia, num_pol=body.numero_polizza,
            interm=body.intermediario, data_stip=body.data_stipula,
            data_scad=body.data_scadenza, data_rev=body.data_revisione,
            premio=body.premio_importo, periodicita=body.premio_periodicita,
            indicizzato=body.premio_indicizzato, mutuo_id=body.mutuo_id,
            copertura_pct=body.copertura_percentuale, capitale=body.capitale_assicurato,
            istruzioni=body.istruzioni_eredi, doc_dove=body.documenti_dove,
            contatto=body.contatto_liquidazione, note=body.note,
        )
    )
    row = res.fetchone()
    await db.commit()
    return await _build_polizza_out(db, row)


@router.post("/{polizza_id}/beneficiari", response_model=BeneficiarioOut, status_code=201)
async def add_beneficiario(
    polizza_id: uuid.UUID,
    body: BeneficiarioCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from sqlalchemy import text
    check = await db.execute(
        text("SELECT id FROM polizze_assicurative WHERE id = :pid AND utente_id = :uid")
        .bindparams(pid=polizza_id, uid=current_user.id)
    )
    if not check.fetchone():
        raise HTTPException(404, "Polizza non trovata")

    res = await db.execute(
        text("""
            INSERT INTO beneficiari_polizza (polizza_id, nome_cognome, relazione, codice_fiscale,
                data_nascita, recapito_telefono, recapito_email, percentuale_quota, ordine, note)
            VALUES (:pid, :nome, :relazione, :cf, :dn, :tel, :email, :quota, :ordine, :note)
            RETURNING *
        """).bindparams(
            pid=polizza_id, nome=body.nome_cognome, relazione=body.relazione,
            cf=body.codice_fiscale, dn=body.data_nascita, tel=body.recapito_telefono,
            email=body.recapito_email, quota=body.percentuale_quota,
            ordine=body.ordine, note=body.note,
        )
    )
    row = res.fetchone()
    await db.commit()
    return BeneficiarioOut(**dict(row._mapping))


@router.post("/{polizza_id}/garanzie", response_model=GaranziaOut, status_code=201)
async def add_garanzia(
    polizza_id: uuid.UUID,
    body: GaranziaCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from sqlalchemy import text
    check = await db.execute(
        text("SELECT id FROM polizze_assicurative WHERE id = :pid AND utente_id = :uid")
        .bindparams(pid=polizza_id, uid=current_user.id)
    )
    if not check.fetchone():
        raise HTTPException(404, "Polizza non trovata")

    res = await db.execute(
        text("""
            INSERT INTO garanzie_polizza (polizza_id, tipo_garanzia, descrizione,
                capitale_garantito, percentuale_debito, franchigia_giorni,
                massimale_mensile, durata_massima_mesi, note)
            VALUES (:pid, :tipo, :desc, :cap, :pct, :franch, :mass, :durata, :note)
            RETURNING *
        """).bindparams(
            pid=polizza_id, tipo=body.tipo_garanzia, desc=body.descrizione,
            cap=body.capitale_garantito, pct=body.percentuale_debito,
            franch=body.franchigia_giorni, mass=body.massimale_mensile,
            durata=body.durata_massima_mesi, note=body.note,
        )
    )
    row = res.fetchone()
    await db.commit()
    return GaranziaOut(**dict(row._mapping))
