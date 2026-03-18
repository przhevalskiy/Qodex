"""Supabase-backed discussion and message CRUD service."""

import logging
from datetime import datetime
from typing import List, Optional

from app.database.supabase_client import get_supabase_client
from app.models import Discussion, Message, MessageRole, DocumentSource

logger = logging.getLogger(__name__)

# Singleton instance
_discussion_service: Optional["DiscussionService"] = None


class DiscussionService:
    """Manages discussions and messages in Supabase."""

    def __init__(self):
        self._client = get_supabase_client()

    # ── Discussions ──────────────────────────────────────────────

    def list_discussions(self, user_id: str) -> List[Discussion]:
        resp = (
            self._client.table("discussions")
            .select("*")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .execute()
        )
        return [self._row_to_discussion(r) for r in (resp.data or [])]

    def get_discussion(self, discussion_id: str, user_id: str) -> Optional[Discussion]:
        resp = (
            self._client.table("discussions")
            .select("*")
            .eq("id", discussion_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        if not resp.data:
            return None

        discussion = self._row_to_discussion(resp.data)

        # Fetch messages
        msg_resp = (
            self._client.table("messages")
            .select("*")
            .eq("discussion_id", discussion_id)
            .order("created_at", desc=False)
            .execute()
        )
        discussion.messages = [self._row_to_message(m) for m in (msg_resp.data or [])]
        return discussion

    def create_discussion(self, user_id: str, title: str = "New Chat") -> Discussion:
        resp = (
            self._client.table("discussions")
            .insert({"user_id": user_id, "title": title})
            .execute()
        )
        return self._row_to_discussion(resp.data[0])

    def update_discussion(
        self, discussion_id: str, user_id: str, **updates
    ) -> Optional[Discussion]:
        payload = {}
        if "title" in updates:
            payload["title"] = updates["title"]
        if "is_active" in updates:
            payload["is_active"] = updates["is_active"]
        payload["updated_at"] = datetime.utcnow().isoformat()

        resp = (
            self._client.table("discussions")
            .update(payload)
            .eq("id", discussion_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not resp.data:
            return None
        return self._row_to_discussion(resp.data[0])

    def delete_discussion(self, discussion_id: str, user_id: str) -> bool:
        resp = (
            self._client.table("discussions")
            .delete()
            .eq("id", discussion_id)
            .eq("user_id", user_id)
            .execute()
        )
        return bool(resp.data)

    def delete_all_discussions(self, user_id: str) -> int:
        """Delete all discussions for a user. Returns count of deleted discussions."""
        resp = (
            self._client.table("discussions")
            .delete()
            .eq("user_id", user_id)
            .execute()
        )
        return len(resp.data) if resp.data else 0

    def deactivate_all(self, user_id: str) -> None:
        self._client.table("discussions").update(
            {"is_active": False}
        ).eq("user_id", user_id).eq("is_active", True).execute()

    def share_discussion(self, discussion_id: str, user_id: str) -> Optional[Discussion]:
        """Set is_public=True on a discussion. Only the owner may call this.
        Invariant: user_id filter ensures non-owners cannot share others' discussions."""
        resp = (
            self._client.table("discussions")
            .update({"is_public": True, "updated_at": datetime.utcnow().isoformat()})
            .eq("id", discussion_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not resp.data:
            return None
        return self._row_to_discussion(resp.data[0])

    def get_shared_discussion(self, discussion_id: str) -> Optional[Discussion]:
        """Fetch a public discussion with its messages for any authenticated user.
        Invariant: only returns data when is_public=True; caller must be authenticated
        (enforced at the route layer via get_current_user_id)."""
        resp = (
            self._client.table("discussions")
            .select("*")
            .eq("id", discussion_id)
            .eq("is_public", True)
            .maybe_single()
            .execute()
        )
        if not resp.data:
            return None

        discussion = self._row_to_discussion(resp.data)

        msg_resp = (
            self._client.table("messages")
            .select("*")
            .eq("discussion_id", discussion_id)
            .order("created_at", desc=False)
            .execute()
        )
        discussion.messages = [self._row_to_message(m) for m in (msg_resp.data or [])]
        return discussion

    # ── Messages ─────────────────────────────────────────────────

    def add_message(self, discussion_id: str, message: Message) -> None:
        row = {
            "id": message.id,
            "discussion_id": discussion_id,
            "role": message.role.value,
            "content": message.content,
            "provider": message.provider,
            "tokens_used": message.tokens_used,
            "response_time_ms": message.response_time_ms,
            "sources": (
                [s.model_dump() for s in message.sources]
                if message.sources
                else None
            ),
            "citations": message.citations,
            "suggested_questions": message.suggested_questions,
            "intent": message.intent,
            "research_mode": message.research_mode,
        }
        self._client.table("messages").insert(row).execute()

        # Touch discussion updated_at
        self._client.table("discussions").update(
            {"updated_at": datetime.utcnow().isoformat()}
        ).eq("id", discussion_id).execute()

    def get_context_messages(
        self, discussion_id: str, limit: int = 20
    ) -> List[Message]:
        resp = (
            self._client.table("messages")
            .select("*")
            .eq("discussion_id", discussion_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        messages = [self._row_to_message(m) for m in (resp.data or [])]
        messages.reverse()  # chronological order
        return messages

    # ── Row mappers ──────────────────────────────────────────────

    @staticmethod
    def _row_to_discussion(row: dict) -> Discussion:
        return Discussion(
            id=row["id"],
            title=row.get("title", "New Chat"),
            is_active=row.get("is_active", False),
            is_public=row.get("is_public", False),
            created_at=row.get("created_at", datetime.utcnow()),
            updated_at=row.get("updated_at", datetime.utcnow()),
            messages=[],
        )

    @staticmethod
    def _row_to_message(row: dict) -> Message:
        sources = None
        if row.get("sources"):
            sources = [DocumentSource(**s) for s in row["sources"]]

        return Message(
            id=row["id"],
            content=row["content"],
            role=MessageRole(row["role"]),
            provider=row.get("provider"),
            timestamp=row.get("created_at", datetime.utcnow()),
            tokens_used=row.get("tokens_used"),
            response_time_ms=row.get("response_time_ms"),
            sources=sources,
            citations=row.get("citations"),
            suggested_questions=row.get("suggested_questions"),
            intent=row.get("intent"),
            research_mode=row.get("research_mode"),
        )


def get_discussion_service() -> DiscussionService:
    """Get or create the singleton DiscussionService."""
    global _discussion_service
    if _discussion_service is None:
        _discussion_service = DiscussionService()
    return _discussion_service
