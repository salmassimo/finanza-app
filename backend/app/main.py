from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from app.core.config import settings
from app.api.v1.endpoints import auth, utenti, conti, mutui, immobili, portafoglio, orologi, movimenti, patrimonio, prezzi, importa, advisor, fondi_pensione, proiezione, alert, obiettivi, polizze, pac, news, reddito

scheduler = AsyncIOScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.db.session import engine, Base, AsyncSessionLocal
    from sqlalchemy import text
    import app.models.models as m  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Aggiungi colonne nuove a movimenti se non esistono
        for stmt in [
            "ALTER TABLE movimenti ADD COLUMN IF NOT EXISTS data_valuta DATE",
            "ALTER TABLE movimenti ADD COLUMN IF NOT EXISTS causale VARCHAR(20)",
            "ALTER TABLE movimenti ADD COLUMN IF NOT EXISTS is_carta_credito BOOLEAN DEFAULT FALSE",
            "ALTER TABLE movimenti ADD COLUMN IF NOT EXISTS external_id VARCHAR(255)",
            "ALTER TABLE categorie_spese ADD COLUMN IF NOT EXISTS icona VARCHAR(50)",
            "ALTER TABLE categorie_spese ADD COLUMN IF NOT EXISTS ordine INTEGER DEFAULT 99",
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_movimenti_external_id ON movimenti(external_id) WHERE external_id IS NOT NULL",
            "ALTER TABLE piano_ammortamento ADD COLUMN IF NOT EXISTS capitale_residuo_dopo NUMERIC(12,2)",
            "ALTER TABLE buste_paga ADD COLUMN IF NOT EXISTS file_nome VARCHAR(255)",
            "ALTER TABLE buste_paga ADD COLUMN IF NOT EXISTS file_pdf BYTEA",
        ]:
            await conn.execute(text(stmt))

        from app.db.analytics import create_analytics_views
        await create_analytics_views(conn)

    # Seed categorie spese
    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        from app.models.models import CategoriaSpesa, CATEGORIE_DEFAULT
        for cat in CATEGORIE_DEFAULT:
            exists = await db.execute(select(CategoriaSpesa).where(CategoriaSpesa.nome == cat["nome"]))
            if not exists.scalar_one_or_none():
                db.add(CategoriaSpesa(**cat))
        await db.commit()

    # Avvia scheduler cron job aggiornamento prezzi alle 18:30 ogni giorno
    from app.db.session import AsyncSessionLocal
    from app.services.prezzi import aggiorna_tutti_i_prezzi

    async def job_aggiorna_prezzi():
        async with AsyncSessionLocal() as db:
            # In produzione: iterare su tutti gli utenti attivi
            UTENTE_MASSIMO = "00000000-0000-0000-0000-000000000001"
            await aggiorna_tutti_i_prezzi(db, UTENTE_MASSIMO)
            print("[CRON] Prezzi aggiornati")

    scheduler.add_job(job_aggiorna_prezzi, "cron", hour=18, minute=30)
    scheduler.start()
    yield
    scheduler.shutdown()

app = FastAPI(
    title=settings.APP_NAME,
    description="API per la gestione del patrimonio personale",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Router
app.include_router(auth.router,        prefix="/api/v1/auth",        tags=["Auth"])
app.include_router(utenti.router,      prefix="/api/v1/utenti",      tags=["Utenti"])
app.include_router(conti.router,       prefix="/api/v1/conti",       tags=["Conti"])
app.include_router(mutui.router,       prefix="/api/v1/mutui",       tags=["Mutui"])
app.include_router(immobili.router,    prefix="/api/v1/immobili",    tags=["Immobili"])
app.include_router(portafoglio.router, prefix="/api/v1/portafoglio", tags=["Portafoglio"])
app.include_router(orologi.router,     prefix="/api/v1/orologi",     tags=["Orologi"])
app.include_router(movimenti.router,   prefix="/api/v1/movimenti",   tags=["Movimenti"])
app.include_router(patrimonio.router,  prefix="/api/v1/patrimonio",  tags=["Patrimonio"])
app.include_router(prezzi.router,      prefix="/api/v1/prezzi",      tags=["Prezzi"])
app.include_router(importa.router,     prefix="/api/v1/importa",     tags=["Import"])
app.include_router(advisor.router,        prefix="/api/v1/advisor",        tags=["Advisor"])
app.include_router(fondi_pensione.router, prefix="/api/v1/fondi-pensione", tags=["Fondi Pensione"])
app.include_router(proiezione.router,     prefix="/api/v1/proiezione",    tags=["Proiezione"])
app.include_router(alert.router,          prefix="/api/v1/alert",         tags=["Alert"])
app.include_router(obiettivi.router,      prefix="/api/v1/obiettivi",     tags=["Obiettivi"])
app.include_router(polizze.router,        prefix="/api/v1/polizze",        tags=["Polizze"])
app.include_router(pac.router,            prefix="/api/v1/pac",            tags=["PAC"])
app.include_router(news.router,           prefix="/api/v1/news",           tags=["News"])
app.include_router(reddito.router,        prefix="/api/v1/reddito",        tags=["Reddito"])

@app.get("/health")
async def health():
    return {"status": "ok", "app": settings.APP_NAME}
