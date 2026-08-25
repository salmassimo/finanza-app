# Finanza App — contesto progetto (per Claude Code)

App di gestione patrimonio personale. Backend FastAPI + PostgreSQL, frontend
React Native/Expo servito come web app. Tutto in Docker. Deploy su NAS Synology.

## Stack
- **Backend**: Python 3.11, FastAPI async, SQLAlchemy 2 async, PostgreSQL 15 (asyncpg).
  JWT + 2FA TOTP (pyotp). AI via Anthropic API (advisor, news, traduzione, analisi
  buste paga, valutazione orologi). pdfplumber/pandas/openpyxl/xlrd per import.
- **Frontend**: Expo SDK 51 + React Native Web (TypeScript), React Navigation (drawer +
  top-nav custom responsive), @tanstack/react-query, react-native-svg (grafici custom).
- **Infra**: docker-compose (db, backend, frontend). Repo GitHub, deploy pull-based sul NAS.

## Repository e deploy
- Repo: `https://github.com/salmassimo/finanza-app` (branch `master`).
- Flusso: si lavora in locale → `git push` → sul NAS `sudo sh /var/services/homes/sistema/deploy.sh`
  (scarica il tarball, ricostruisce, preserva `.env.prod` e i dati). C'è anche un
  auto-deploy pull-based via Task Scheduler DSM (`auto-deploy.sh`).
- NAS Synology DS218+ (x86_64): IP LAN `192.168.178.106`, app su `:19006`, API `:8000`.
  Accesso da fuori casa via VPN WireGuard del FritzBox (solo-LAN, niente porte aperte).
- Utente SSH deploy sul NAS: `sistema` (home `/var/services/homes/sistema`).

## Sviluppo locale
1. `git clone https://github.com/salmassimo/finanza-app.git`
2. Crea `backend/.env` (NON in git):
   ```
   DATABASE_URL=postgresql+asyncpg://finanza_user:finanza_pass@db:5432/finanza_db
   SECRET_KEY=finanza-app-secret-key-2024
   ANTHROPIC_API_KEY=sk-ant-...            # la tua chiave Anthropic
   ```
3. `docker compose up -d --build`  → frontend su http://localhost:19006, API su :8000.
4. Login utente: `sal.massimo@gmail.com` (2FA attivo). Per test si può generare un token:
   `docker compose exec -T backend python -c "from app.core.security import create_access_token; print(create_access_token({'sub':'sal.massimo@gmail.com'}))"`
- `.env.prod` (root, NON in git) serve solo per il deploy sul NAS.

## Funzionalità principali
Overview/Patrimonio, Conti (import Fineco/UniCredit/Revolut/CA), Movimenti con
auto-categorizzazione (incl. Trasferimenti interni esclusi dalle spese), Investimenti
(prezzi Yahoo/CoinGecko, conversione valuta→EUR, aggancio ticker, PAC), Mutui (piano
ammortamento + completa-piano), Polizze, Fondi pensione, Beni Reali (immobili +
orologi con valutazione AI/manuale e P&L), **Reddito** (buste paga PDF → analisi AI,
PDF archiviati, grafico mensile, confronto reddito vs spese), News & Mercati (RSS +
briefing AI + traduzione), AI Advisor.

## Note operative (ambiente Windows dev)
- **Git Bash a volte crasha** (cygwin fork error) → usare **PowerShell** per git e per i check.
- Il **frontend Expo** ogni tanto va in crash all'avvio per un fetch a `api.expo.dev`
  (rete transitoria) → basta `docker compose up -d frontend` per riavviarlo.
- Nessun bind-mount: dopo modifiche serve `docker compose up -d --build <servizio>`.
- Verifica bundle web: `GET http://localhost:19006/node_modules/expo/AppEntry.bundle?platform=web&dev=true&hot=false` (HTTP 200 = compila).
- Le feature AI richiedono credito Anthropic attivo (console.anthropic.com → Billing).
- I segreti (`backend/.env`, `.env.prod`) sono gitignored: ricrearli sul nuovo PC.

## Comandi utili
- Rebuild: `docker compose up -d --build`
- Log backend: `docker compose logs backend --tail 30`
- DB: `docker compose exec -T db psql -U finanza_user -d finanza_db -c "..."`
- Deploy NAS: `sudo sh /var/services/homes/sistema/deploy.sh`
