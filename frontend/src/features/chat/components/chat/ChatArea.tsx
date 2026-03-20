import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useChatStore } from '../../store';
import { useDiscussionStore } from '@/features/discussions';
import { useProviderStore } from '@/features/providers';
import { useAuthStore } from '@/features/auth';
import { useSSE } from '@/shared/hooks/useSSE';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatHeader } from './ChatHeader';
import { RotatingText } from '../ui/RotatingText';
import { ThinkingIndicator } from '../ui/ThinkingIndicator';
import { DocumentPreviewModal } from '../modals/DocumentPreviewModal';
import { FilePreviewModal } from '../attachments/FilePreviewModal';
import { FileText, BookOpen, FlaskConical, Users, Video, Lightbulb, Microscope, BookMarked, GraduationCap, ArrowUpRight } from 'lucide-react';
import './ChatArea.css';

// Throttle function for scroll operations
function useThrottledScroll(delay: number = 100) {
  const lastCallRef = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback((element: HTMLElement | null, behavior: ScrollBehavior) => {
    if (!element) return;

    const now = Date.now();
    const timeSinceLastCall = now - lastCallRef.current;

    if (timeSinceLastCall >= delay) {
      lastCallRef.current = now;
      element.scrollIntoView({ behavior });
    } else if (!timeoutRef.current) {
      // Schedule a scroll at the end of the throttle period
      timeoutRef.current = setTimeout(() => {
        lastCallRef.current = Date.now();
        element.scrollIntoView({ behavior });
        timeoutRef.current = null;
      }, delay - timeSinceLastCall);
    }
  }, [delay]);
}

interface ChatAreaProps {
  initialMessage?: string;
}

export function ChatArea({ initialMessage }: ChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState('');
  const prevDiscussionIdRef = useRef<string | null>(null);
  const hasAutoSentRef = useRef(false);
  const { messages, isStreaming, currentStreamContent, currentStreamProvider, currentStreamSources, currentStreamSuggestedQuestions, currentStreamIntent, currentStreamIsContinuation, loadMessagesForDiscussion } =
    useChatStore();

  const { activeDiscussionId, discussions } = useDiscussionStore();
  const { fetchProviders } = useProviderStore();
  const { sendMessage } = useSSE();
  const throttledScroll = useThrottledScroll(100); // Throttle to max 10 scrolls/second

  // Get current discussion for header and title
  const currentDiscussion = discussions.find(d => d.id === activeDiscussionId);

  // Handler for retrying a message - finds the preceding user message and re-sends it
  const handleRetry = useCallback(
    (messageId: string) => {
      const messageIndex = messages.findIndex((m) => m.id === messageId);
      if (messageIndex <= 0) return;

      // Find the preceding user message
      for (let i = messageIndex - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          sendMessage(messages[i].content);
          break;
        }
      }
    },
    [messages, sendMessage]
  );

  // Handler for clicking suggested questions
  const handleQuestionClick = useCallback(
    (question: string) => {
      sendMessage(question);
    },
    [sendMessage]
  );

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  // Load messages ONLY when switching to a different discussion
  // Don't reload if staying in the same discussion (prevents overwriting streaming state)
  useEffect(() => {
    if (prevDiscussionIdRef.current !== activeDiscussionId) {
      loadMessagesForDiscussion(activeDiscussionId);
      prevDiscussionIdRef.current = activeDiscussionId;
    }
  }, [activeDiscussionId, loadMessagesForDiscussion]);

  // Update browser title based on discussion
  useEffect(() => {
    if (activeDiscussionId && currentDiscussion) {
      document.title = currentDiscussion.title || 'Qodex';
    } else {
      document.title = 'Qodex';
    }
  }, [activeDiscussionId, currentDiscussion]);

  useEffect(() => {
    // Throttle scroll during streaming, smooth scroll on new messages
    if (isStreaming) {
      throttledScroll(messagesEndRef.current, 'instant');
    } else {
      // Direct scroll for final message (not throttled)
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, currentStreamContent, isStreaming, throttledScroll]);

  // Auto-send initial message from sample questions
  useEffect(() => {
    // Reset the ref when initialMessage changes to allow new auto-sends
    if (initialMessage) {
      console.log('Initial message received:', initialMessage);
      hasAutoSentRef.current = false;
    }
  }, [initialMessage]);

  useEffect(() => {
    console.log('Auto-send check:', {
      initialMessage,
      hasAutoSent: hasAutoSentRef.current,
      isStreaming,
      messageCount: messages.length
    });
    if (initialMessage && !hasAutoSentRef.current && !isStreaming && messages.length === 0) {
      console.log('Auto-sending message:', initialMessage);
      hasAutoSentRef.current = true;
      sendMessage(initialMessage);
    }
  }, [initialMessage, isStreaming, messages.length, sendMessage]);

  const handleQuickAction = (prompt: string) => {
    setInputValue(prompt);
  };

  // Stabilize the streaming message object so it only recalculates when
  // its actual data changes, not on every ChatArea re-render.
  const streamingMessage = useMemo(() => {
    if (!isStreaming || !currentStreamContent) return null;
    return {
      id: 'streaming',
      content: currentStreamContent,
      role: 'assistant' as const,
      provider: currentStreamProvider || undefined,
      timestamp: '',
      sources: currentStreamSources.length > 0 ? currentStreamSources : undefined,
      suggested_questions: currentStreamSuggestedQuestions.length > 0 ? currentStreamSuggestedQuestions : undefined,
      intent: currentStreamIntent?.intent || undefined,
      is_continuation: currentStreamIsContinuation || undefined,
    };
  }, [isStreaming, currentStreamContent, currentStreamProvider, currentStreamSources, currentStreamSuggestedQuestions, currentStreamIntent, currentStreamIsContinuation]);

  const isEmpty = messages.length === 0 && !isStreaming;

  return (
    <div className={`chat-area ${isEmpty ? 'empty' : ''}`}>
      {isEmpty ? (
        /* Centered layout when empty - like Copilot */
        <>
          <EmptyState />
          <div className="chat-input-container">
            <div className="chat-input-wrapper">
              <ChatInput
                initialValue={inputValue}
                onValueChange={setInputValue}
              />
            </div>
          </div>
          <QuickActions onSelectAction={handleQuickAction} />
        </>
      ) : (
        /* Normal layout with messages */
        <>
          {/* Show header only when there's an active discussion */}
          {activeDiscussionId && currentDiscussion && (
            <ChatHeader
              discussionId={activeDiscussionId}
              discussionTitle={currentDiscussion.title}
              isPublic={currentDiscussion.is_public}
            />
          )}

          <div className="chat-messages">
            <div className="chat-messages-inner">
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  onRetry={() => handleRetry(message.id)}
                  onQuestionClick={handleQuestionClick}
                  onContinue={message.is_truncated ? () => sendMessage('continue') : undefined}
                />
              ))}

              {isStreaming && !currentStreamContent && (
                <ThinkingIndicator provider={currentStreamProvider || undefined} />
              )}

              {streamingMessage && (
                <ChatMessage
                  message={streamingMessage}
                  isStreaming
                  onQuestionClick={handleQuestionClick}
                />
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="chat-input-container">
            <div className="chat-input-wrapper">
              <ChatInput
                initialValue={inputValue}
                onValueChange={setInputValue}
              />
            </div>
          </div>
        </>
      )}
      
      {/* Document Preview Modal */}
      <DocumentPreviewModal />

      {/* Attachment File Preview Modal */}
      <FilePreviewModal />
    </div>
  );
}

interface QuickActionsProps {
  onSelectAction: (prompt: string) => void;
}

function QuickActions({ onSelectAction }: QuickActionsProps) {
  const quickActions = [
    { icon: FileText, label: 'Case studies', prompt: 'What case studies are available on ' },
    { icon: BookOpen, label: 'Course readings', prompt: 'What readings cover ' },
    { icon: FlaskConical, label: 'Simulations', prompt: 'Are there any simulations or interactive exercises for ' },
    { icon: Users, label: 'Faculty expertise', prompt: 'Which faculty are teaching ' },
    { icon: Video, label: 'Video resources', prompt: 'Are there any videos or multimedia resources about ' },
    { icon: Lightbulb, label: 'Lesson plans', prompt: 'I need some ideas for a lesson plan on ' },
    { icon: Microscope, label: 'Research methods', prompt: 'How are other instructors teaching ' },
    { icon: BookMarked, label: 'Best practices', prompt: 'What are the best practices for teaching ' },
    { icon: GraduationCap, label: 'Course examples', prompt: 'Show me example syllabi that cover ' },
  ];

  return (
    <div className="quick-actions">
      {quickActions.map((action) => (
        <button
          key={action.label}
          className="quick-action-btn"
          onClick={() => onSelectAction(action.prompt)}
        >
          <action.icon size={16} />
          <span>{action.label}</span>
          <ArrowUpRight size={16} />
        </button>
      ))}
    </div>
  );
}

function EmptyState() {
  const user = useAuthStore((s) => s.user);
  const displayName = user?.user_metadata?.display_name || user?.email?.split('@')[0] || '';
  const firstName = displayName.split(' ')[0];

  return (
    <div className="empty-state">
      {firstName && (
        <p className="empty-state-greeting">Hi {firstName},</p>
      )}
      <h1 className="empty-state-title">
        <RotatingText
          texts={[
            "What can I help you find?",
            "What teaching ideas can I help spark?",
            "What would you like to discover?",
            "How can I support your teaching today?",
            "What's worth exploring today?",
          ]}
          interval={4500}
        />
      </h1>

    </div>
  );
}
