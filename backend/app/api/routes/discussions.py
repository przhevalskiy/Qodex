from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional
from datetime import datetime
import uuid

from app.models import Discussion, DiscussionCreate, DiscussionUpdate, Message, MessageCreate
from app.auth import get_current_user_id
from app.services.discussion_service import get_discussion_service

router = APIRouter(prefix="/api/discussions", tags=["discussions"])


@router.get("", response_model=List[Discussion])
async def list_discussions(user_id: str = Depends(get_current_user_id)):
    """List all discussions for the authenticated user."""
    service = get_discussion_service()
    return service.list_discussions(user_id)


@router.post("", response_model=Discussion)
async def create_discussion(
    data: Optional[DiscussionCreate] = None,
    user_id: str = Depends(get_current_user_id),
):
    """Create a new discussion."""
    service = get_discussion_service()
    title = data.title if data else "New Chat"
    return service.create_discussion(user_id, title)


@router.get("/{discussion_id}", response_model=Discussion)
async def get_discussion(
    discussion_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Get a discussion by ID."""
    service = get_discussion_service()
    discussion = service.get_discussion(discussion_id, user_id)
    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")
    return discussion


@router.put("/{discussion_id}", response_model=Discussion)
async def update_discussion(
    discussion_id: str,
    data: DiscussionUpdate,
    user_id: str = Depends(get_current_user_id),
):
    """Update a discussion."""
    service = get_discussion_service()
    updates = {}
    if data.title is not None:
        updates["title"] = data.title
    if data.is_active is not None:
        if data.is_active:
            service.deactivate_all(user_id)
        updates["is_active"] = data.is_active

    discussion = service.update_discussion(discussion_id, user_id, **updates)
    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")
    return discussion


@router.delete("/{discussion_id}")
async def delete_discussion(
    discussion_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Delete a discussion."""
    service = get_discussion_service()
    deleted = service.delete_discussion(discussion_id, user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Discussion not found")
    return {"status": "deleted", "id": discussion_id}


@router.delete("")
async def delete_all_discussions(
    user_id: str = Depends(get_current_user_id),
):
    """Delete all discussions for the authenticated user."""
    service = get_discussion_service()
    deleted_count = service.delete_all_discussions(user_id)
    return {"status": "deleted", "count": deleted_count}


@router.post("/{discussion_id}/messages", response_model=Message)
async def add_message(
    discussion_id: str,
    data: MessageCreate,
    user_id: str = Depends(get_current_user_id),
):
    """Add a message to a discussion."""
    service = get_discussion_service()

    # Verify discussion belongs to user
    discussion = service.get_discussion(discussion_id, user_id)
    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")

    message = Message(
        id=str(uuid.uuid4()),
        content=data.content,
        role=data.role,
        provider=data.provider,
        timestamp=datetime.utcnow(),
    )
    service.add_message(discussion_id, message)

    # Auto-generate title from first user message if still default
    if discussion.title == "New Chat" and data.role.value == "user":
        new_title = data.content[:50] + ("..." if len(data.content) > 50 else "")
        service.update_discussion(discussion_id, user_id, title=new_title)

    return message


@router.patch("/{discussion_id}/share", response_model=Discussion)
async def share_discussion(
    discussion_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Mark a discussion as publicly readable by any authenticated user.
    Invariant: only the owner (user_id match) can share; non-owners receive 404."""
    service = get_discussion_service()
    discussion = service.share_discussion(discussion_id, user_id)
    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")
    return discussion


@router.get("/{discussion_id}/shared", response_model=Discussion)
async def get_shared_discussion(
    discussion_id: str,
    user_id: str = Depends(get_current_user_id),  # auth required — non-logged-in users get 401
):
    """Fetch a public discussion with full message history for any authenticated user.
    Invariant: returns 404 if discussion does not exist OR is not public (is_public=False),
    preventing enumeration of private discussion IDs."""
    service = get_discussion_service()
    discussion = service.get_shared_discussion(discussion_id)
    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found or not shared")
    return discussion


@router.post("/{discussion_id}/activate", response_model=Discussion)
async def activate_discussion(
    discussion_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Set a discussion as active."""
    service = get_discussion_service()
    service.deactivate_all(user_id)
    discussion = service.update_discussion(discussion_id, user_id, is_active=True)
    if not discussion:
        raise HTTPException(status_code=404, detail="Discussion not found")
    return discussion
