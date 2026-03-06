from typing import List, Optional, Dict
import uuid
import base64
import logging

from app.models.attachment import Attachment, AttachmentChunk, AttachmentSummary
from app.services.document_service import get_document_service

logger = logging.getLogger(__name__)

IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


class AttachmentService:
    """Service for managing discussion-scoped file attachments.

    Attachments are extracted and chunked just like Documents, but are
    stored in-memory per discussion and are NEVER indexed into Pinecone.
    They serve as contextual knowledge within a conversation.
    """

    def __init__(self):
        # discussion_id -> { attachment_id -> Attachment }
        self._attachments: Dict[str, Dict[str, Attachment]] = {}

    def _doc_service(self):
        """Lazy access to DocumentService for text extraction / chunking."""
        return get_document_service()

    async def add_attachment(
        self,
        discussion_id: str,
        filename: str,
        content: bytes,
        content_type: str,
    ) -> Attachment:
        """Process a file and store it as a discussion attachment (no Pinecone)."""
        attachment_id = str(uuid.uuid4())
        ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

        if content_type in IMAGE_CONTENT_TYPES or ext in IMAGE_EXTENSIONS:
            # Image path: skip text extraction; store raw bytes as base64
            attachment = Attachment(
                id=attachment_id,
                discussion_id=discussion_id,
                filename=filename,
                file_content_type=content_type,
                file_size=len(content),
                is_image=True,
                image_data=base64.b64encode(content).decode(),
                full_text="",
                chunks=[],
                chunk_count=0,
            )
        else:
            # Text path: extract and chunk via shared DocumentService pipeline
            ds = self._doc_service()
            full_text = ds._extract_text(content, content_type, filename)
            raw_chunks = ds._chunk_text(full_text)
            chunks = [
                AttachmentChunk(
                    attachment_id=attachment_id,
                    content=c["content"],
                    chunk_index=i,
                    content_type=c["type"],
                )
                for i, c in enumerate(raw_chunks)
            ]
            attachment = Attachment(
                id=attachment_id,
                discussion_id=discussion_id,
                filename=filename,
                file_content_type=content_type,
                file_size=len(content),
                chunk_count=len(chunks),
                full_text=full_text,
                chunks=chunks,
            )

        self._attachments.setdefault(discussion_id, {})[attachment_id] = attachment
        logger.info(
            "Attachment added: %s (%s, %d chunks) to discussion %s",
            filename,
            "image" if attachment.is_image else "text",
            attachment.chunk_count,
            discussion_id,
        )
        return attachment

    def list_attachments(self, discussion_id: str) -> List[AttachmentSummary]:
        """Return lightweight summaries for all attachments in a discussion."""
        bucket = self._attachments.get(discussion_id, {})
        return [AttachmentSummary.from_attachment(a) for a in bucket.values()]

    def get_attachment(self, discussion_id: str, attachment_id: str) -> Optional[Attachment]:
        """Get a single attachment with full text and chunks."""
        return self._attachments.get(discussion_id, {}).get(attachment_id)

    def delete_attachment(self, discussion_id: str, attachment_id: str) -> bool:
        """Remove an attachment from a discussion. Returns True if found."""
        bucket = self._attachments.get(discussion_id, {})
        if attachment_id in bucket:
            del bucket[attachment_id]
            logger.info("Attachment deleted: %s from discussion %s", attachment_id, discussion_id)
            return True
        return False

    def get_context_for_chat(
        self,
        discussion_id: str,
        attachment_ids: Optional[List[str]] = None,
    ) -> str:
        """Build a formatted context string from attachments for injection into the AI prompt.

        Args:
            discussion_id: The discussion to pull attachments from.
            attachment_ids: Optional subset; if None, uses all attachments in the discussion.

        Returns:
            Formatted string with each attachment's content labelled by filename.
        """
        bucket = self._attachments.get(discussion_id, {})
        if not bucket:
            return ""

        if attachment_ids is not None:
            attachments = [bucket[aid] for aid in attachment_ids if aid in bucket]
        else:
            attachments = list(bucket.values())

        if not attachments:
            return ""

        parts = []
        for att in attachments:
            if not att.is_image and att.full_text:
                parts.append(f"[Attached File: {att.filename}]:\n{att.full_text}")

        return "\n\n---\n\n".join(parts)

    def get_image_attachments_for_chat(
        self,
        discussion_id: str,
        attachment_ids: Optional[List[str]] = None,
    ) -> List[Dict]:
        """Return image attachments as dicts suitable for vision API injection.

        Returns:
            List of {base64, media_type, filename} for each image attachment.
        """
        bucket = self._attachments.get(discussion_id, {})
        if not bucket:
            return []

        ids = attachment_ids if attachment_ids is not None else list(bucket)
        return [
            {
                "base64": bucket[aid].image_data,
                "media_type": bucket[aid].file_content_type,
                "filename": bucket[aid].filename,
            }
            for aid in ids
            if aid in bucket and bucket[aid].is_image and bucket[aid].image_data
        ]

    def delete_discussion_attachments(self, discussion_id: str) -> int:
        """Remove all attachments for a discussion. Returns count deleted."""
        bucket = self._attachments.pop(discussion_id, {})
        return len(bucket)


# Singleton
_attachment_service: Optional[AttachmentService] = None


def get_attachment_service() -> AttachmentService:
    global _attachment_service
    if _attachment_service is None:
        _attachment_service = AttachmentService()
    return _attachment_service
