import { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { sseClient } from '@/shared/services/sse';
import { useChatStore } from '@/features/chat';
import { useDiscussionStore } from '@/features/discussions';
import { useProviderStore } from '@/features/providers';
import { useDocumentStore } from '@/features/documents';
import { useAttachmentStore } from '@/features/attachments/store';
import { useResearchModeStore } from '@/features/research';
import { useChunkBuffer } from '@/shared/hooks/useChunkBuffer';
import { ProviderName } from '@/shared/types';

export function useSSE() {
  const navigate = useNavigate();
  const messageIdRef = useRef<string>('');

  const { addMessage, startStream, appendToStream, setStreamSources, setStreamSuggestedQuestions, setStreamIntent, setStreamResearchMode, finalizeStream, cancelStream } = useChatStore();
  const { push: pushChunk, flush: flushChunks } = useChunkBuffer(appendToStream);
  // appendToStream is passed to the chunk buffer — not called directly
  const { activeDiscussionId, updateDiscussionTitle } = useDiscussionStore();
  const { activeProvider } = useProviderStore();
  const { selectedDocumentIds } = useDocumentStore();
  const { attachments } = useAttachmentStore();
  const { activeMode } = useResearchModeStore();

  const sendMessage = useCallback(
    async (content: string, provider?: ProviderName, discussionId?: string) => {
      let targetDiscussionId = discussionId || activeDiscussionId;

      // Auto-create discussion if none exists (e.g., when starting a new chat)
      if (!targetDiscussionId) {
        const { createDiscussion } = useDiscussionStore.getState();
        const newDiscussion = await createDiscussion();
        targetDiscussionId = newDiscussion.id;
        // Prevent ChatArea from overwriting messages for this fresh discussion
        useChatStore.getState().skipNextMessageLoad();
        navigate(`/chat/${targetDiscussionId}`, { replace: true });
      }

      const selectedProvider = provider || activeProvider;

      // Add user message to store
      const userMessage = {
        id: crypto.randomUUID(),
        content,
        role: 'user' as const,
        timestamp: new Date().toISOString(),
      };
      addMessage(userMessage);

      // Start streaming
      startStream(selectedProvider);
      setStreamResearchMode(activeMode);
      messageIdRef.current = crypto.randomUUID();

      try {
        const attachmentIds = attachments.map((a) => a.id);
        const stream = sseClient.streamChat({
          discussion_id: targetDiscussionId,
          message: content,
          provider: selectedProvider,
          document_ids: selectedDocumentIds.length > 0 ? selectedDocumentIds : undefined,
          attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
          research_mode: activeMode,
        });

        for await (const event of stream) {
          if (event.type === 'discussion_title') {
            // Update discussion title immediately during streaming
            updateDiscussionTitle(event.discussion_id, event.title);
          } else if (event.type === 'sources') {
            setStreamSources(event.sources);
          } else if (event.type === 'intent') {
            setStreamIntent(event.intent, event.label, (event as any).is_continuation === true);
          } else if (event.type === 'chunk') {
            pushChunk(event.content);
          } else if (event.type === 'suggested_questions') {
            setStreamSuggestedQuestions(event.questions);
          } else if (event.type === 'error') {
            // Show the error as an assistant message so the user sees it in chat
            appendToStream(event.error);
            flushChunks();
            finalizeStream(messageIdRef.current);
            return;
          } else if (event.type === 'done') {
            flushChunks();
            finalizeStream(messageIdRef.current);
            break;
          }
        }
      } catch (error) {
        flushChunks();
        cancelStream();
        throw error;
      }
    },
    [
      navigate,
      activeDiscussionId,
      activeProvider,
      selectedDocumentIds,
      attachments,
      activeMode,
      addMessage,
      startStream,
      pushChunk,
      flushChunks,
      setStreamSources,
      setStreamSuggestedQuestions,
      setStreamIntent,
      setStreamResearchMode,
      finalizeStream,
      cancelStream,
      updateDiscussionTitle,
    ]
  );

  const stopStream = useCallback(() => {
    flushChunks();
    sseClient.cancel();
    const discussionId = useDiscussionStore.getState().activeDiscussionId;
    if (discussionId) {
      useChatStore.getState().gracefulStop(messageIdRef.current, discussionId);
    }
  }, [flushChunks]);

  return {
    sendMessage,
    stopStream,
    isStreaming: useChatStore((state) => state.isStreaming),
  };
}
