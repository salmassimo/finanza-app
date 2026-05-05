# 🎉 Setup Locale Completato!

## ✅ Servizi in Esecuzione

### Backend API (FastAPI + PostgreSQL)
- **Status**: ✅ Running in Docker
- **URL**: http://localhost:8000
- **API Docs (Swagger)**: http://localhost:8000/docs
- **Database**: PostgreSQL 15 running on port 5432

**Credenziali Database:**
- Username: `finanza_user`
- Password: `finanza_pass`
- Database: `finanza_db`

**Variabili d'Ambiente Backend** (configurate in `backend/.env`):
```
DATABASE_URL=postgresql+asyncpg://finanza_user:finanza_pass@localhost:5432/finanza_db
SECRET_KEY=dev-secret-key-change-this-in-production
DEBUG=true
```

### Frontend (React Native + Expo)
- **Status**: ✅ Starting (npx expo start --web)
- **Default URL**: http://localhost:19006 (oppure http://localhost:8081)
- **Modalità**: Web development

---

## 📋 Passi Completati

1. ✅ Docker container per PostgreSQL avviato e healthy
2. ✅ Backend FastAPI compilato e in esecuzione
3. ✅ Configurazione .env per il backend
4. ✅ Node.js dependencies per il frontend installate
5. ✅ Expo CLI configurato per il web

---

## 🚀 Come Usare

### Avviare Tutto (Backend + Database)
```bash
cd finanza-app-scaffold
docker-compose up -d
```

### Avviare il Frontend (da nuovo terminal)
```bash
cd frontend
npx expo start --web
```

### Fermare i Servizi
```bash
docker-compose down
```

---

## 📱 Accesso alle Applicazioni

| Servizio | URL | Descrizione |
|----------|-----|-------------|
| **API Backend** | http://localhost:8000 | FastAPI endpoint |
| **API Docs** | http://localhost:8000/docs | Swagger UI per testare le API |
| **Database** | localhost:5432 | PostgreSQL |
| **Frontend Web** | http://localhost:19006 | App web tramite Expo |

---

## 🔧 Comandi Utili

### Verificare lo stato dei container
```bash
docker-compose ps
```

### Visualizzare i log del backend
```bash
docker-compose logs -f backend
```

### Visualizzare i log del database
```bash
docker-compose logs -f db
```

### Ricostruire il backend (se modifichi i requirements.txt)
```bash
docker-compose up -d --build backend
```

---

## 📝 Prossimi Passi (Opzionali)

1. **Creare le tabelle del database**:
   - Accedi al container backend: `docker exec -it finanza-app-scaffold-backend-1 bash`
   - Esegui le migrazioni: `alembic upgrade head`

2. **Aggiungere un utente di test**:
   - Usa Swagger UI per registrare un nuovo utente: POST `/api/v1/auth/register`

3. **Configurare API keys esterne (Opzionali)**:
   - Yahoo Finance API (gratuito - di default)
   - CoinGecko API key (per le criptovalute)

---

## 🐛 Troubleshooting

### Backend non risponde
```bash
# Verifica i log
docker-compose logs backend

# Ricrea il container
docker-compose up -d --build backend
```

### Database non è healthy
```bash
# Verifica i log
docker-compose logs db

# Reset completo
docker-compose down -v  # -v rimuove anche i volumi
docker-compose up -d
```

### Frontend non carica
- Verifica che il porta 8081 o 19006 sia libera
- Prova a killare i processi Node: `Get-Process node | Stop-Process`
- Riavvia expo: `npx expo start --web`

---

## 📚 Struttura Progetto

```
finanza-app-scaffold/
├── backend/              # FastAPI + PostgreSQL + SQLAlchemy
│   ├── app/
│   │   ├── api/v1/       # Endpoint REST
│   │   ├── core/         # Config, JWT, Security
│   │   ├── db/           # Database session
│   │   ├── models/       # SQLAlchemy ORM
│   │   ├── schemas/      # Pydantic validators
│   │   └── services/     # Business logic
│   ├── migrations/       # Alembic DB migrations
│   └── Dockerfile
│
├── frontend/             # React Native + Expo
│   ├── src/
│   │   ├── screens/      # Schermate app
│   │   ├── components/   # Componenti riutilizzabili
│   │   ├── services/     # API calls
│   │   ├── store/        # Zustand state
│   │   ├── hooks/        # Custom React hooks
│   │   └── navigation/   # React Navigation
│   └── package.json
│
└── docker-compose.yml    # Orchestration

```

---

## ℹ️ Stack Tecnologico

- **Backend**: FastAPI 0.111.0, Python 3.11 (in Docker)
- **Database**: PostgreSQL 15 Alpine
- **ORM**: SQLAlchemy 2.0 + Alembic
- **Frontend**: React Native + Expo
- **State Management**: Zustand
- **Auth**: JWT + python-jose
- **Data Fetching**: Axios + React Query
- **Charts**: react-native-chart-kit
- **APIs Esterne**: Yahoo Finance, CoinGecko (prezzi)

---

Generated: 2026-04-18
