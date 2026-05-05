from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.core.security import get_current_user
from app.services.alert_engine import calcola_alert

router = APIRouter()


@router.get("/")
async def get_alert(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Alert proattivi basati sulla situazione finanziaria reale."""
    return await calcola_alert(db, current_user.id)
