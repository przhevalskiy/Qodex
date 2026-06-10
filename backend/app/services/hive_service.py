"""Hive API integration — routes requests to the correct Marcomms sub-project."""
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

HIVE_BASE_URL = "https://app.hive.com/api/v2"
WORKSPACE_ID = "MvJ2A7jmTiCJcheoM"

# Marcomms Service Requests sub-project IDs
SERVICE_PROJECT_MAP = {
    "web_services":     "46u9tbXY28SyHXxty",
    "media_outreach":   "Nq9yjjP6MTRh33Pbs",
    "photo":            "9Pkm2bSg7hMWNs4Jy",
    "digital_screens":  "n2pgMprEkoSTSXA6f",
    "web_article":      "WJJfzensshDySmwfs",
    "event_coverage":   "ouLeGxMQriFRFsYsW",
    "youtube":          "mfTJrGj6FrTaBnviz",
    "social_media":     "GNPJiJnFMuzD54CvH",
    "event_promotion":  "Xov2Fcmcdm5cktzje",
    "consultation":     "qT3WRqYtoyqLLAkJG",
}

SERVICE_LABELS = {
    "web_services":    "Web Services/Digital Marketing",
    "media_outreach":  "Media Outreach",
    "photo":           "Photo Request",
    "digital_screens": "Digital Screens",
    "web_article":     "Web Article",
    "event_coverage":  "Event Coverage",
    "youtube":         "YouTube/Video",
    "social_media":    "Social Media",
    "event_promotion": "Event Promotion",
    "consultation":    "MarComms Consultation",
}

_hive_service: Optional["HiveService"] = None


def _build_description(fields: dict) -> str:
    """Format collected fields as structured HTML matching the Hive form layout."""
    contact   = fields.get("contact_name", "—")
    role      = fields.get("role", "—")
    uni       = fields.get("uni", "—")
    dept      = fields.get("department", "—")
    is_event  = fields.get("is_event", "—")
    service   = SERVICE_LABELS.get(fields.get("service_type", ""), fields.get("service_type", "—"))
    brief     = fields.get("brief", "—")
    details   = fields.get("details", "—")

    return (
        "<h3>Section I — Point of Contact</h3>"
        f"<p><strong>Name:</strong> {contact}</p>"
        f"<p><strong>Role:</strong> {role}</p>"
        f"<p><strong>UNI:</strong> {uni}</p>"
        f"<p><strong>Department:</strong> {dept}</p>"
        f"<p><strong>Is this for an event?</strong> {is_event}</p>"
        "<h3>Section II — Request Details</h3>"
        f"<p><strong>Service:</strong> {service}</p>"
        f"<p><strong>Project brief:</strong> {brief}</p>"
        f"<p><strong>Additional details:</strong> {details}</p>"
        "<p><em>Submitted via Cowork</em></p>"
    )


class HiveService:
    def __init__(self, api_key: str, user_id: str, uat_project_id: str = ""):
        self._headers = {"api_key": api_key, "user_id": user_id}
        self._uat_project_id = uat_project_id

    async def create_action(self, fields: dict) -> dict:
        service_type = fields.get("service_type", "consultation")
        # UAT mode: route everything to the test project
        if self._uat_project_id:
            project_id = self._uat_project_id
        else:
            project_id = SERVICE_PROJECT_MAP.get(service_type, SERVICE_PROJECT_MAP["consultation"])

        contact = fields.get("contact_name", "Unknown")
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %I:%M %p")
        brief = fields.get("brief", "Communications request")
        title = f"{brief[:60]} - MarComms Service Request - {contact} {ts}"

        payload = {
            "workspaceId": WORKSPACE_ID,
            "projectId": project_id,
            "title": title,
            "description": _build_description(fields),
        }

        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{HIVE_BASE_URL}/actions",
                headers=self._headers,
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    async def get_action(self, action_id: str) -> dict:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"{HIVE_BASE_URL}/actions/{action_id}",
                headers=self._headers,
            )
            response.raise_for_status()
            return response.json()


def get_hive_service() -> HiveService:
    global _hive_service
    if _hive_service is None:
        settings = get_settings()
        _hive_service = HiveService(
            api_key=settings.hive_api_key,
            user_id=settings.hive_user_id,
            uat_project_id=settings.hive_uat_project_id,
        )
    return _hive_service
