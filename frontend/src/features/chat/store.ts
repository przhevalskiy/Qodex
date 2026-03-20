import { create } from 'zustand';
import { Message, MessageRole, DocumentSource } from '@/shared/types';
import { api } from '@/shared/services/api';

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  currentStreamContent: string;
  currentStreamProvider: string | null;
  currentStreamSources: DocumentSource[];
  currentStreamSuggestedQuestions: string[];
  currentStreamIntent: { intent: string; label: string } | null;
  currentStreamIsContinuation: boolean;
  currentStreamTruncated: boolean;
  currentStreamResearchMode: string | null;
  error: string | null;
  isLoadingMessages: boolean;
  _skipNextMessageLoad: boolean;
}

interface ChatActions {
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  loadMessagesForDiscussion: (discussionId: string | null) => Promise<void>;
  skipNextMessageLoad: () => void;
  startStream: (provider: string) => void;
  appendToStream: (chunk: string) => void;
  setStreamSources: (sources: DocumentSource[]) => void;
  setStreamSuggestedQuestions: (questions: string[]) => void;
  setStreamIntent: (intent: string, label: string, isContinuation?: boolean) => void;
  setStreamTruncated: (truncated: boolean) => void;
  setStreamResearchMode: (mode: string) => void;
  finalizeStream: (messageId: string) => void;
  gracefulStop: (messageId: string, discussionId: string) => void;
  cancelStream: () => void;
  clearMessages: () => void;
  clearError: () => void;
}

/**
 * Clean up partial markdown so a stopped response looks complete.
 * - Closes unclosed fenced code blocks
 * - Trims to the last sentence boundary
 */
function gracefulTruncate(content: string): string {
  if (!content || content.trim().length < 10) return content;

  let text = content;

  // Close unclosed fenced code blocks
  const fenceCount = (text.match(/^```/gm) || []).length;
  if (fenceCount % 2 !== 0) {
    text = text.trimEnd() + '\n```';
  }

  // Find the last sentence-ending boundary
  // Look for: sentence punctuation followed by space/newline, or double newline, or list-item newline
  const boundaryPattern = /[.!?:;]\s|\n\n|\n(?=[-*+]\s|\d+\.\s|#{1,4}\s|```)/g;
  let lastBoundary = -1;
  let match;
  while ((match = boundaryPattern.exec(text)) !== null) {
    lastBoundary = match.index + 1; // include the punctuation character
  }

  // Only trim if we found a boundary and it's not too far back (keep at least 60% of content)
  if (lastBoundary > 0 && lastBoundary > text.length * 0.4) {
    text = text.slice(0, lastBoundary).trimEnd();
  }

  // Re-check code block closure after trimming
  const finalFenceCount = (text.match(/^```/gm) || []).length;
  if (finalFenceCount % 2 !== 0) {
    text = text.trimEnd() + '\n```';
  }

  return text;
}

type ChatStore = ChatState & ChatActions;


export const useChatStore = create<ChatStore>((set, get) => ({
  // State
  messages: [],
  isStreaming: false,
  currentStreamContent: '',
  currentStreamProvider: null,
  currentStreamSources: [],
  currentStreamSuggestedQuestions: [],
  currentStreamIntent: null,
  currentStreamIsContinuation: false,
  currentStreamTruncated: false,
  currentStreamResearchMode: null,
  error: null,
  isLoadingMessages: false,
  _skipNextMessageLoad: false,

  // Actions
  setMessages: (messages: Message[]) => {
    set({ messages });
  },

  loadMessagesForDiscussion: async (discussionId: string | null) => {
    if (!discussionId) {
      set({ messages: [], isLoadingMessages: false });
      return;
    }

    // Skip if a new discussion was just created — messages are managed by sendMessage
    if (get()._skipNextMessageLoad) {
      set({ _skipNextMessageLoad: false });
      return;
    }

    set({ isLoadingMessages: true, error: null });
    try {
      const discussion = await api.getDiscussion(discussionId);
      set({ messages: discussion.messages, isLoadingMessages: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoadingMessages: false });
    }
  },

  skipNextMessageLoad: () => {
    set({ _skipNextMessageLoad: true });
  },

  addMessage: (message: Message) => {
    set(state => ({
      messages: [...state.messages, message],
    }));
  },

  startStream: (provider: string) => {
    set({
      isStreaming: true,
      currentStreamContent: '',
      currentStreamProvider: provider,
      currentStreamSources: [],
      currentStreamSuggestedQuestions: [],
      currentStreamIntent: null,
      currentStreamIsContinuation: false,
      currentStreamTruncated: false,
      currentStreamResearchMode: null,
      error: null,
    });
  },

  appendToStream: (chunk: string) => {
    set(state => ({
      currentStreamContent: state.currentStreamContent + chunk,
    }));
  },

  setStreamSources: (sources: DocumentSource[]) => {
    set({ currentStreamSources: sources });
  },

  setStreamSuggestedQuestions: (questions: string[]) => {
    set({ currentStreamSuggestedQuestions: questions });
  },

  setStreamIntent: (intent: string, label: string, isContinuation = false) => {
    if (isContinuation) {
      // Second intent event — mark as continuation, keep primary intent unchanged
      set({ currentStreamIsContinuation: true });
    } else {
      set({ currentStreamIntent: { intent, label }, currentStreamIsContinuation: false });
    }
  },

  setStreamTruncated: (truncated: boolean) => {
    set({ currentStreamTruncated: truncated });
  },

  setStreamResearchMode: (mode: string) => {
    set({ currentStreamResearchMode: mode });
  },

  finalizeStream: (messageId: string) => {
    const state = get();

    const assistantMessage: Message = {
      id: messageId,
      content: state.currentStreamContent,
      role: 'assistant' as MessageRole,
      provider: state.currentStreamProvider || undefined,
      timestamp: new Date().toISOString(),
      sources: state.currentStreamSources.length > 0 ? state.currentStreamSources : undefined,
      suggested_questions: state.currentStreamSuggestedQuestions.length > 0 ? state.currentStreamSuggestedQuestions : undefined,
      intent: state.currentStreamIntent?.intent || undefined,
      is_continuation: state.currentStreamIsContinuation || undefined,
      is_truncated: state.currentStreamTruncated || undefined,
      research_mode: (state.currentStreamResearchMode as Message['research_mode']) || undefined,
    };

    set(state => {
      // If this is a continuation, clear is_truncated on the previous truncated message
      const updatedMessages = state.currentStreamIsContinuation
        ? state.messages.map(m =>
            m.is_truncated ? { ...m, is_truncated: undefined, suggested_questions: undefined } : m
          )
        : state.messages;

      return {
        messages: [...updatedMessages, assistantMessage],
        isStreaming: false,
        currentStreamContent: '',
        currentStreamProvider: null,
        currentStreamSources: [],
        currentStreamSuggestedQuestions: [],
        currentStreamIntent: null,
        currentStreamIsContinuation: false,
        currentStreamTruncated: false,
        currentStreamResearchMode: null,
      };
    });
  },

  gracefulStop: (messageId: string, discussionId: string) => {
    const state = get();
    const cleaned = gracefulTruncate(state.currentStreamContent);

    // Nothing streamed yet — just discard
    if (!cleaned.trim()) {
      set({
        isStreaming: false,
        currentStreamContent: '',
        currentStreamProvider: null,
        currentStreamSources: [],
        currentStreamSuggestedQuestions: [],
        currentStreamIntent: null,
        currentStreamIsContinuation: false,
      });
      return;
    }

    const provider = state.currentStreamProvider || undefined;

    const assistantMessage: Message = {
      id: messageId,
      content: cleaned,
      role: 'assistant' as MessageRole,
      provider,
      timestamp: new Date().toISOString(),
      sources: state.currentStreamSources.length > 0 ? state.currentStreamSources : undefined,
      suggested_questions: state.currentStreamSuggestedQuestions.length > 0 ? state.currentStreamSuggestedQuestions : undefined,
      intent: state.currentStreamIntent?.intent || undefined,
      research_mode: (state.currentStreamResearchMode as Message['research_mode']) || undefined,
    };

    set(state => ({
      messages: [...state.messages, assistantMessage],
      isStreaming: false,
      currentStreamContent: '',
      currentStreamProvider: null,
      currentStreamSources: [],
      currentStreamSuggestedQuestions: [],
      currentStreamIntent: null,
      currentStreamResearchMode: null,
    }));

    // Persist to backend so the message survives navigation
    api.addMessage(discussionId, cleaned, 'assistant' as MessageRole, provider).catch(() => {});
  },

  cancelStream: () => {
    set({
      isStreaming: false,
      currentStreamContent: '',
      currentStreamProvider: null,
      currentStreamSources: [],
      currentStreamSuggestedQuestions: [],
      currentStreamIntent: null,
      currentStreamIsContinuation: false,
      currentStreamTruncated: false,
      currentStreamResearchMode: null,
    });
  },

  clearMessages: () => {
    set({ messages: [], error: null });
  },

  clearError: () => set({ error: null }),
}));
