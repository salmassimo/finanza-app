import uuid
from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import String, Numeric, Boolean, Integer, Date, Text, ForeignKey, Enum as SAEnum, JSON, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base
import enum

# ── ENUMS ──────────────────────────────────────────────
class TipoConto(str, enum.Enum):
    conto_corrente = "conto_corrente"
    deposito       = "deposito"
    carta_credito  = "carta_credito"
    investimento   = "investimento"
    altro          = "altro"

class TipoStrumento(str, enum.Enum):
    etf             = "etf"
    azione          = "azione"
    obbligazione    = "obbligazione"
    crypto          = "crypto"
    fondo           = "fondo"
    conto_deposito  = "conto_deposito"
    altro           = "altro"

class PiattaformaEnum(str, enum.Enum):
    fineco              = "Fineco"
    revolut_investimenti= "Revolut Investimenti"
    altro               = "altro"

class TipoMovimento(str, enum.Enum):
    entrata       = "entrata"
    uscita        = "uscita"
    trasferimento = "trasferimento"
    investimento  = "investimento"
    altro         = "altro"

# ── UTENTI ─────────────────────────────────────────────
class Utente(Base):
    __tablename__ = "utenti"

    id:            Mapped[uuid.UUID]  = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    nome:          Mapped[str]        = mapped_column(String(100))
    cognome:       Mapped[str]        = mapped_column(String(100))
    email:         Mapped[str]        = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str]        = mapped_column(String(255))
    totp_secret:   Mapped[str|None]   = mapped_column(String(32), nullable=True)
    totp_enabled:  Mapped[bool]       = mapped_column(Boolean, default=False)
    created_at:    Mapped[datetime]   = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    updated_at:    Mapped[datetime]   = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    conti:      Mapped[list["Conto"]]    = relationship(back_populates="utente")
    mutui:      Mapped[list["Mutuo"]]    = relationship(back_populates="utente")
    immobili:   Mapped[list["Immobile"]] = relationship(back_populates="utente")
    posizioni:  Mapped[list["Posizione"]]= relationship(back_populates="utente")
    orologi:    Mapped[list["Orologio"]] = relationship(back_populates="utente")
    movimenti:  Mapped[list["Movimento"]]= relationship(back_populates="utente")

# ── CONTI ──────────────────────────────────────────────
class Conto(Base):
    __tablename__ = "conti"

    id:             Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    utente_id:      Mapped[uuid.UUID] = mapped_column(ForeignKey("utenti.id", ondelete="CASCADE"))
    nome:           Mapped[str]       = mapped_column(String(150))
    tipo:           Mapped[TipoConto] = mapped_column(SAEnum(TipoConto), default=TipoConto.conto_corrente)
    banca:          Mapped[str|None]  = mapped_column(String(100))
    iban:           Mapped[str|None]  = mapped_column(String(34))
    valuta:         Mapped[str]       = mapped_column(String(3), default="EUR")
    attivo:         Mapped[bool]      = mapped_column(Boolean, default=True)
    psd2_account_id:Mapped[str|None]  = mapped_column(String(255))
    psd2_provider:  Mapped[str|None]  = mapped_column(String(100))
    psd2_last_sync: Mapped[datetime|None] = mapped_column(TIMESTAMP(timezone=True))
    note:           Mapped[str|None]  = mapped_column(Text)
    created_at:     Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    updated_at:     Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    utente:   Mapped["Utente"]             = relationship(back_populates="conti")
    saldi:    Mapped[list["SaldoSnapshot"]] = relationship(back_populates="conto", order_by="SaldoSnapshot.rilevato_at.desc()")

class SaldoSnapshot(Base):
    __tablename__ = "saldi_snapshot"

    id:          Mapped[int]       = mapped_column(Integer, primary_key=True, autoincrement=True)
    conto_id:    Mapped[uuid.UUID] = mapped_column(ForeignKey("conti.id", ondelete="CASCADE"))
    saldo:       Mapped[Decimal]   = mapped_column(Numeric(15, 2))
    fonte:       Mapped[str]       = mapped_column(String(50), default="manuale")
    rilevato_at: Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    note:        Mapped[str|None]  = mapped_column(Text)

    conto: Mapped["Conto"] = relationship(back_populates="saldi")

# ── MUTUI ──────────────────────────────────────────────
class Mutuo(Base):
    __tablename__ = "mutui"

    id:               Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    utente_id:        Mapped[uuid.UUID] = mapped_column(ForeignKey("utenti.id", ondelete="CASCADE"))
    nome:             Mapped[str]       = mapped_column(String(150))
    banca:            Mapped[str]       = mapped_column(String(100))
    numero_contratto: Mapped[str|None]  = mapped_column(String(100))
    capitale_erogato: Mapped[Decimal]   = mapped_column(Numeric(12, 2))
    capitale_residuo: Mapped[Decimal]   = mapped_column(Numeric(12, 2))
    tasso_tipo:       Mapped[str]       = mapped_column(String(20), default="fisso")
    tasso_valore:     Mapped[Decimal|None] = mapped_column(Numeric(6, 4))
    rata_mensile:     Mapped[Decimal]   = mapped_column(Numeric(10, 2))
    rate_totali:      Mapped[int]       = mapped_column(Integer)
    rate_pagate:      Mapped[int]       = mapped_column(Integer, default=0)
    data_erogazione:  Mapped[date]      = mapped_column(Date)
    data_scadenza:    Mapped[date]      = mapped_column(Date)
    immobile_id:      Mapped[uuid.UUID|None] = mapped_column(ForeignKey("immobili.id", ondelete="SET NULL"))
    attivo:           Mapped[bool]      = mapped_column(Boolean, default=True)
    created_at:       Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    updated_at:       Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    utente:    Mapped["Utente"]                 = relationship(back_populates="mutui")
    snapshots: Mapped[list["MutuoSnapshot"]]    = relationship(back_populates="mutuo")
    piano:     Mapped[list["PianoAmmortamento"]]= relationship(back_populates="mutuo")

class MutuoSnapshot(Base):
    __tablename__ = "mutui_snapshot"

    id:               Mapped[int]       = mapped_column(Integer, primary_key=True, autoincrement=True)
    mutuo_id:         Mapped[uuid.UUID] = mapped_column(ForeignKey("mutui.id", ondelete="CASCADE"))
    capitale_residuo: Mapped[Decimal]   = mapped_column(Numeric(12, 2))
    rate_pagate:      Mapped[int]       = mapped_column(Integer)
    rilevato_at:      Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow)

    mutuo: Mapped["Mutuo"] = relationship(back_populates="snapshots")

class PianoAmmortamento(Base):
    __tablename__ = "piano_ammortamento"

    id:              Mapped[int]       = mapped_column(Integer, primary_key=True, autoincrement=True)
    mutuo_id:        Mapped[uuid.UUID] = mapped_column(ForeignKey("mutui.id", ondelete="CASCADE"))
    numero_rata:     Mapped[int]       = mapped_column(Integer)
    data_scadenza:   Mapped[date]      = mapped_column(Date)
    quota_capitale:  Mapped[Decimal]   = mapped_column(Numeric(10, 2))
    quota_interessi: Mapped[Decimal]   = mapped_column(Numeric(10, 2))
    rata_totale:     Mapped[Decimal]   = mapped_column(Numeric(10, 2))
    pagata:                Mapped[bool]          = mapped_column(Boolean, default=False)
    data_pagamento:        Mapped[date|None]     = mapped_column(Date)
    capitale_residuo_dopo: Mapped[Decimal|None]  = mapped_column(Numeric(12, 2), nullable=True)

    mutuo: Mapped["Mutuo"] = relationship(back_populates="piano")

# ── IMMOBILI ───────────────────────────────────────────
class Immobile(Base):
    __tablename__ = "immobili"

    id:             Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    utente_id:      Mapped[uuid.UUID] = mapped_column(ForeignKey("utenti.id", ondelete="CASCADE"))
    nome:           Mapped[str]       = mapped_column(String(150))
    descrizione:    Mapped[str|None]  = mapped_column(Text)
    indirizzo:      Mapped[str|None]  = mapped_column(Text)
    tipo:           Mapped[str]       = mapped_column(String(50), default="residenziale")
    superficie_mq:  Mapped[Decimal|None] = mapped_column(Numeric(8, 2))
    valore_acquisto:Mapped[Decimal|None] = mapped_column(Numeric(12, 2))
    data_acquisto:  Mapped[date|None] = mapped_column(Date)
    attivo:         Mapped[bool]      = mapped_column(Boolean, default=True)
    created_at:     Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    updated_at:     Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    utente:     Mapped["Utente"]                  = relationship(back_populates="immobili")
    snapshots:  Mapped[list["ImmobileSnapshot"]]  = relationship(back_populates="immobile")
    mutui:      Mapped[list["Mutuo"]]             = relationship(foreign_keys="Mutuo.immobile_id")

class ImmobileSnapshot(Base):
    __tablename__ = "immobili_snapshot"

    id:             Mapped[int]       = mapped_column(Integer, primary_key=True, autoincrement=True)
    immobile_id:    Mapped[uuid.UUID] = mapped_column(ForeignKey("immobili.id", ondelete="CASCADE"))
    valore_mercato: Mapped[Decimal]   = mapped_column(Numeric(12, 2))
    fonte:          Mapped[str|None]  = mapped_column(String(100))
    rilevato_at:    Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    note:           Mapped[str|None]  = mapped_column(Text)

    immobile: Mapped["Immobile"] = relationship(back_populates="snapshots")

# ── PORTAFOGLIO ────────────────────────────────────────
class Strumento(Base):
    __tablename__ = "strumenti"

    id:       Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    simbolo:  Mapped[str]            = mapped_column(String(30), unique=True, index=True)
    isin:     Mapped[str|None]       = mapped_column(String(12))
    nome:     Mapped[str]            = mapped_column(String(255))
    tipo:     Mapped[TipoStrumento]  = mapped_column(SAEnum(TipoStrumento))
    valuta:   Mapped[str]            = mapped_column(String(3), default="EUR")
    mercato:  Mapped[str|None]       = mapped_column(String(50))
    attivo:   Mapped[bool]           = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime]     = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow)

    posizioni: Mapped[list["Posizione"]]    = relationship(back_populates="strumento")
    prezzi:    Mapped[list["PrezzoSnapshot"]]= relationship(back_populates="strumento")

class Posizione(Base):
    __tablename__ = "posizioni"

    id:              Mapped[uuid.UUID]      = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    utente_id:       Mapped[uuid.UUID]      = mapped_column(ForeignKey("utenti.id", ondelete="CASCADE"))
    strumento_id:    Mapped[uuid.UUID]      = mapped_column(ForeignKey("strumenti.id"))
    piattaforma:     Mapped[PiattaformaEnum]= mapped_column(SAEnum(PiattaformaEnum), default=PiattaformaEnum.fineco)
    quantita:        Mapped[Decimal]        = mapped_column(Numeric(18, 6))
    prezzo_carico:   Mapped[Decimal]        = mapped_column(Numeric(15, 6))
    valore_carico:   Mapped[Decimal]        = mapped_column(Numeric(15, 2))
    data_primo_acquisto: Mapped[date|None]  = mapped_column(Date)
    attivo:          Mapped[bool]           = mapped_column(Boolean, default=True)
    note:            Mapped[str|None]       = mapped_column(Text)
    created_at:      Mapped[datetime]       = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    updated_at:      Mapped[datetime]       = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    utente:    Mapped["Utente"]                  = relationship(back_populates="posizioni")
    strumento: Mapped["Strumento"]               = relationship(back_populates="posizioni")
    snapshots: Mapped[list["PosizioneSnapshot"]] = relationship(back_populates="posizione")

class PrezzoSnapshot(Base):
    __tablename__ = "prezzi_snapshot"

    id:          Mapped[int]       = mapped_column(Integer, primary_key=True, autoincrement=True)
    strumento_id:Mapped[uuid.UUID] = mapped_column(ForeignKey("strumenti.id", ondelete="CASCADE"), index=True)
    prezzo:      Mapped[Decimal]   = mapped_column(Numeric(18, 6))
    valuta:      Mapped[str]       = mapped_column(String(3), default="EUR")
    fonte:       Mapped[str]       = mapped_column(String(50), default="manuale")
    rilevato_at: Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow, index=True)

    strumento: Mapped["Strumento"] = relationship(back_populates="prezzi")

class PosizioneSnapshot(Base):
    __tablename__ = "posizioni_snapshot"

    id:             Mapped[int]       = mapped_column(Integer, primary_key=True, autoincrement=True)
    posizione_id:   Mapped[uuid.UUID] = mapped_column(ForeignKey("posizioni.id", ondelete="CASCADE"), index=True)
    quantita:       Mapped[Decimal]   = mapped_column(Numeric(18, 6))
    prezzo_mercato: Mapped[Decimal]   = mapped_column(Numeric(18, 6))
    valore_mercato: Mapped[Decimal]   = mapped_column(Numeric(15, 2))
    var_eur:        Mapped[Decimal]   = mapped_column(Numeric(15, 2))
    var_pct:        Mapped[Decimal]   = mapped_column(Numeric(8, 4))
    rilevato_at:    Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow, index=True)

    posizione: Mapped["Posizione"] = relationship(back_populates="snapshots")

# ── OROLOGI ────────────────────────────────────────────
class Orologio(Base):
    __tablename__ = "orologi"

    id:              Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    utente_id:       Mapped[uuid.UUID] = mapped_column(ForeignKey("utenti.id", ondelete="CASCADE"))
    marca:           Mapped[str]       = mapped_column(String(100))
    modello:         Mapped[str]       = mapped_column(String(150))
    riferimento:     Mapped[str|None]  = mapped_column(String(50))
    anno_acquisto:   Mapped[int|None]  = mapped_column(Integer)
    prezzo_acquisto: Mapped[Decimal|None] = mapped_column(Numeric(10, 2))
    attivo:          Mapped[bool]      = mapped_column(Boolean, default=True)
    note:            Mapped[str|None]  = mapped_column(Text)
    created_at:      Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow)

    utente:    Mapped["Utente"]                 = relationship(back_populates="orologi")
    snapshots: Mapped[list["OrologioSnapshot"]] = relationship(back_populates="orologio")

class OrologioSnapshot(Base):
    __tablename__ = "orologi_snapshot"

    id:          Mapped[int]       = mapped_column(Integer, primary_key=True, autoincrement=True)
    orologio_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orologi.id", ondelete="CASCADE"))
    stima_min:   Mapped[Decimal]   = mapped_column(Numeric(10, 2))
    stima_max:   Mapped[Decimal]   = mapped_column(Numeric(10, 2))
    fonte:       Mapped[str|None]  = mapped_column(String(100))
    rilevato_at: Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    note:        Mapped[str|None]  = mapped_column(Text)

    orologio: Mapped["Orologio"] = relationship(back_populates="snapshots")

# ── MOVIMENTI ──────────────────────────────────────────
class CategoriaSpesa(Base):
    __tablename__ = "categorie_spese"

    id:       Mapped[int]      = mapped_column(Integer, primary_key=True, autoincrement=True)
    nome:     Mapped[str]      = mapped_column(String(100), unique=True)
    colore:   Mapped[str|None] = mapped_column(String(7))
    icona:    Mapped[str|None] = mapped_column(String(50))   # ionicons name
    ordine:   Mapped[int]      = mapped_column(Integer, default=99)

class Movimento(Base):
    __tablename__ = "movimenti"

    id:               Mapped[uuid.UUID]     = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    utente_id:        Mapped[uuid.UUID]     = mapped_column(ForeignKey("utenti.id", ondelete="CASCADE"), index=True)
    conto_id:         Mapped[uuid.UUID|None]= mapped_column(ForeignKey("conti.id", ondelete="SET NULL"))
    categoria_id:     Mapped[int|None]      = mapped_column(ForeignKey("categorie_spese.id", ondelete="SET NULL"))
    tipo:             Mapped[TipoMovimento] = mapped_column(SAEnum(TipoMovimento), default=TipoMovimento.uscita)
    importo:          Mapped[Decimal]       = mapped_column(Numeric(12, 2))
    descrizione:      Mapped[str|None]      = mapped_column(String(500))
    data_operazione:  Mapped[date]          = mapped_column(Date, index=True)
    data_valuta:      Mapped[date|None]     = mapped_column(Date)
    causale:          Mapped[str|None]      = mapped_column(String(20))      # codice causale banca
    is_carta_credito: Mapped[bool]          = mapped_column(Boolean, default=False, index=True)
    fonte:            Mapped[str]           = mapped_column(String(50), default="manuale")
    external_id:      Mapped[str|None]      = mapped_column(String(255), unique=True, index=True)
    note:             Mapped[str|None]      = mapped_column(Text)
    created_at:       Mapped[datetime]      = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow)

    utente:    Mapped["Utente"]              = relationship(back_populates="movimenti")
    conto:     Mapped["Conto|None"]          = relationship()
    categoria: Mapped["CategoriaSpesa|None"] = relationship()

# Categorie default da seed
CATEGORIE_DEFAULT = [
    {"nome": "Reddito",           "colore": "#4ADE80", "icona": "trending-up",      "ordine": 1},
    {"nome": "Mutuo",             "colore": "#F87171", "icona": "home",             "ordine": 2},
    {"nome": "Spesa Alimentare",  "colore": "#FB923C", "icona": "cart",             "ordine": 3},
    {"nome": "Ristoranti",        "colore": "#FBBF24", "icona": "restaurant",       "ordine": 4},
    {"nome": "Shopping",          "colore": "#A78BFA", "icona": "bag-handle",       "ordine": 5},
    {"nome": "Trasporti",         "colore": "#38BDF8", "icona": "car",              "ordine": 6},
    {"nome": "Utenze",            "colore": "#34D399", "icona": "flash",            "ordine": 7},
    {"nome": "Telecomunicazioni", "colore": "#22D3EE", "icona": "phone-portrait",   "ordine": 8},
    {"nome": "Salute",            "colore": "#F472B6", "icona": "medkit",           "ordine": 9},
    {"nome": "Istruzione",        "colore": "#60A5FA", "icona": "school",           "ordine": 10},
    {"nome": "Abbonamenti",       "colore": "#818CF8", "icona": "repeat",           "ordine": 11},
    {"nome": "Condominio",        "colore": "#6EE7B7", "icona": "business",         "ordine": 12},
    {"nome": "Animali",           "colore": "#FCD34D", "icona": "paw",              "ordine": 13},
    {"nome": "Contante",          "colore": "#D1D5DB", "icona": "cash",             "ordine": 14},
    {"nome": "Tasse",             "colore": "#EF4444", "icona": "receipt",          "ordine": 15},
    {"nome": "Investimenti",      "colore": "#10B981", "icona": "analytics",        "ordine": 16},
    {"nome": "Bonifici",          "colore": "#94A3B8", "icona": "swap-horizontal",  "ordine": 17},
    {"nome": "Carta di Credito",  "colore": "#6B7280", "icona": "card",             "ordine": 18},
    {"nome": "Altro",             "colore": "#9CA3AF", "icona": "ellipsis-horizontal","ordine": 99},
]

# ── PATRIMONIO SNAPSHOT ────────────────────────────────
class PatrimonioSnapshot(Base):
    __tablename__ = "patrimonio_snapshot"

    id:                  Mapped[int]       = mapped_column(Integer, primary_key=True, autoincrement=True)
    utente_id:           Mapped[uuid.UUID] = mapped_column(ForeignKey("utenti.id", ondelete="CASCADE"), index=True)
    liquidita_totale:    Mapped[Decimal]   = mapped_column(Numeric(15, 2), default=0)
    portafoglio_fineco:  Mapped[Decimal]   = mapped_column(Numeric(15, 2), default=0)
    portafoglio_revolut: Mapped[Decimal]   = mapped_column(Numeric(15, 2), default=0)
    immobili_valore:     Mapped[Decimal]   = mapped_column(Numeric(15, 2), default=0)
    orologi_valore:      Mapped[Decimal]   = mapped_column(Numeric(15, 2), default=0)
    totale_asset:        Mapped[Decimal]   = mapped_column(Numeric(15, 2), default=0)
    mutuo_uc_residuo:    Mapped[Decimal]   = mapped_column(Numeric(15, 2), default=0)
    mutuo_ca_residuo:    Mapped[Decimal]   = mapped_column(Numeric(15, 2), default=0)
    carte_credito:       Mapped[Decimal]   = mapped_column(Numeric(15, 2), default=0)
    totale_passivo:      Mapped[Decimal]   = mapped_column(Numeric(15, 2), default=0)
    patrimonio_netto:    Mapped[Decimal]   = mapped_column(Numeric(15, 2), default=0)
    rilevato_at:         Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow, index=True)

    utente: Mapped["Utente"] = relationship()


# ── FONDO PENSIONE ─────────────────────────────────────
class FondoPensione(Base):
    __tablename__ = "fondi_pensione"

    id:         Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    utente_id:  Mapped[uuid.UUID] = mapped_column(ForeignKey("utenti.id", ondelete="CASCADE"), index=True)
    nome:       Mapped[str]       = mapped_column(String(150))          # es. "Mario Negri"
    tipo:       Mapped[str]       = mapped_column(String(50), default="chiuso")  # chiuso|aperto|pip
    note:       Mapped[str|None]  = mapped_column(Text)
    created_at: Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    snapshots: Mapped[list["FondoPensioneSnapshot"]] = relationship(back_populates="fondo", order_by="FondoPensioneSnapshot.rilevato_at.desc()")


class FondoPensioneSnapshot(Base):
    __tablename__ = "fondi_pensione_snapshot"

    id:                  Mapped[int]        = mapped_column(Integer, primary_key=True, autoincrement=True)
    fondo_id:            Mapped[uuid.UUID]  = mapped_column(ForeignKey("fondi_pensione.id", ondelete="CASCADE"), index=True)
    data_riferimento:    Mapped[date]       = mapped_column(Date)                     # data estratto conto
    saldo_individuale:   Mapped[Decimal]    = mapped_column(Numeric(12, 2))           # saldo conto individuale
    tfr_maturato:        Mapped[Decimal]    = mapped_column(Numeric(12, 2))           # TFR pervenuto
    totale_posizione:    Mapped[Decimal]    = mapped_column(Numeric(12, 2))           # totale posizione individuale
    versamenti_ytd:      Mapped[Decimal|None] = mapped_column(Numeric(12, 2))        # versamenti anno in corso
    risultato_esercizio: Mapped[Decimal|None] = mapped_column(Numeric(12, 2))        # attribuzione risultato esercizio
    anzianita_anni:      Mapped[int]        = mapped_column(Integer, default=0)
    anzianita_mesi:      Mapped[int]        = mapped_column(Integer, default=0)
    anzianita_giorni:    Mapped[int]        = mapped_column(Integer, default=0)
    fonte:               Mapped[str]        = mapped_column(String(50), default="manuale")
    rilevato_at:         Mapped[datetime]   = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow, index=True)
    note:                Mapped[str|None]   = mapped_column(Text)

    fondo: Mapped["FondoPensione"] = relationship(back_populates="snapshots")


# ── OBIETTIVI FINANZIARI ───────────────────────────────
class ObiettivoFinanziario(Base):
    __tablename__ = "obiettivi_finanziari"

    id:             Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    utente_id:      Mapped[uuid.UUID] = mapped_column(ForeignKey("utenti.id", ondelete="CASCADE"), index=True)
    nome:           Mapped[str]       = mapped_column(String(150))
    descrizione:    Mapped[str|None]  = mapped_column(Text)
    # tipo: patrimonio_netto | liquidita | portafoglio | zero_mutui | fondo_pensione | libero
    tipo:           Mapped[str]       = mapped_column(String(50), default="patrimonio_netto")
    target_importo: Mapped[Decimal|None] = mapped_column(Numeric(15, 2))
    target_data:    Mapped[date]      = mapped_column(Date)
    attivo:         Mapped[bool]      = mapped_column(Boolean, default=True)
    created_at:     Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow)


# ── PAC - Piani di Accumulo del Capitale ──────────────
class PianoAccumulo(Base):
    __tablename__ = "piani_accumulo"

    id:                    Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    utente_id:             Mapped[uuid.UUID] = mapped_column(ForeignKey("utenti.id", ondelete="CASCADE"), index=True)
    nome:                  Mapped[str]       = mapped_column(String(150))
    piattaforma:           Mapped[str]       = mapped_column(String(100), default="Fineco")
    stato:                 Mapped[str]       = mapped_column(String(20), default="attivo")   # attivo | sospeso | chiuso
    periodicita:           Mapped[str]       = mapped_column(String(30), default="mensile")  # mensile | bimestrale | trimestrale
    giorno_esecuzione:     Mapped[int]       = mapped_column(Integer, default=1)
    costo_per_strumento:   Mapped[Decimal]   = mapped_column(Numeric(8, 2), default=0)
    data_inizio:           Mapped[date|None] = mapped_column(Date)
    prossimo_investimento: Mapped[date|None] = mapped_column(Date)
    note:                  Mapped[str|None]  = mapped_column(Text)
    created_at:            Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    updated_at:            Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    strumenti: Mapped[list["PianoAccumuloStrumento"]] = relationship(back_populates="piano", cascade="all, delete-orphan")


class PianoAccumuloStrumento(Base):
    __tablename__ = "piani_accumulo_strumenti"

    id:              Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    piano_id:        Mapped[uuid.UUID] = mapped_column(ForeignKey("piani_accumulo.id", ondelete="CASCADE"), index=True)
    nome_etf:        Mapped[str]       = mapped_column(String(255))
    simbolo:         Mapped[str|None]  = mapped_column(String(30))
    isin:            Mapped[str|None]  = mapped_column(String(12))
    importo_target:  Mapped[Decimal]   = mapped_column(Numeric(10, 2), default=0)
    quantita_target: Mapped[int]       = mapped_column(Integer, default=1)
    attivo:          Mapped[bool]      = mapped_column(Boolean, default=True)
    posizione_id:    Mapped[uuid.UUID|None] = mapped_column(ForeignKey("posizioni.id", ondelete="SET NULL"), nullable=True)

    piano: Mapped["PianoAccumulo"] = relationship(back_populates="strumenti")


# ── BUSTE PAGA / REDDITO ───────────────────────────────
class BustaPaga(Base):
    __tablename__ = "buste_paga"

    id:                 Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    utente_id:          Mapped[uuid.UUID] = mapped_column(ForeignKey("utenti.id", ondelete="CASCADE"), index=True)
    anno:               Mapped[int]       = mapped_column(Integer, index=True)
    mese:               Mapped[int]       = mapped_column(Integer)                 # 1-12
    azienda:            Mapped[str|None]  = mapped_column(String(150))
    # ordinaria | tredicesima | quattordicesima | premio | una_tantum | altro
    tipo_mensilita:     Mapped[str]       = mapped_column(String(30), default="ordinaria")
    totale_competenze:  Mapped[Decimal]   = mapped_column(Numeric(12, 2), default=0)  # lordo
    totale_trattenute:  Mapped[Decimal]   = mapped_column(Numeric(12, 2), default=0)
    netto:              Mapped[Decimal]   = mapped_column(Numeric(12, 2), default=0)  # netto in busta
    voci:               Mapped[dict|None] = mapped_column(JSON)                     # [{descrizione, importo}]
    fonte:              Mapped[str]       = mapped_column(String(50), default="pdf")
    external_id:        Mapped[str|None]  = mapped_column(String(255), index=True)  # dedup
    note:               Mapped[str|None]  = mapped_column(Text)
    created_at:         Mapped[datetime]  = mapped_column(TIMESTAMP(timezone=True), default=datetime.utcnow)

