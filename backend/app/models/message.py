from pydantic import BaseModel, Field
from typing import Optional, List
from enum import Enum
from datetime import datetime
import uuid


class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class DocumentSource(BaseModel):
    """Source document used in RAG response."""
    id: str
    filename: str
    score: float
    chunk_preview: Optional[str] = None
    citation_number: Optional[int] = None  # Position in citation list for inline references
    chunk_id: Optional[str] = None  # Pinecone chunk ID for highlight-on-click in document preview


class MessageBase(BaseModel):
    """Base message model."""
    content: str
    role: MessageRole = MessageRole.USER


class MessageCreate(MessageBase):
    """Model for creating a new message."""
    provider: Optional[str] = None


class Message(MessageBase):
    """Full message model with all fields."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    provider: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    tokens_used: Optional[int] = None
    response_time_ms: Optional[int] = None
    sources: Optional[List[DocumentSource]] = None
    citations: Optional[dict] = None  # Map citation numbers to document IDs
    suggested_questions: Optional[List[str]] = None  # AI-generated follow-up questions
    intent: Optional[str] = None  # Detected intent: "summarize", "case_study", etc.
    research_mode: Optional[str] = None  # Research depth: "quick", "enhanced", "deep"

    class Config:
        from_attributes = True
