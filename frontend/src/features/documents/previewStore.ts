import { create } from 'zustand';
import { Document } from '@/shared/types';
import { api } from '@/shared/services/api';

interface DocumentPreviewState {
  previewDocument: Document | null;
  documentContent: any;
  documentChunks: any[];
  highlightedChunk: string | null;
  isLoading: boolean;
  isFormatting: boolean;
  error: string | null;
  isDocumentChatStreaming: boolean;
  documentChatMessages: any[];
  documentChatContent: string;
}

interface DocumentPreviewActions {
  openDocumentPreview: (documentId: string, chunkId?: string) => Promise<void>;
  closeDocumentPreview: () => void;
  highlightChunk: (chunkId: string) => void;
  clearHighlight: () => void;
  clearError: () => void;
  setFormatting: (value: boolean) => void;
  sendDocumentChatMessage: (message: string, provider: string) => Promise<void>;
  clearDocumentChat: () => void;
}

type DocumentPreviewStore = DocumentPreviewState & DocumentPreviewActions;

export const useDocumentPreviewStore = create<DocumentPreviewStore>((set, get) => ({
  // State
  previewDocument: null,
  documentContent: null,
  documentChunks: [],
  highlightedChunk: null,
  isLoading: false,
  isFormatting: false,
  error: null,
  isDocumentChatStreaming: false,
  documentChatMessages: [],
  documentChatContent: '',

  // Actions
  openDocumentPreview: async (documentId: string, chunkId?: string) => {
    set({ isLoading: true, error: null, documentChatMessages: [], documentChatContent: '' });

    try {
      // Get document metadata first — sets previewDocument so modal mounts
      // while content/chunks are still loading (isLoading remains true)
      const document = await api.getDocument(documentId);
      set({ previewDocument: document });

      // Get document content and chunks in parallel
      const [content, chunks] = await Promise.all([
        api.getDocumentContent(documentId),
        api.getDocumentChunks(documentId)
      ]);

      set({
        documentContent: content,
        documentChunks: chunks.chunks,
        isLoading: false,
        // Pre-set isFormatting so header/right-pane skeleton stays until
        // DocumentPreviewPane finishes the AI formatting step
        isFormatting: chunks.chunks.length > 0,
        highlightedChunk: chunkId || null,
      });
    } catch (error) {
      set({
        error: (error as Error).message,
        isLoading: false
      });
    }
  },

  closeDocumentPreview: () => {
    set({
      previewDocument: null,
      documentContent: null,
      documentChunks: [],
      highlightedChunk: null,
      isFormatting: false,
      error: null,
      documentChatMessages: [],
      documentChatContent: ''
    });
  },

  highlightChunk: (chunkId: string) => {
    set({ highlightedChunk: chunkId });
  },

  clearHighlight: () => {
    set({ highlightedChunk: null });
  },

  clearError: () => {
    set({ error: null });
  },

  setFormatting: (value: boolean) => {
    set({ isFormatting: value });
  },

  sendDocumentChatMessage: async (message: string, provider: string) => {
    const state = get();
    if (!state.previewDocument) return;

    set({ 
      isDocumentChatStreaming: true, 
      documentChatContent: '',
      error: null 
    });

    // Add user message
    const userMessage = {
      id: Date.now().toString(),
      content: message,
      role: 'user',
      timestamp: new Date().toISOString()
    };

    set(state => ({
      documentChatMessages: [...state.documentChatMessages, userMessage]
    }));

    try {
      const response = await api.chatWithDocument(
        state.previewDocument!.id, 
        message, 
        provider
      );

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const event = JSON.parse(data);
              
              if (event.type === 'chunk') {
                set(state => ({
                  documentChatContent: state.documentChatContent + event.content
                }));
              } else if (event.type === 'done') {
                // Add assistant message
                const assistantMessage = {
                  id: (Date.now() + 1).toString(),
                  content: get().documentChatContent,
                  role: 'assistant',
                  timestamp: new Date().toISOString()
                };

                set(state => ({
                  documentChatMessages: [...state.documentChatMessages, assistantMessage],
                  isDocumentChatStreaming: false,
                  documentChatContent: ''
                }));
                return;
              } else if (event.type === 'error') {
                throw new Error(event.error);
              }
            } catch (e) {
              console.error('Failed to parse SSE event:', e);
            }
          }
        }
      }
    } catch (error) {
      set({ 
        error: (error as Error).message, 
        isDocumentChatStreaming: false 
      });
    }
  },

  clearDocumentChat: () => {
    set({
      documentChatMessages: [],
      documentChatContent: '',
      isDocumentChatStreaming: false
    });
  }
}));
