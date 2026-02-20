import {
  Discussion,
  DiscussionCreate,
  DiscussionUpdate,
  Document,
  Provider,
  Message,
  MessageRole,
  ResearchModesResponse,
  AttachmentSummary,
  AttachmentDetail,
} from '@/shared/types';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}` };
  }
  return {};
}

class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const authHeaders = await getAuthHeaders();
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'An error occurred' }));
      throw new Error(error.detail || `HTTP error ${response.status}`);
    }

    return response.json();
  }

  // Health check
  async healthCheck() {
    return this.request<{ status: string; providers: Record<string, boolean>; pinecone: boolean }>('/health');
  }

  // Discussions
  async getDiscussions(): Promise<Discussion[]> {
    return this.request<Discussion[]>('/api/discussions');
  }

  async getDiscussion(id: string): Promise<Discussion> {
    return this.request<Discussion>(`/api/discussions/${id}`);
  }

  async createDiscussion(data?: DiscussionCreate): Promise<Discussion> {
    return this.request<Discussion>('/api/discussions', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  }

  async updateDiscussion(id: string, data: DiscussionUpdate): Promise<Discussion> {
    return this.request<Discussion>(`/api/discussions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteDiscussion(id: string): Promise<void> {
    await this.request(`/api/discussions/${id}`, {
      method: 'DELETE',
    });
  }

  async deleteAllDiscussions(): Promise<{ status: string; count: number }> {
    return this.request<{ status: string; count: number }>('/api/discussions', {
      method: 'DELETE',
    });
  }

  async activateDiscussion(id: string): Promise<Discussion> {
    return this.request<Discussion>(`/api/discussions/${id}/activate`, {
      method: 'POST',
    });
  }

  async addMessage(
    discussionId: string,
    content: string,
    role: MessageRole,
    provider?: string
  ): Promise<Message> {
    return this.request<Message>(`/api/discussions/${discussionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, role, provider }),
    });
  }

  // Providers
  async getProviders(): Promise<{ providers: Provider[] }> {
    return this.request<{ providers: Provider[] }>('/api/chat/providers');
  }

  // Research Modes
  async getResearchModes(): Promise<ResearchModesResponse> {
    return this.request<ResearchModesResponse>('/api/chat/research-modes');
  }

  // Documents
  async getDocuments(): Promise<Document[]> {
    return this.request<Document[]>('/api/documents');
  }

  async getDocument(id: string): Promise<Document> {
    return this.request<Document>(`/api/documents/${id}`);
  }

  async uploadDocument(file: File): Promise<Document> {
    const formData = new FormData();
    formData.append('file', file);
    const authHeaders = await getAuthHeaders();

    const response = await fetch(`${this.baseUrl}/api/documents/upload`, {
      method: 'POST',
      headers: { ...authHeaders },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(error.detail || `HTTP error ${response.status}`);
    }

    return response.json();
  }

  async deleteDocument(id: string): Promise<void> {
    await this.request(`/api/documents/${id}`, {
      method: 'DELETE',
    });
  }

  async searchDocuments(
    query: string,
    topK: number = 5,
    documentIds?: string[]
  ): Promise<{ id: string; score: number; content: string; filename: string }[]> {
    return this.request('/api/documents/search', {
      method: 'POST',
      body: JSON.stringify({ query, top_k: topK, document_ids: documentIds }),
    });
  }

  async getDocumentContent(id: string): Promise<any> {
    return this.request(`/api/documents/${id}/content`);
  }

  async getDocumentChunks(id: string): Promise<{ chunks: any[] }> {
    return this.request(`/api/documents/${id}/chunks`);
  }

  async formatDocumentPreview(
    documentId: string,
    chunks: { id: string; content: string }[]
  ): Promise<{ formatted: { id: string; content: string }[] }> {
    return this.request(`/api/documents/${documentId}/format-preview`, {
      method: 'POST',
      body: JSON.stringify({ chunks }),
    });
  }

  async chatWithDocument(id: string, message: string, provider: string): Promise<Response> {
    const authHeaders = await getAuthHeaders();
    const response = await fetch(`${this.baseUrl}/api/documents/${id}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({ message, provider }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Chat failed' }));
      throw new Error(error.detail || `HTTP error ${response.status}`);
    }

    return response;
  }

  // Attachments (conversation-scoped files)
  async uploadAttachment(discussionId: string, file: File): Promise<AttachmentSummary> {
    const formData = new FormData();
    formData.append('file', file);
    const authHeaders = await getAuthHeaders();

    const response = await fetch(
      `${this.baseUrl}/api/discussions/${discussionId}/attachments`,
      { method: 'POST', headers: { ...authHeaders }, body: formData }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(error.detail || `HTTP error ${response.status}`);
    }

    return response.json();
  }

  async getAttachments(discussionId: string): Promise<AttachmentSummary[]> {
    return this.request<AttachmentSummary[]>(
      `/api/discussions/${discussionId}/attachments`
    );
  }

  async getAttachmentDetail(discussionId: string, attachmentId: string): Promise<AttachmentDetail> {
    return this.request<AttachmentDetail>(
      `/api/discussions/${discussionId}/attachments/${attachmentId}`
    );
  }

  async deleteAttachment(discussionId: string, attachmentId: string): Promise<void> {
    await this.request(
      `/api/discussions/${discussionId}/attachments/${attachmentId}`,
      { method: 'DELETE' }
    );
  }

  // Chat stream URL builder
  getStreamUrl(): string {
    return `${this.baseUrl}/api/chat/stream`;
  }
}

export const api = new ApiService(API_URL);
