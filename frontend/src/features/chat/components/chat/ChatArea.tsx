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
import { FileText, BookOpen, FlaskConical, Users, Video, Lightbulb, Microscope, BookMarked, GraduationCap, ArrowUpRight, X } from 'lucide-react';
import './ChatArea.css';

// Continuously pins scroll to the bottom during streaming using requestAnimationFrame.
// Returns a start/stop handle — call start() when streaming begins, stop() when done.
function useRafScroll(containerRef: React.RefObject<HTMLDivElement | null>) {
  const rafRef = useRef<number | null>(null);

  const start = useCallback(() => {
    const loop = () => {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      rafRef.current = requestAnimationFrame(loop);
    };
    if (!rafRef.current) rafRef.current = requestAnimationFrame(loop);
  }, [containerRef]);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  return { start, stop };
}

interface ChatAreaProps {
  initialMessage?: string;
}

export function ChatArea({ initialMessage }: ChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState('');
  const [hoverPrompt, setHoverPrompt] = useState('');
  const prevDiscussionIdRef = useRef<string | null>(null);
  const hasAutoSentRef = useRef(false);
  const { messages, isStreaming, currentStreamContent, currentStreamProvider, currentStreamSources, currentStreamSuggestedQuestions, currentStreamIntent, currentStreamIsContinuation, loadMessagesForDiscussion } =
    useChatStore();

  const { activeDiscussionId, discussions } = useDiscussionStore();
  const { fetchProviders } = useProviderStore();
  const { sendMessage } = useSSE();
  const { start: startRafScroll, stop: stopRafScroll } = useRafScroll(messagesContainerRef);

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

  // Start rAF scroll loop when streaming, stop and snap to bottom when done
  useEffect(() => {
    if (isStreaming) {
      startRafScroll();
    } else {
      stopRafScroll();
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
    return () => stopRafScroll();
  }, [isStreaming, startRafScroll, stopRafScroll]);

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
    sendMessage(prompt);
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
                placeholder={hoverPrompt || undefined}
              />
            </div>
          </div>
          <QuickActions onSelectAction={handleQuickAction} onHoverPrompt={setHoverPrompt} />
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

          <div className="chat-messages" ref={messagesContainerRef}>
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
  onHoverPrompt: (prompt: string) => void;
}

function QuickActions({ onSelectAction, onHoverPrompt }: QuickActionsProps) {
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeSubmenu = useCallback(() => {
    onHoverPrompt('');
    setIsClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setOpenActionId(null);
      setIsClosing(false);
    }, 140);
  }, [onHoverPrompt]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeSubmenu();
      }
    }
    if (openActionId) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openActionId, closeSubmenu]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const quickActions = [
    {
      id: 'case-studies',
      icon: FileText,
      label: 'Case studies',
      subPrompts: [
        'What case studies are available on leadership and decision-making?',
        'Find case studies that deal with organizational change',
        'Are there any case studies covering supply chain management?',
        'What case studies explore business ethics and corporate governance?',
        'Summarize the key lessons from the available case studies on strategy',
      ],
    },
    {
      id: 'course-readings',
      icon: BookOpen,
      label: 'Course readings',
      subPrompts: [
        'What readings cover sustainable business practices?',
        'Which materials introduce students to financial modeling?',
        'What foundational texts are available on organizational behavior?',
        'Find readings suitable for a first-year MBA module on strategy',
        'What readings cover the latest research in entrepreneurship?',
      ],
    },
    {
      id: 'simulations',
      icon: FlaskConical,
      label: 'Simulations',
      subPrompts: [
        'Are there any simulations or interactive exercises for negotiation?',
        'What simulations are available for teaching supply chain dynamics?',
        'Are there crisis management simulations in the library?',
        'What interactive exercises work well for teaching game theory?',
        'Are there any role-play simulations for leadership development?',
      ],
    },
    {
      id: 'faculty-expertise',
      icon: Users,
      label: 'Faculty expertise',
      subPrompts: [
        'Which faculty are teaching strategy and competitive advantage?',
        'Who has expertise in sustainable business and ESG?',
        'Which faculty specialize in entrepreneurship and innovation?',
        'Who are the leading researchers in organizational behavior?',
        'Which faculty cover digital transformation in their courses?',
      ],
    },
    {
      id: 'video-resources',
      icon: Video,
      label: 'Video resources',
      subPrompts: [
        'Are there any videos or multimedia resources about leadership?',
        'What video content covers financial markets and investing?',
        'Are there documentary-style videos on business case studies?',
        'What multimedia resources are available on design thinking?',
        'Are there recorded lectures or talks on entrepreneurship?',
      ],
    },
    {
      id: 'lesson-plans',
      icon: Lightbulb,
      label: 'Lesson plans',
      subPrompts: [
        'I need some ideas for a lesson plan on stakeholder theory',
        'Help me design a session on business ethics and decision-making',
        'What\'s a good structure for a lesson on corporate strategy?',
        'Give me ideas for a workshop on innovation and creativity',
        'How should I structure a class on negotiation skills?',
      ],
    },
    {
      id: 'research-methods',
      icon: Microscope,
      label: 'Research methods',
      subPrompts: [
        'How are other instructors teaching qualitative research methods?',
        'What approaches work best for teaching data analysis to MBAs?',
        'How do leading schools teach case-based learning?',
        'What are effective ways to teach literature review and synthesis?',
        'How are instructors incorporating AI tools into research methods courses?',
      ],
    },
    {
      id: 'best-practices',
      icon: BookMarked,
      label: 'Best practices',
      subPrompts: [
        'What are the best practices for teaching large MBA cohorts?',
        'How do top business schools structure case study discussions?',
        'What are proven methods for increasing student engagement?',
        'What are best practices for designing group projects and assessments?',
        'How do effective instructors give feedback on student work?',
      ],
    },
    {
      id: 'course-examples',
      icon: GraduationCap,
      label: 'Course examples',
      subPrompts: [
        'Show me example syllabi that cover corporate strategy',
        'What does a well-structured entrepreneurship course look like?',
        'Are there example course designs for a leadership module?',
        'Show me how other instructors structure a business ethics course',
        'What does a typical MBA operations management syllabus cover?',
      ],
    },
  ];

  const openAction = quickActions.find((a) => a.id === openActionId);

  return (
    <div className="quick-actions-container" ref={containerRef}>
      <div className="quick-actions">
        {quickActions.map((action) => (
          <button
            key={action.id}
            className={`quick-action-btn ${openActionId === action.id ? 'active' : ''}`}
            onClick={() => {
              if (openActionId === action.id) { closeSubmenu(); }
              else { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); setIsClosing(false); setOpenActionId(action.id); }
            }}
          >
            <action.icon size={16} />
            <span>{action.label}</span>
            <ArrowUpRight size={16} />
          </button>
        ))}
      </div>

      {openAction && (
        <div className={`quick-actions-submenu ${isClosing ? 'closing' : ''}`}>
          <div className="quick-actions-submenu-header">
            <span>{openAction.label}</span>
            <button className="quick-actions-submenu-close" onClick={closeSubmenu}>
              <X size={14} />
            </button>
          </div>
          <div className="quick-actions-submenu-items" onMouseLeave={() => onHoverPrompt('')}>
            {openAction.subPrompts.map((prompt, i) => (
              <button
                key={i}
                className="quick-actions-submenu-item"
                onMouseEnter={() => onHoverPrompt(prompt)}
                onClick={() => {
                  onSelectAction(prompt);
                  closeSubmenu();
                }}
              >
                <span>{prompt}</span>
                <ArrowUpRight size={14} className="quick-actions-submenu-arrow" />
              </button>
            ))}
          </div>
        </div>
      )}
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
