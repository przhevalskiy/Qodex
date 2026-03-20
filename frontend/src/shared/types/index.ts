// Message types
export type MessageRole = 'user' | 'assistant' | 'system';

export interface DocumentSource {
  id: string;
  document_id?: string;
  filename: string;
  score: number;
  chunk_preview?: string;
  citation_number?: number;  // Position in citation list for inline references
  chunk_id?: string;  // Pinecone chunk ID for highlight-on-click in document preview
}

export interface Message {
  id: string;
  content: string;
  role: MessageRole;
  provider?: string;
  timestamp: string;
  tokens_used?: number;
  response_time_ms?: number;
  sources?: DocumentSource[];
  citations?: Record<number, string>;  // Map citation numbers to document IDs
  suggested_questions?: string[];  // AI-generated follow-up questions
  intent?: string;  // Detected intent: "summarize", "case_study", etc.
  is_continuation?: boolean;  // True when this response resumed a prior truncated response
  is_truncated?: boolean;    // True when response was cut off by the token limit
  research_mode?: ResearchMode;  // Active research depth: "quick", "enhanced", "deep"
}

// Discussion types
export interface Discussion {
  id: string;
  title: string;
  messages: Message[];
  is_active: boolean;
  is_public: boolean;  // true when shared via link; any authenticated user can read
  created_at: string;
  updated_at: string;
}

export interface DiscussionCreate {
  title?: string;
}

export interface DiscussionUpdate {
  title?: string;
  is_active?: boolean;
}

// Provider types
export type ProviderName = 'mistral' | 'claude' | 'auto';

export interface Provider {
  name: ProviderName;
  display_name: string;
  model: string;
  configured: boolean;
}

// Research Mode types
export type ResearchMode = 'quick' | 'enhanced' | 'deep';

export interface ResearchModeConfig {
  mode: ResearchMode;
  label: string;
  description: string;
  top_k: number;
  is_default: boolean;
}

export interface ResearchModesResponse {
  modes: ResearchModeConfig[];
  default: ResearchMode;
}

// Document types
export interface Document {
  id: string;
  filename: string;
  content_type: string;
  chunk_ids: string[];
  chunk_count: number;
  file_size: number;
  created_at: string;
  is_embedded: boolean;
}

export interface SearchResult {
  id: string;
  score: number;
  content: string;
  filename: string;
}

// Attachment types (conversation-scoped files, NOT indexed in Pinecone)
export interface AttachmentSummary {
  id: string;
  discussion_id: string;
  filename: string;
  file_content_type: string;
  file_size: number;
  chunk_count: number;
  created_at: string;
  is_image?: boolean;
}

export interface AttachmentChunk {
  id: string;
  content: string;
  chunk_index: number;
  content_type: string;
}

export interface AttachmentDetail {
  id: string;
  discussion_id: string;
  filename: string;
  file_content_type: string;
  file_size: number;
  chunk_count: number;
  created_at: string;
  is_image?: boolean;
  image_data?: string;
  full_text: string;
  chunks: AttachmentChunk[];
}

// Chat types
export interface ChatRequest {
  discussion_id: string;
  message: string;
  provider: ProviderName;
  document_ids?: string[];
  attachment_ids?: string[];
  temperature?: number;
  max_tokens?: number;
  research_mode?: ResearchMode;
}

// SSE Event types
export interface SSEChunkEvent {
  type: 'chunk';
  content: string;
  provider: string;
}

export interface SSESourcesEvent {
  type: 'sources';
  sources: DocumentSource[];
  provider: string;
}

export interface SSEDoneEvent {
  type: 'done';
  provider: string;
  truncated?: boolean;
}

export interface SSEErrorEvent {
  type: 'error';
  error: string;
  provider: string;
}

export interface SSESuggestedQuestionsEvent {
  type: 'suggested_questions';
  questions: string[];
}

export interface SSEDiscussionTitleEvent {
  type: 'discussion_title';
  discussion_id: string;
  title: string;
}

export interface SSEIntentEvent {
  type: 'intent';
  intent: string;
  label: string;
}

export type SSEEvent = SSEChunkEvent | SSESourcesEvent | SSESuggestedQuestionsEvent | SSEDiscussionTitleEvent | SSEIntentEvent | SSEDoneEvent | SSEErrorEvent;

// API Response types
export interface ApiError {
  detail: string;
}

export interface HealthResponse {
  status: string;
  providers: Record<ProviderName, boolean>;
  pinecone: boolean;
}
