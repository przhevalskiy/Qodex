# Qodex — AI-Powered Knowledge Base Chat Platform

AI-powered research platform with multi-provider RAG, sentence-level citation attribution, and causal bridge inference. Built for academic and institutional research, featuring auditable reasoning chains, document-grounded responses, and real-time streaming across Claude and Mistral.

---

## Key Features

### Multi-Provider AI Chat
- Switch between **Claude (Sonnet)** and **Mistral (Large)** as primary chat providers
- Real-time SSE streaming with graceful truncation and **Continue On** for long responses
- Provider-specific prompt engineering and citation policies
- **Auto mode**: intent-based provider routing (e.g. Claude for explanations and critiques, Mistral for summaries and lesson plans)
- Visual provider toggles on desktop; modal selector on mobile

### Advanced RAG Pipeline
- **Pinecone Vector Database**: Semantic search with cosine similarity (text-embedding-3-small, 1536 dims)
- **Entity-First Retrieval**: N-gram extraction with instructor name matching to prevent cross-contamination
- **Research Modes**: Quick (7 sources, score ≥ 0.40), Enhanced (12 sources, ≥ 0.30), Deep (16 sources, ≥ 0.25)
- **Intent Classification**: 11 specialized intents (Summarize, Explain, Compare, Builder, Case Analysis, Assessment, Critique, Methodology, Lesson Plan, etc.) with zero-latency regex matching
- **Smart Context Injection**: Token-aware chunking (500 tokens/chunk, 50 token overlap) with structure preservation
- **Query Rewriting**: Mistral-based pronoun resolution for follow-up questions (e.g. "tell me more about it")

### Citation System
- **Inline markers**: `[N]` (grounded fact from source N), `[AI:N,M]` (inference extending sources N and M), `[AI]` (pure general knowledge)
- Clickable citation chips with relevance score tooltip and document preview
- Backend post-processing ensures `[N]` and `[AI]` are never placed on the same claim (semantically contradictory)
- Remark plugin parses markers from streamed markdown for interactive rendering

### Document & Attachment Management
- **Global Knowledge Base**: Upload PDFs, DOCX, TXT, MD files (shared across all users, indexed to Pinecone)
- **Conversation Attachments**: Discussion-scoped files (PDFs, DOCX, TXT, MD, images) injected as context without Pinecone indexing
- **Document Preview**: Modal with full-text view, navigable chunks, and chunk-level highlight of the retrieved section
- **L2 Format Cache**: Formatted chunk content persisted to Supabase (`document_formatted_chunks`) for instant document opens

### User Authentication & Personalization
- **Supabase Auth**: Email/password with JWT verification (ES256/RS256/EdDSA via JWKS + HS256 fallback) and email confirmation
- **User Profiles**: Avatar selection, display name, preferred name — auto-created on signup via trigger
- **Row-Level Security**: User-scoped discussions and messages with PostgreSQL RLS
- **Session Persistence**: LocalStorage + Zustand for seamless cross-session experience

### Intelligent Conversation Management
- **Discussion System**: Create, rename, delete, and share conversations with auto-generated titles
- **Public Sharing**: Toggle any discussion public; shareable `/share/:discussionId` links
- **Message History**: Persistent Supabase storage with per-message tokens, latency, sources, citations, and research mode
- **Suggested Questions**: AI-generated follow-ups (max 4) based on conversation context
- **URL Routing**: Deep-link to any discussion via `/chat/:discussionId`

### Empty State Quick Actions
- 9 category chips (Case Studies, Course Readings, Simulations, etc.) each expand a submenu of 5 curated prompts
- Clicking a submenu item auto-submits the prompt
- Hovering a submenu item or journey question previews it as the input placeholder

### Export & Voice
- **Export Chat**: Export the current conversation to PDF with formatting, citations, title, and timestamps
- **Export History**: Export your full discussion list to PDF with title, timestamps, and chat URL per discussion
- **Voice Input**: Web Speech API integration for speech-to-text transcription
- **Share**: Shareable discussion links with public RLS access

### Mobile-First Design
- Fully responsive layout (640px, 768px, 1024px breakpoints)
- Touch-friendly UI with 44px minimum tap targets
- Collapsible sidebar with directional cursor cue on the drag handle
- Hamburger menu with slide-out drawer for mobile navigation
- Provider selector modal for mobile
- iOS-optimized input fields (16px font to prevent zoom)

---

## Architecture Overview

### Backend (Python 3.11 + FastAPI)

**Framework & Runtime**
- FastAPI with uvicorn ASGI server
- SSE (Server-Sent Events) streaming via sse-starlette
- CORS middleware (configurable via `CORS_ORIGINS` env var)
- Lifespan hooks: bootstraps document registry from Pinecone on startup if local registry is empty

**Database & Persistence**
- **Supabase PostgreSQL**: User profiles, discussions, messages, formatted chunk cache — all with RLS
- **Pinecone**: Vector embeddings for semantic search (1536-dim cosine)
- **Disk Registry**: `backend/data/document_registry.json` for document metadata persistence across restarts

**Authentication**
- Supabase Auth with JWT verification (ES256/RS256/EdDSA via JWKS endpoint; HS256 fallback for legacy tokens)
- `get_current_user_id()` FastAPI dependency injection on all protected endpoints
- Email confirmation handling via URL hash in frontend

**AI Providers** (auto-registered at module load via `ProviderRegistry`)
- **Claude** (`claude-sonnet-4-5-20250929`) — Anthropic SDK, async streaming, vision support
- **Mistral** (`mistral-large-latest`) — async streaming, vision support, fast query rewriting
- **OpenAI** — AsyncOpenAI used exclusively for `text-embedding-3-small` embeddings; not a chat provider

**Services** (singleton pattern via `get_*_service()`)
- **DiscussionService**: Supabase-backed CRUD for discussions and messages
- **DocumentService**: Document extraction, token-aware chunking, Pinecone batch embedding, instructor index
- **AttachmentService**: In-memory conversation-scoped file storage; reuses DocumentService text extraction
- **PineconeService**: Vector DB client with lazy initialization and batch upsert
- **IntentClassifier**: Regex-based intent detection, 11 intents + generalist fallback, zero-latency

**Intent Classification** (11 intents)

| Intent | Label | Preferred Provider |
|--------|-------|--------------------|
| `continuation` | Continuing Response | inherited |
| `summarize` | Summary | Mistral |
| `explain` | Explainer | Claude |
| `compare` | Comparison | Mistral |
| `builder` | Builder | Claude |
| `case_analysis` | Case Analysis | Mistral |
| `generate_questions` | Assessment | Claude |
| `critique` | Critique | Claude |
| `methodology` | Methodology | Claude |
| `lesson_plan` | Lesson Plan | Mistral |
| `generalist` | Generalist (fallback) | Mistral |

**RAG Pipeline** (4-stage)
1. **Query Embedding**: User query → text-embedding-3-small → 1536-dim vector
2. **Pinecone Search**: Query vector → top-k chunks (k controlled by research mode)
3. **Entity Boost**: Extract person names via n-gram → match instructor index → tiered score boost (+0.30 / +0.15 / +0.05)
4. **Context Assembly**: Number sources → format as `[Source N - filename]\n...` → inject into system prompt; attachments prepended as `[Attached File: filename]\n...`

**Text Processing**
- **Extraction**: PyPDF (PDFs), python-docx (DOCX), direct read (TXT/MD)
- **Chunking**: Token-aware (cl100k_base), 500 tokens/chunk, 50 token overlap
- **Algorithm**: Paragraph detection → type classification → accumulate to budget → sentence-level fallback
- **Embedding**: Batch upsert to Pinecone with document_id + chunk_index metadata

**Streaming Pipeline**
- SSE events emitted in order: `discussion_title` → `sources` → `intent` → `chunk` (repeated) → `suggested_questions` → `done`
- Continuation detection: if prior assistant message is marked `is_truncated`, rewrites query to resume from exact cut-off
- Stale citation sanitization: strips `[N]` markers from prior messages before sending to model (prevents hallucinated re-citations)
- Post-processing: removes contradictory `[N][AI]` co-occurrences from Mistral output via `re.sub`

**API Routes**
- `POST /api/chat/stream` — SSE streaming chat
- `GET /api/chat/providers` — List configured providers
- `GET /api/discussions` — List user's discussions
- `POST /api/discussions` — Create discussion
- `GET /api/discussions/{id}` — Get discussion with messages
- `PUT /api/discussions/{id}` — Update title / active / public status
- `DELETE /api/discussions/{id}` — Delete discussion
- `DELETE /api/discussions` — Delete all user's discussions
- `POST /api/documents/upload` — Upload and embed document
- `GET /api/documents` — List all documents
- `GET /api/documents/{id}` — Get document metadata
- `DELETE /api/documents/{id}` — Delete document + Pinecone vectors
- `POST /api/discussions/{id}/attachments` — Upload attachment
- `GET /api/discussions/{id}/attachments` — List attachments
- `GET /api/discussions/{id}/attachments/{att_id}` — Get attachment detail
- `DELETE /api/discussions/{id}/attachments/{att_id}` — Delete attachment
- `GET /api/research/modes` — List research modes
- `GET /health` — Health check with provider status

---

### Frontend (React 19 + TypeScript + Vite 7)

**Framework & Build**
- React 19 + TypeScript 5.x
- Vite 7 (HMR, fast bundling)
- React Router 7 for client-side routing
- CSS Modules + Tailwind CSS

**Routes**
- `/` — Redirects to `/chat`
- `/chat` — New chat (no active discussion)
- `/chat/:discussionId` — Specific discussion
- `/share/:discussionId` — Public shared discussion (auth-gated redirect flow)

**State Management (Zustand)**
- **useAuthStore** — User auth, session, Supabase integration
- **useDiscussionStore** — Discussion CRUD, active discussion; URL param is source of truth for active ID
- **useChatStore** — Messages, streaming state, chunk buffer, hover placeholder, truncation flag
- **useProviderStore** — Provider selection (persisted to localStorage)
- **useDocumentStore** — Document upload, list, selection
- **useAttachmentStore** — Discussion-scoped attachment upload and preview
- **useResearchModeStore** — Research mode selection (persisted to localStorage)
- **previewStore** — Document preview open/close, highlighted chunk ID, formatted content cache

**Services**
- **ApiService** (`api.ts`) — Singleton fetch wrapper with Supabase Bearer token injection
- **SSEClient** (`sse.ts`) — Async generator SSE parser; yields typed events; supports AbortSignal
- **Supabase Client** (`supabase.ts`) — `@supabase/supabase-js` singleton
- **Voice Service** (`voice.ts`) — Web Speech API wrapper
- **PDF Export** (`pdfExport.ts`) — `exportDocumentToPDF()` for chat; `exportHistoryToPDF()` for history list

**Custom Hooks**
- **useSSE** — Orchestrates send flow: create discussion → add user message → start SSE → handle events → finalize
- **useChunkBuffer** — Debounces streaming text updates for optimal React rendering
- **useVoice** — Speech-to-text with start/stop/transcript

**Key Components**
- **ChatArea** — Main chat container; empty state with quick-action chips + submenus; auto-scroll (throttled)
- **ChatMessage** — Message with role, timestamp, provider badge, token/latency metrics, Continue On chip
- **ChatInput** — Textarea with voice, attachments, provider selector, research mode; hover placeholder from store
- **SourcesDisplay** — Tabbed source view (Grid / Chat / References) with clickable `[N]` citation chips
- **InlineCitation** — Hover tooltip with filename, relevance %, "Explore ↗" CTA; click opens document preview
- **DocumentPreviewPane** — Full-text document panel with chunk navigation and highlighted retrieved section
- **AttachmentPanel** — List and preview conversation-scoped attachments
- **AuthModal** — Sign up / sign in with avatar picker, display name, preferred name, email confirmation flow
- **Sidebar** — Discussion list, new chat, 3-dot menu (export history, delete all), collapsible with drag-handle cursor cue
- **ProviderToggles** — Desktop toggle buttons; mobile modal selector
- **ResearchModeSelector** — Quick / Enhanced / Deep mode picker with descriptions

---

## Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| **Frontend** | React | 19 |
| | TypeScript | 5.x |
| | Vite | 7 |
| | React Router | 7 |
| | Zustand | 5.x |
| | Tailwind CSS | 3.x |
| | Lucide React | 0.562.0 |
| | jsPDF + html2canvas | 4.x / 1.x |
| **Backend** | Python | 3.11+ |
| | FastAPI | Latest |
| | uvicorn | Latest |
| | sse-starlette | Latest |
| **Database** | Supabase (PostgreSQL) | Latest |
| | Pinecone | Latest |
| **AI Providers** | Anthropic SDK | Latest |
| | Mistral SDK | ≥1.0.0, <2.0.0 |
| | OpenAI SDK | Latest (embeddings only) |
| **Document Processing** | PyPDF | Latest |
| | python-docx | Latest |
| | tiktoken | Latest |
| **Authentication** | Supabase Auth | Latest |
| | PyJWT | Latest |

---

## Getting Started

### Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- **Supabase account** (auth + database)
- **Pinecone account** (vector search)
- **API keys**: Anthropic and Mistral (chat); OpenAI (embeddings — required)

---

### Quick Start (Automated)

```bash
# Start both backend and frontend
./start.sh

# Stop all services
./stop.sh
```

**What `start.sh` does:**
- Creates Python virtual environment (if not exists) and installs backend dependencies
- Starts backend at `http://localhost:8000`
- Installs frontend npm deps and starts Vite dev server at `http://localhost:5173`
- Logs to `logs/backend.log` and `logs/frontend.log`
- Stores PIDs in `.pids/` for clean shutdown

---

### Manual Setup

#### 1. Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env` — see [Environment Variables](#environment-variables) below.

**Initialize Supabase database:**

```bash
# Paste contents of backend/supabase_schema.sql into Supabase SQL Editor and execute.
# Creates: profiles, discussions, messages, document_formatted_chunks tables + RLS policies + trigger
```

**Start backend:**

```bash
uvicorn app.main:app --reload
# API: http://localhost:8000
# Docs: http://localhost:8000/docs
```

---

#### 2. Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env
```

Edit `frontend/.env`:

```env
VITE_API_URL=http://localhost:8000
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

```bash
npm run dev
# App: http://localhost:5173
```

---

#### 3. Supabase Setup

1. Create project at https://supabase.com/dashboard
2. Get credentials: **Project Settings → API**
   - Project URL → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_KEY` + `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`
   - **Settings → API → JWT Settings → JWT Secret** → `SUPABASE_JWT_SECRET` (required)
3. Run `backend/supabase_schema.sql` in SQL Editor
4. Enable Email Auth: **Authentication → Providers → Email**

---

#### 4. Pinecone Setup

1. Create account at https://www.pinecone.io/
2. Create index:
   - Name: `qodex-documents` (or custom via `PINECONE_INDEX_NAME`)
   - Dimensions: **1536**
   - Metric: **Cosine**
   - Spec: Serverless (AWS us-east-1 recommended)
3. Copy API key → `PINECONE_API_KEY`

---

## Environment Variables

### Backend (`backend/.env`)

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret

# AI Providers
ANTHROPIC_API_KEY=sk-ant-...
MISTRAL_API_KEY=...
OPENAI_API_KEY=sk-...          # Required for embeddings (text-embedding-3-small)

# AI Model Overrides (optional — defaults shown)
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
MISTRAL_MODEL=mistral-large-latest

# Pinecone
PINECONE_API_KEY=...
PINECONE_INDEX_NAME=qodex-documents
PINECONE_ENVIRONMENT=us-east-1
PINECONE_HOST=...              # Optional — uses index name if omitted

# Application
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
DEBUG=true
LOG_LEVEL=INFO
```

### Frontend (`frontend/.env`)

```env
VITE_API_URL=http://localhost:8000
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

---

## Project Structure

```
Qodex/
├── backend/
│   ├── app/
│   │   ├── api/routes/
│   │   │   ├── chat.py              # SSE streaming endpoint
│   │   │   ├── discussions.py       # Discussion CRUD
│   │   │   ├── documents.py         # Document upload/preview
│   │   │   └── attachments.py       # Attachment management
│   │   ├── auth/
│   │   │   └── dependencies.py      # JWT verification (Supabase JWKS)
│   │   ├── core/
│   │   │   ├── config.py            # Pydantic settings + env vars
│   │   │   └── research_modes.py    # Research mode definitions
│   │   ├── database/
│   │   │   └── supabase_client.py
│   │   ├── models/
│   │   │   ├── discussion.py
│   │   │   ├── message.py           # DocumentSource, MessageRole, Message
│   │   │   ├── document.py
│   │   │   └── attachment.py
│   │   ├── providers/
│   │   │   ├── __init__.py          # ProviderRegistry
│   │   │   ├── base.py              # BaseProvider abstract
│   │   │   ├── claude_provider.py   # Anthropic streaming + vision
│   │   │   └── mistral_provider.py  # Mistral streaming + vision
│   │   ├── services/
│   │   │   ├── discussion_service.py
│   │   │   ├── document_service.py  # Extraction, chunking, Pinecone indexing
│   │   │   ├── attachment_service.py
│   │   │   ├── pinecone_service.py
│   │   │   └── intent_classifier.py
│   │   └── main.py                  # FastAPI app + lifespan
│   ├── data/
│   │   └── document_registry.json   # Persisted document metadata
│   ├── requirements.txt
│   ├── .env
│   ├── .env.example
│   └── supabase_schema.sql          # Run once in Supabase SQL Editor
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   └── App.tsx              # Main routing + auth gate
│   │   ├── components/layout/
│   │   │   ├── Sidebar.tsx          # Discussion list, export, collapsible
│   │   │   └── NestedQuestionItem.tsx
│   │   ├── features/
│   │   │   ├── auth/                # AuthModal, useAuthStore
│   │   │   ├── chat/                # ChatArea, ChatMessage, ChatInput, SourcesDisplay, InlineCitation
│   │   │   ├── discussions/         # useDiscussionStore
│   │   │   ├── documents/           # useDocumentStore, previewStore, DocumentPreviewPane
│   │   │   ├── attachments/         # useAttachmentStore, AttachmentPanel
│   │   │   ├── providers/           # ProviderToggles, useProviderStore
│   │   │   └── research/            # ResearchModeSelector, useResearchModeStore
│   │   └── shared/
│   │       ├── services/
│   │       │   ├── api.ts           # ApiService singleton
│   │       │   ├── sse.ts           # SSE async generator client
│   │       │   ├── supabase.ts      # Supabase JS singleton
│   │       │   ├── voice.ts         # Web Speech API
│   │       │   └── pdfExport.ts     # exportDocumentToPDF + exportHistoryToPDF
│   │       ├── hooks/
│   │       │   ├── useSSE.ts        # Message send orchestration
│   │       │   ├── useChunkBuffer.ts
│   │       │   └── useVoice.ts
│   │       └── types/index.ts       # All TypeScript types
│   ├── package.json
│   ├── vite.config.ts
│   └── .env.example
├── start.sh
├── stop.sh
└── render.yaml                      # Render.com deployment blueprint
```

---

## Database Schema (Supabase)

Run `backend/supabase_schema.sql` in your Supabase SQL Editor.

**Tables:**

1. **profiles** — Auto-created on signup via trigger
   - `id` (UUID, FK auth.users ON DELETE CASCADE), `email`, `display_name`, `created_at`
   - RLS: users can read and update their own profile

2. **discussions**
   - `id`, `user_id` (FK profiles), `title` (default `'New Chat'`), `is_active`, `is_public`, `created_at`, `updated_at`
   - `is_public`: enables shareable links via `/share/:id`
   - RLS: owner full CRUD; any authenticated user can read public discussions

3. **messages**
   - `id`, `discussion_id` (FK discussions ON DELETE CASCADE)
   - `role` (CHECK: user/assistant/system), `content`, `provider`
   - `tokens_used`, `response_time_ms`
   - `sources`, `citations`, `suggested_questions` (JSONB)
   - `intent`, `research_mode`, `created_at`
   - RLS: mirrors discussion ownership; public discussion messages readable by any authenticated user

4. **document_formatted_chunks** — L2 format cache
   - `id`, `document_id`, `chunk_id`, `formatted_content`, `created_at`
   - Unique on `(document_id, chunk_id)` — persists AI-formatted chunk previews for instant document opens

**Trigger:**
- `on_auth_user_created` — auto-creates profile row on Supabase auth signup

---

## Deployment

### Render (Recommended)

Qodex ships with a `render.yaml` blueprint for one-click deployment:

1. Push to GitHub
2. Connect repo to Render → Create Blueprint from `render.yaml`
3. Set environment variables in Render Dashboard (backend and frontend services)
4. Deploy — Render auto-deploys on every `git push`

**Services:**
- **Backend**: Python web service — `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Frontend**: Static site — `npm run build`, serves `dist/`, SPA fallback `/* → /index.html`

### Manual (Production)

```bash
# Backend
cd backend && pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Frontend
cd frontend && npm install && npm run build
# Serve dist/ with nginx/caddy/apache
```

---

## Development

### Adding a New AI Provider

1. Create `backend/app/providers/new_provider.py` extending `BaseProvider`:
   ```python
   from .base import BaseProvider
   from typing import AsyncGenerator

   class NewProvider(BaseProvider):
       async def stream_completion(self, messages, context="", temperature=0.7,
                                   max_tokens=2000, intent_prompt="", research_prompt=""
                                   ) -> AsyncGenerator[str, None]:
           yield chunk
   ```

2. Register at module level (providers auto-register on import):
   ```python
   from app.providers import registry
   registry.register("new_provider", NewProvider, "Display Name", "model-name")
   ```

3. Add API key to `backend/app/core/config.py` and `backend/.env`

### File Conventions

| Location | Convention |
|----------|-----------|
| `backend/app/models/` | Pydantic `BaseModel` with `__init__.py` re-exports |
| `backend/app/services/` | Singleton pattern via `get_*_service()` getter |
| `frontend/src/features/<name>/` | Feature folder; export public API via `index.ts` |
| `frontend/src/shared/types/index.ts` | All TypeScript types centralized here |
| Zustand stores | `interface State` + `interface Actions` pattern |
| `frontend/src/shared/services/` | API and external service integrations |

---

## Troubleshooting

**Backend won't start**
- Verify Python 3.11+: `python --version`
- Activate venv: `source venv/bin/activate`
- Check all required `.env` keys are present
- Verify Supabase URL/keys and Pinecone API key

**Frontend won't start**
- Verify Node 18+: `node --version`
- Delete `node_modules` + `package-lock.json` and re-run `npm install`
- Confirm `VITE_API_URL` and Supabase vars are set in `frontend/.env`

**Authentication not working**
- `SUPABASE_JWT_SECRET` must be set in `backend/.env` (Dashboard → Settings → API → JWT Secret)
- Confirm `supabase_schema.sql` was executed in the SQL Editor
- Check email confirmation settings in Supabase Dashboard

**RAG not returning results**
- Verify Pinecone index exists with name matching `PINECONE_INDEX_NAME` and dimension 1536
- Confirm documents were uploaded successfully; check `backend/data/document_registry.json`
- Try switching to Deep research mode for a broader score threshold (≥ 0.25)

**Streaming not working**
- Verify Anthropic and Mistral API keys are valid and have sufficient quota
- Check CORS: `CORS_ORIGINS` in backend `.env` must include the frontend origin
- Check browser console for SSE connection errors

---

## License

Copyright (c) 2026 Aleksey Przhevalskiy and Tamer Institute for Social Enterprise and Climate Change. All rights reserved.

Licensed under the [Business Source License 1.1](LICENSE). Production use requires a commercial license from the Licensor. The Licensed Work will convert to MIT License on 2029-03-24.

For commercial licensing inquiries, contact: przalex2@gmail.com

---

## Acknowledgments

- Anthropic for Claude models
- Mistral AI for Mistral models
- OpenAI for embedding API (text-embedding-3-small)
- Pinecone for vector database
- Supabase for authentication and PostgreSQL
- FastAPI and React communities
