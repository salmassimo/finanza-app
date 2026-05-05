# 💰 Finanza Personale — App Mobile

App mobile per il monitoraggio del patrimonio personale.

## Stack Tecnologico

| Layer | Tecnologia |
|---|---|
| Mobile Frontend | React Native + Expo |
| Backend API | FastAPI (Python 3.11+) |
| Database | PostgreSQL 15 |
| ORM | SQLAlchemy 2.0 + Alembic |
| Auth | JWT (python-jose) |
| Prezzi | Yahoo Finance API + CoinGecko |
| PSD2 | Nordigen/GoCardless (futuro) |

## Struttura Progetto

```
finanza-app/
├── backend/          # FastAPI + PostgreSQL
│   ├── app/
│   │   ├── api/      # Route API REST
│   │   ├── core/     # Config, sicurezza, JWT
│   │   ├── db/       # Sessione DB, base model
│   │   ├── models/   # SQLAlchemy ORM models
│   │   ├── schemas/  # Pydantic schemas
│   │   └── services/ # Business logic
│   ├── migrations/   # Alembic migrations
│   └── tests/
└── frontend/         # React Native + Expo
    └── src/
        ├── screens/      # Schermate app
        ├── components/   # Componenti riutilizzabili
        ├── navigation/   # React Navigation
        ├── services/     # Chiamate API
        ├── store/        # Zustand state management
        └── hooks/        # Custom hooks
```

## Setup Rapido

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env      # configura le variabili
alembic upgrade head      # crea le tabelle
uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npx expo start
```

## API Documentation
Avviato il backend, vai su: http://localhost:8000/docs
