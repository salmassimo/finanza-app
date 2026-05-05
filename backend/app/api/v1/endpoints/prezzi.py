from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.core.security import get_current_user

router = APIRouter()
# TODO: implementare endpoint CRUD completi
