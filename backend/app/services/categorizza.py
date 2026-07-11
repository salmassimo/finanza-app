"""Auto-categorizzazione movimenti bancari per parole chiave."""
import re

# (pattern_regex, nome_categoria)
REGOLE = [
    # Trasferimenti interni (giroconti / ricariche carta / bonifici tra propri conti)
    # → NON sono spese di consumo: esclusi dal confronto reddito/spese.
    (r"\bGIROCONTO\b|\bGIRCONTO\b|GIRO CONTO|GIROFONDI|RICARICA CARTA|TRASFERIMENTO TRA CONTI|GIRO DI FONDI|BONIFICO A ME STESSO", "Trasferimenti"),
    # Reddito
    (r"STIPENDIO|SALARIO|ACCREDITO STIPENDIO|PENSIONE|TREDICESIMA|QUATTORDICESIMA|VOSTRI EMOLUMENTI|BONIFICO.*FAVORE|ACCREDITO.*BONIFICO", "Reddito"),
    # Mutuo
    (r"RATA.*MUTUO|MUTUO|FINANZIAMENTO \d|PAGAMENTO RATA", "Mutuo"),
    # Utenze Casa — addebiti SEPA per fatture (gas, luce, acqua, condominio, ecc.)
    (r"ADDEBITO SEPA DD PER FATTURA|ADDEBITO SEPA.*BOLLETTA|ADDEBITO SEPA.*UTENZA", "Utenze Casa"),
    # Utenze — fornitori noti
    (r"ENEL|ENI GAS|ITALGAS|IREN|HERA|ACQUEDOTTO|BOLLETTA|ACEA|A2A|EDISON|SORGENIA", "Utenze Casa"),
    # Telecomunicazioni
    (r"\bTIM\b|VODAFONE|WIND TRE|WINDTRE|ILIAD|FASTWEB|TELECOM|SKY\b|DIGI", "Telecomunicazioni"),
    # Spesa Alimentare
    (r"ESSELUNGA|CARREFOUR|CONAD|COOP\b|LIDL|ALDI|PENNY|PAM\b|DESPAR|IPERMERCATO|SUPERMERCATO|MD\b|EUROSPIN|TODIS|SIMPLY", "Spesa Alimentare"),
    # Ristoranti
    (r"GLOVO|DELIVEROO|JUST.*EAT|UBER.*EAT|RISTORANTE|PIZZERIA|TRATTORIA|OSTERIA|BRACERIA|SNACK BAR|GELATERIA|PASTICCERIA|CAFFE\b|CAFE\b|BAR\b|TENUTA|DUCA\b|McDONALD|AUTOGRILL|BURGER KING|KFC\b", "Ristoranti"),
    # Shopping
    (r"AMAZON|AMZN|ZALANDO|ZARA\b|H&M|IKEA|MEDIAWORLD|MEDIA WORLD|UNIEURO|EURONICS|PRIMARK|SHEIN|ALIEXPRESS|ALIPAY|EBAY|VINTED|ABOUT YOU|ASOS|LEROY MERLIN|BRICO|FOOT LOCKER|MICHAEL KORS|INTREND|ALL4CYCLING|CICLI\b|CANYON BICYCLES|SILVER SHOP", "Shopping"),
    # Salute
    (r"FARMAC|FARMACIA|PARAFARMACIA|MEDIC|CLINICA|OSPEDALE|ASL\b|DENTIST|ORTODONT|OTTICA|SANITOP|PHARMACY|DR NEVEN|AZZURRA SPORT|SOCIETA SPORTIVA", "Salute"),
    # Trasporti
    (r"TRENITALIA|ITALO\b|ATM\b|METRO\b|ATAC|COTRAL|FLIXBUS|RYANAIR|EASYJET|WIZZ|ALITALIA|ITA\b|LUFTHANSA|PARCHEGGIO|AUTOSTRADA|Q8\b|ENI\b.*CARB|IP\b.*CARB|TAMOIL|TOTALENERGIES|BENZINA|BOLLO AUTO|ASSICURAZ.*AUTO|RC AUTO|FIUMICINO|DUTY FREE|AIRPORT", "Trasporti"),
    # Abbonamenti
    (r"NETFLIX|SPOTIFY|DISNEY\+|DAZN|AMAZON PRIME|APPLE\.COM|MICROSOFT|GOOGLE.*STORAGE|DROPBOX|CANVA|ADOBE|PIANO METAL|CANONE.*METAL", "Abbonamenti"),
    # Istruzione
    (r"SCUOLA|UNIVERSIT|CORSO\b|LEZIONE|ISTITUTO|ACCADEMIA|SCOLASTIC|SCHOOLPAY|SCUOLAPAY|GROWISHPAY", "Istruzione"),
    # Condominio
    (r"CONDOMINIO|AMMINISTRATORE", "Condominio"),
    # Animali
    (r"VETERINAR|PET\b|DOG\b|GATTO|ANIMALI|ZOOPLUS|MONDOZOO|PETS CITY|DOG TRAINER", "Animali"),
    # Contante
    (r"PRELIEVO|ATM\b|BANCOMAT|PRELIEVO DI CONTANTI", "Contante"),
    # Tasse
    (r"IMPOSTA BOLLO|IRPEF|F24\b|AGENZIA.*ENTRATE|COMUNE.*TRIB|IMU\b|TARI\b|TASSA|STAMP DUTY|ANNUAL STAMP", "Tasse"),
    # Investimenti — trasferimenti a conti deposito, crypto, investimento
    (r"FINECO|REVOLUT DIGITAL ASSETS|GIROCONTO.*FINECO|DISPOSIZIONE.*FINECO|CONTO DEPOSITO|CONTO DI INVESTIMENTO|AL CONTO DI INVESTIMENTO|FROM INVESTMENT", "Investimenti"),
    # Carta di Credito
    (r"PAGAMENTO.*CARTE|UTILIZZO CARTE|ESTRATTO.*CARTA", "Carta di Credito"),
    # Vacanze — hotel, resort, tour operator
    (r"RESORT|HOTEL\b|ALBERGO|B&B\b|AIRBNB|BOOKING\.COM|SAFARI\b|APPRODO|JAZ RIVIERA|EXPEDIA|TRIVAGO", "Vacanze"),
]

_COMPILED = [(re.compile(p, re.IGNORECASE), cat) for p, cat in REGOLE]


def auto_categorizza(descrizione: str, causale: str | None = None) -> str:
    """Ritorna il nome della categoria o 'Altro'."""
    testo = f"{descrizione} {causale or ''}".upper()
    for pattern, categoria in _COMPILED:
        if pattern.search(testo):
            return categoria
    return "Altro"
