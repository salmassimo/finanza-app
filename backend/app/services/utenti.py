from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.models import Utente


async def get_utente_by_email(db: AsyncSession, email: str) -> Utente | None:
    result = await db.execute(select(Utente).where(Utente.email == email))
    return result.scalar_one_or_none()
