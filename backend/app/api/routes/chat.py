"""Cowork chat route — streaming intake agent with tool use."""
import json
import logging
import time
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

from app.core.config import get_settings
from app.core.tools import COWORK_TOOLS
from app.models import Message, MessageRole
import anthropic as anthropic_sdk
from app.providers import get_claude_provider, get_mistral_provider
from app.services.attachment_service import build_attachment_context
from app.services.discussion_service import get_discussion_service
from app.services.hive_service import get_hive_service
from app.services.email_service import send_submission_copy
from app.services.intent_classifier import classify_intent, get_intent_for_key
from app.utils.streaming import format_sse_event
from app.auth import get_current_user, UserContext

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)

BASE_SYSTEM_PROMPT = """You are Cowork, the CBS Marketing & Communications intake assistant.
Your job is to collect the information needed to file a service request with the MarComms team in Hive.

Required fields to collect through natural conversation (ask 1-2 at a time, never all at once):
- contact_name: requester's full name
- role: Staff, Faculty, Student, or External
- uni: Columbia UNI (e.g. ap3456) — if not Columbia-affiliated say N/A
- department: their department or school
- is_event: whether the request is tied to an event (Yes / No)
- service_type: one of the 10 Marcomms services:
    web_services, media_outreach, photo, digital_screens, web_article,
    event_coverage, youtube, social_media, event_promotion, consultation
- brief: a 1-2 sentence project brief
- details: any additional context, deadlines, or notes

Routing guide — pick service_type based on the request:
- Press release, op-ed, byline, article → web_article
- Event promotion, webinar, speaker series → event_promotion
- Event photography, event recap coverage → event_coverage
- Photography for headshots, portraits → photo
- Social media posts, Instagram, LinkedIn, Twitter → social_media
- PR pitch, media list, journalist outreach → media_outreach
- Video, YouTube, reels → youtube
- Digital lobby screens, signage → digital_screens
- Website buildout, SEO, analytics, feature requests → web_services
- General question or multi-service request → consultation

Once all required fields are gathered, call show_checklist immediately — do not output any text before calling the tool.
After the user confirms, call submit_to_hive immediately — do not output any text before calling the tool.
Be concise, warm, and professional."""


class ChatRequest(BaseModel):
    discussion_id: str
    message: str
    temperature: float = 0.7
    max_tokens: int = 4096


@router.post("/stream")
async def stream_chat(
    request: ChatRequest,
    current_user: UserContext = Depends(get_current_user),
):
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured")

    disc_service = get_discussion_service()
    user_id = current_user.user_id

    discussion = disc_service.get_discussion(request.discussion_id, user_id)
    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")

    # Add user message
    user_message = Message(
        id=str(uuid.uuid4()),
        content=request.message,
        role=MessageRole.USER,
        timestamp=datetime.utcnow(),
    )
    disc_service.add_message(
        request.discussion_id, user_message,
        user_display_name=current_user.display_name,
        user_email=current_user.email,
    )

    # Auto-title on first message
    title_updated = False
    if discussion.title == "New Chat":
        new_title = request.message[:50] + ("..." if len(request.message) > 50 else "")
        disc_service.update_discussion(request.discussion_id, user_id, title=new_title)
        discussion.title = new_title
        title_updated = True

    # Intent: classify once on first message, reuse on subsequent turns
    emit_intent = False
    if not discussion.intent:
        intent_result = classify_intent(request.message)
        logger.info(f"Intent classified: '{request.message[:60]}' → {intent_result.intent}")
        disc_service.update_discussion(request.discussion_id, user_id, intent=intent_result.intent)
        discussion.intent = intent_result.intent
        emit_intent = True
    else:
        intent_result = get_intent_for_key(discussion.intent)

    # Build system prompt — include any uploaded attachment text as reference
    attachment_context = build_attachment_context(request.discussion_id)
    system_prompt = BASE_SYSTEM_PROMPT + intent_result.prompt_suffix + attachment_context

    # Get conversation context
    context_messages = disc_service.get_context_messages(request.discussion_id, limit=20)

    provider = get_claude_provider(
        api_key=settings.anthropic_api_key,
        model=settings.anthropic_model,
    )

    async def generate():
        _t0 = time.time()
        full_response: list[str] = []

        if title_updated:
            yield f"data: {json.dumps({'type': 'discussion_title', 'discussion_id': request.discussion_id, 'title': discussion.title})}\n\n"

        if emit_intent:
            yield f"data: {json.dumps({'type': 'intent', 'intent': intent_result.intent, 'label': intent_result.label})}\n\n"

        stream_metadata: dict = {}

        active_provider = "claude"
        try:
            async for chunk in provider.stream_completion(
                messages=context_messages,
                system_prompt=system_prompt,
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                tools=COWORK_TOOLS,
                stream_metadata=stream_metadata,
            ):
                full_response.append(chunk)
                yield f"data: {json.dumps({'type': 'chunk', 'content': chunk, 'provider': 'claude'})}\n\n"

        except Exception as e:
            is_overloaded = (
                isinstance(e, anthropic_sdk.APIStatusError) and e.status_code in (529, 529)
                or "overloaded" in str(e).lower()
            )
            if is_overloaded and settings.mistral_api_key:
                logger.warning("Claude overloaded — falling back to Mistral")
                active_provider = "mistral"
                full_response.clear()
                stream_metadata.clear()
                try:
                    mistral = get_mistral_provider(
                        api_key=settings.mistral_api_key,
                        model=settings.mistral_model,
                    )
                    async for chunk in mistral.stream_completion(
                        messages=context_messages,
                        system_prompt=system_prompt,
                        temperature=request.temperature,
                        max_tokens=request.max_tokens,
                        tools=COWORK_TOOLS,
                        stream_metadata=stream_metadata,
                    ):
                        full_response.append(chunk)
                        yield f"data: {json.dumps({'type': 'chunk', 'content': chunk, 'provider': 'mistral'})}\n\n"
                except Exception as me:
                    logger.error(f"Mistral fallback error: {me}")
                    yield f"data: {json.dumps({'type': 'error', 'error': 'Service temporarily unavailable. Please try again.', 'provider': 'mistral'})}\n\n"
                    return
            else:
                logger.error(f"Stream error: {e}")
                yield f"data: {json.dumps({'type': 'error', 'error': 'Something went wrong. Please try again.', 'provider': 'claude'})}\n\n"
                return

        # Intercept tool calls
        tool_calls = stream_metadata.get("tool_calls", [])
        for call in tool_calls:
            name = call.get("name")
            inp = call.get("input", {})

            if name == "show_checklist":
                yield f"data: {json.dumps({'type': 'checklist', 'fields': inp.get('fields', {}), 'intent': discussion.intent or 'other'})}\n\n"

            elif name == "submit_to_hive":
                hive_task_id = f"HIVE-{uuid.uuid4().hex[:8].upper()}"
                if settings.hive_api_key:
                    try:
                        hive = get_hive_service()
                        result = await hive.create_action(fields=inp.get("fields", {}))
                        hive_task_id = str(result.get("id") or result.get("_id") or hive_task_id)
                    except Exception as hive_err:
                        logger.error(f"Hive API error: {hive_err}")
                send_submission_copy(inp.get("fields", {}), hive_task_id)
                yield f"data: {json.dumps({'type': 'submitted', 'hive_task_id': hive_task_id, 'message': 'Your request has been submitted to the marketing team.'})}\n\n"

        # Persist text-only assistant message — skip when a tool was called (tool events are the canonical message)
        response_ms = int((time.time() - _t0) * 1000)
        full_text = "".join(full_response).strip()
        if full_text and not tool_calls:
            assistant_message = Message(
                id=str(uuid.uuid4()),
                content=full_text,
                role=MessageRole.ASSISTANT,
                timestamp=datetime.utcnow(),
                response_time_ms=response_ms,
                intent=intent_result.intent,
            )
            disc_service.add_message(request.discussion_id, assistant_message)

        yield f"data: {json.dumps({'type': 'done', 'provider': 'claude'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
