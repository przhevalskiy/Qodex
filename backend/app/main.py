# Copyright (c) 2026 Aleksey Przhevalskiy. All rights reserved.
# Licensed under the Business Source License 1.1. See LICENSE for details.

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.core.config import get_settings
from app.api.routes import chat_router, discussions_router, documents_router, attachments_router
from app.services.document_service import get_document_service

# Import providers to register them
from app.providers import (
    MistralProvider,
    ClaudeProvider,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    settings = get_settings()
    print(f"Starting Qodex API server...")
    print(f"Debug mode: {settings.debug}")
    print(f"CORS origins: {settings.cors_origins_list}")

    # Log configured providers
    providers_status = {
        "Mistral": bool(settings.mistral_api_key),
        "Claude": bool(settings.anthropic_api_key),
    }
    print(f"Configured providers: {providers_status}")

    # Bootstrap document registry from Pinecone if the local cache is empty.
    # This ensures list_documents() and filename pre-filtering work after
    # restarts, even for documents uploaded before persistence was added.
    doc_service = get_document_service()
    if not doc_service.list_documents():
        try:
            count = await doc_service.bootstrap_registry()
            if count:
                print(f"Bootstrapped {count} documents from Pinecone")
        except Exception as e:
            print(f"Warning: document registry bootstrap failed: {e}")

    yield

    # Shutdown
    print("Shutting down Qodex API server...")


# Create FastAPI app
app = FastAPI(
    title="Qodex API",
    description="AI Agent Platform API with multi-provider support",
    version="1.0.0",
    lifespan=lifespan,
)

# Configure CORS
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(chat_router)
app.include_router(discussions_router)
app.include_router(documents_router)
app.include_router(attachments_router)


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "Qodex API",
        "version": "1.0.0",
        "status": "running"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    settings = get_settings()
    return {
        "status": "healthy",
        "providers": {
            "mistral": bool(settings.mistral_api_key),
            "claude": bool(settings.anthropic_api_key),
        },
        "pinecone": bool(settings.pinecone_api_key)
    }
