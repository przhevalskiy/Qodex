from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
import uuid

from .message import Message


class DiscussionBase(BaseModel):
    """Base discussion model."""
    title: str = "New Chat"


class DiscussionCreate(DiscussionBase):
    """Model for creating a new discussion."""
    pass


class DiscussionUpdate(BaseModel):
    """Model for updating a discussion."""
    title: Optional[str] = None
    is_active: Optional[bool] = None


class Discussion(DiscussionBase):
    """Full discussion model with all fields."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    messages: List[Message] = Field(default_factory=list)
    is_active: bool = False
    is_public: bool = False  # when True, any authenticated user can read via share link
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        from_attributes = True

    def add_message(self, message: Message) -> None:
        """Add a message to the discussion."""
        self.messages.append(message)
        self.updated_at = datetime.utcnow()

    def get_context_messages(self, limit: int = 20) -> List[Message]:
        """Get recent messages for context."""
        return self.messages[-limit:] if self.messages else []
