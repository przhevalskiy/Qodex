"""Hive API proxy routes."""
import logging
from pydantic import BaseModel
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException

from app.core.config import get_settings
from app.services.hive_service import get_hive_service
from app.auth import get_current_user, UserContext

router = APIRouter(prefix="/api/hive", tags=["hive"])
logger = logging.getLogger(__name__)


class SubmitRequest(BaseModel):
    title: str
    description: str
    intent: str


class SubmitResponse(BaseModel):
    hive_task_id: str
    message: str
    hive_url: Optional[str] = None


@router.post("/submit", response_model=SubmitResponse)
async def submit_to_hive(
    request: SubmitRequest,
    current_user: UserContext = Depends(get_current_user),
):
    settings = get_settings()
    if not settings.hive_api_key:
        raise HTTPException(status_code=400, detail="Hive API key not configured")

    hive = get_hive_service()
    try:
        result = await hive.create_action(
            title=request.title,
            description=request.description,
            intent=request.intent,
        )
        action_id = result.get("id") or result.get("_id") or "unknown"
        return SubmitResponse(
            hive_task_id=str(action_id),
            message="Request submitted to marketing team.",
        )
    except Exception as e:
        logger.error(f"Hive submit error: {e}")
        raise HTTPException(status_code=502, detail=f"Hive submission failed: {str(e)}")
