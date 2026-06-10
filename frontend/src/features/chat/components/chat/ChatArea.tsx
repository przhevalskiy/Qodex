import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ArrowUpRight, X, FileText, Calendar, Newspaper, Share2, Lightbulb, MessageCircle, Globe } from 'lucide-react';
import { useChatStore } from '../../store';
import { useDiscussionStore } from '@/features/discussions';
import { useAuthStore } from '@/features/auth';
import { useSSE } from '@/shared/hooks/useSSE';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatHeader } from './ChatHeader';
import { RotatingText } from '../ui/RotatingText';
import { ThinkingIndicator } from '../ui/ThinkingIndicator';
import { ChibiAvatars } from '../ui/ChibiAvatars';
import './ChatArea.css';

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

  const { messages, isStreaming, isSubmitted, currentStreamContent, currentStreamIntent, loadMessagesForDiscussion } = useChatStore();
  const { activeDiscussionId, discussions } = useDiscussionStore();
  const { sendMessage } = useSSE();
  const { start: startRafScroll, stop: stopRafScroll } = useRafScroll(messagesContainerRef);

  const currentDiscussion = discussions.find(d => d.id === activeDiscussionId);

  const handleRetry = useCallback(
    (messageId: string) => {
      const messageIndex = messages.findIndex((m) => m.id === messageId);
      if (messageIndex <= 0) return;
      for (let i = messageIndex - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          sendMessage(messages[i].content);
          break;
        }
      }
    },
    [messages, sendMessage]
  );

  const handleQuestionClick = useCallback(
    (question: string) => sendMessage(question),
    [sendMessage]
  );

  useEffect(() => {
    if (prevDiscussionIdRef.current !== activeDiscussionId) {
      loadMessagesForDiscussion(activeDiscussionId);
      prevDiscussionIdRef.current = activeDiscussionId;
    }
  }, [activeDiscussionId, loadMessagesForDiscussion]);

  useEffect(() => {
    document.title = currentDiscussion?.title || 'Cowork';
  }, [currentDiscussion]);

  useEffect(() => {
    if (isStreaming) {
      startRafScroll();
    } else {
      stopRafScroll();
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
    return () => stopRafScroll();
  }, [isStreaming, startRafScroll, stopRafScroll]);

  useEffect(() => {
    if (initialMessage) hasAutoSentRef.current = false;
  }, [initialMessage]);

  useEffect(() => {
    if (initialMessage && !hasAutoSentRef.current && !isStreaming && messages.length === 0) {
      hasAutoSentRef.current = true;
      sendMessage(initialMessage);
    }
  }, [initialMessage, isStreaming, messages.length, sendMessage]);

  const streamingMessage = useMemo(() => {
    if (!isStreaming || !currentStreamContent) return null;
    return {
      id: 'streaming',
      content: currentStreamContent,
      role: 'assistant' as const,
      timestamp: '',
      intent: currentStreamIntent?.intent || undefined,
    };
  }, [isStreaming, currentStreamContent, currentStreamIntent]);

  const isEmpty = messages.length === 0 && !isStreaming;

  return (
    <div className={`chat-area ${isEmpty ? 'empty' : ''}`}>
      {isEmpty ? (
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
          <QuickActions onSelectAction={sendMessage} onHoverPrompt={setHoverPrompt} />
        </>
      ) : (
        <>
          {activeDiscussionId && currentDiscussion && (
            <ChatHeader
              discussionId={activeDiscussionId}
              discussionTitle={currentDiscussion.title}
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
                  onSend={sendMessage}
                />
              ))}

              {isStreaming && !currentStreamContent && (
                <ThinkingIndicator />
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

          {isSubmitted && (
            <div className="chat-input-container" style={{ paddingBottom: 0 }}>
              <div className="chat-input-wrapper">
                <div className="submit-success-banner">
                  <span className="submit-success-icon">✓</span>
                  <span>Your request has been submitted to the marketing team.</span>
                </div>
              </div>
            </div>
          )}

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
    if (openActionId) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openActionId, closeSubmenu]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const quickActions = [
    {
      id: 'press-release',
      icon: FileText,
      label: 'Press release',
      subPrompts: [
        'I need help with a press release for our upcoming product launch',
        'We have a major partnership announcement and need a press release',
        'Draft a press release for an executive appointment or leadership change',
        'We need a press release for a funding or investment announcement',
        'Help me write a press release for a new initiative or program launch',
      ],
    },
    {
      id: 'events',
      icon: Calendar,
      label: 'Events',
      subPrompts: [
        'We have a conference coming up and need full communications support',
        'Help me write event invitation copy and email outreach',
        'We\'re hosting a webinar and need talking points and social copy',
        'I need a post-event recap and media summary',
        'Help me plan communications for a panel discussion or speaker series',
      ],
    },
    {
      id: 'media-pr',
      icon: Newspaper,
      label: 'Media & PR',
      subPrompts: [
        'Can you help me put together a PR pitch for a journalist?',
        'I need a media kit for an upcoming announcement',
        'Help me draft a spokesperson bio and boilerplate for a press kit',
        'We need talking points to prepare an executive for media interviews',
        'I need a Q&A document for handling press inquiries',
      ],
    },
    {
      id: 'social-media',
      icon: Share2,
      label: 'Social media',
      subPrompts: [
        'I need social media copy for a campaign or initiative',
        'Help me write a LinkedIn post announcing a new partnership',
        'I need social media posts for LinkedIn and Instagram for an upcoming event',
        'We need social content to promote a research report or publication',
        'Create an Instagram caption and copy for a brand moment',
      ],
    },
    {
      id: 'thought-leadership',
      icon: Lightbulb,
      label: 'Thought leadership',
      subPrompts: [
        'I need help drafting an op-ed or thought leadership piece',
        'Help me outline a byline article for a trade publication',
        'I want to develop a speech or keynote remarks for an executive',
        'Draft a LinkedIn article on a topic relevant to our organization',
        'Help me create a white paper or research brief for external audiences',
      ],
    },
    {
      id: 'web-services',
      icon: Globe,
      label: 'Web services',
      subPrompts: [
        'We need a new webpage or site section built out for a program or initiative',
        'I have a feature request for our website — new functionality or UI change',
        'We need a web analytics report on traffic, engagement, or campaign performance',
        'I want an SEO audit and optimization consultation for our website',
        'Help me write a brief for a website redesign or content refresh',
      ],
    },
    {
      id: 'general',
      icon: MessageCircle,
      label: 'General request',
      subPrompts: [
        'I have a general communications request for the marketing team',
        'We need help with internal communications for a company-wide announcement',
        'Help me put together a briefing document for a stakeholder meeting',
        'I need talking points for a presentation or town hall',
        'Draft a newsletter update for our community or alumni network',
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
                onClick={() => { onSelectAction(prompt); closeSubmenu(); }}
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
      <ChibiAvatars />
      {firstName && (
        <p className="empty-state-greeting">Hi {firstName},</p>
      )}
      <h1 className="empty-state-title">
        <RotatingText
          texts={[
            "What can I help you submit today?",
            "Ready to take your next intake request?",
            "What communications project can I help with?",
            "How can I support your marketing team today?",
          ]}
          interval={4500}
        />
      </h1>
    </div>
  );
}
