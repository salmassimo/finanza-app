from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.core.security import get_current_user
from app.services.proiezione import calcola_scenari

router = APIRouter()


@router.get("/scenari")
async def get_scenari(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Proiezione patrimoniale a 5 anni — 3 scenari (base, ottimizzato, aggressivo)."""
    return await calcola_scenari(db, current_user.id)
