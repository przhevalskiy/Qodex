from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
import uuid


class DocumentBase(BaseModel):
    """Base document model."""
    filename: str
    content_type: str


class DocumentCreate(DocumentBase):
    """Model for creating a new document."""
    content: bytes


class DocumentChunk(BaseModel):
    """Model for a document chunk stored in vector DB."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    document_id: str
    content: str
    chunk_index: int
    embedding: Optional[List[float]] = None


class Document(DocumentBase):
    """Full document model with all fields."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    chunk_ids: List[str] = Field(default_factory=list)
    chunk_count: int = 0
    file_size: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)
    is_embedded: bool = False
    course_name: str = ""

    class Config:
        from_attributes = True
