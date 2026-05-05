#!/bin/bash
# ============================================================
# SETUP SCRIPT — Finanza App
# Esegui questo script dalla root del progetto
# ============================================================

set -e

echo "🚀 Setup Finanza App"
echo "=================================================="

# 1. Inizializza git
git init
git add .
git commit -m "feat: scaffold iniziale finanza-app

- Backend FastAPI + SQLAlchemy 2.0 + PostgreSQL
- Frontend React Native + Expo
- Modelli: Utente, Conti, Mutui, Immobili, Portafoglio, Orologi
- Snapshot pattern per storico di tutti gli asset
- Aggiornamento prezzi automatico (Yahoo Finance + CoinGecko)
- Cron job giornaliero alle 18:30
- JWT Auth
- Docker Compose per sviluppo locale
- GitHub Actions CI/CD"

echo ""
echo "=================================================="
echo "📌 PROSSIMI PASSI:"
echo ""
echo "1. Crea il repo su GitHub:"
echo "   https://github.com/new → nome: finanza-app"
echo ""
echo "2. Collega il remote:"
echo "   git remote add origin https://github.com/TUO_USERNAME/finanza-app.git"
echo "   git push -u origin main"
echo ""
echo "3. Avvia il backend locale:"
echo "   docker-compose up -d db"
echo "   cd backend"
echo "   cp .env.example .env  # configura DATABASE_URL e SECRET_KEY"
echo "   python -m venv venv && source venv/bin/activate"
echo "   pip install -r requirements.txt"
echo "   alembic upgrade head"
echo "   uvicorn app.main:app --reload"
echo "   → API docs: http://localhost:8000/docs"
echo ""
echo "4. Avvia il frontend:"
echo "   cd frontend"
echo "   npm install"
echo "   npx expo start"
echo "   → Scansiona il QR con Expo Go (iOS/Android)"
echo ""
echo "5. Configura VS Code extensions consigliate:"
echo "   - Python (Microsoft)"
echo "   - Pylance"
echo "   - React Native Tools"
echo "   - Thunder Client (test API)"
echo "   - GitLens"
echo "=================================================="
