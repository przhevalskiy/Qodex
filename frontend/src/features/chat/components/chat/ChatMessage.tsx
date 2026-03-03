import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import 'flowtoken/dist/styles.css';
import { Copy, Check, Download, Loader2, RotateCcw } from 'lucide-react';
import ExportDropdown from '../ui/ExportDropdown';
import { getAvatarIcon } from '@/shared/constants/avatarIcons';
import { Message, DocumentSource } from '@/shared/types';
import { useState, useMemo, memo } from 'react';
import { useAuthStore } from '@/features/auth';
import { SourcesDisplay } from '../sources/SourcesDisplay';
import { SuggestedQuestions } from '../ui/SuggestedQuestions';
import { InlineCitation } from '../input/InlineCitation';
import { remarkCitations } from '@/shared/utils/remarkCitations';
import './ChatMessage.css';

// Common emojis used as list markers
const listEmojis = [
  '✅', '❌', '✓', '✗', '•', '◦', '▪', '▫', '►', '▸',
  '🔥', '⚡', '🌿', '💡', '🎯', '🚀', '⭐', '🔴', '🟢', '🔵',
  '🟡', '🟠', '🟣', '⚪', '⚫', '📌', '📍', '🔸', '🔹', '🔶',
  '🔷', '💎', '🏆', '🎉', '🎊', '✨', '💫', '🌟', '⚠️', '❗',
  '❓', '❕', '❔', '➡️', '➜', '→', '⇒', '▶️', '☑️', '☐',
  '☒', '🔘', '🔲', '🔳', '⬛', '⬜', '🟥', '🟧', '🟨', '🟩',
  '🟦', '🟪', '⏩', '⏭️', '👉', '👆', '👇', '☀️', '🌙', '💰',
  '📊', '📈', '📉', '🔑', '🔒', '🔓', '💪', '🤝', '👍', '👎'
];

// Pre-compile regex patterns once at module load (not per render)
const emojiPattern = listEmojis.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const emojiMatchRegex = new RegExp(`(${emojiPattern})\\s+[^${emojiPattern}]+`, 'g');
const emojiSplitRegex = new RegExp(`(?=${emojiPattern}\\s)`, 'g');
const listItemRegex = /^[-*+]\s/;
const numberedListRegex = /^\d+\.\s/;
const emojiListLineRegex = /^- [^\s]/;

// Create a Set for O(1) emoji lookup instead of O(n) array iteration
const emojiSet = new Set(listEmojis);

function startsWithEmoji(text: string): boolean {
  // Check first few characters (emojis can be 1-4 chars)
  for (let i = 1; i <= 4 && i <= text.length; i++) {
    if (emojiSet.has(text.slice(0, i))) return true;
  }
  return false;
}

/**
 * Parse citation markers [N] and replace with citation components
 */
function processCitations(text: string, sources?: DocumentSource[]): React.ReactNode[] {
  if (!text) return [text];

  // Regex to match [N] where N is one or more digits
  const citationRegex = /\[(\d+)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = citationRegex.exec(text)) !== null) {
    // Add text before citation
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    // Add citation component
    const citationNumber = parseInt(match[1], 10);
    const source = sources?.find(s => s.citation_number === citationNumber);

    parts.push(
      <InlineCitation
        key={`cite-${match.index}-${citationNumber}`}
        number={citationNumber}
        source={source}
      />
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

function processEmojiLists(content: string): string {
  const lines = content.split('\n');
  const processedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Reset regex lastIndex for global regex reuse
    emojiMatchRegex.lastIndex = 0;
    const emojiMatches = line.match(emojiMatchRegex);

    if (emojiMatches && emojiMatches.length > 1) {
      const items = line.split(emojiSplitRegex).filter(Boolean);
      items.forEach(item => {
        const trimmed = item.trim();
        if (trimmed) {
          if (startsWithEmoji(trimmed)) {
            processedLines.push(`- ${trimmed}`);
          } else {
            processedLines.push(trimmed);
          }
        }
      });
    } else {
      const trimmedLine = line.trim();
      const hasEmoji = startsWithEmoji(trimmedLine);
      const isAlreadyListItem = listItemRegex.test(trimmedLine) || numberedListRegex.test(trimmedLine);

      if (hasEmoji && !isAlreadyListItem && trimmedLine.length > 2) {
        const prevLine = processedLines[processedLines.length - 1];
        const prevIsEmojiList = prevLine && emojiListLineRegex.test(prevLine);

        if (prevIsEmojiList || (i > 0 && startsWithEmoji(lines[i-1].trim()))) {
          processedLines.push(`- ${trimmedLine}`);
        } else {
          processedLines.push(line);
        }
      } else {
        processedLines.push(line);
      }
    }
  }

  return processedLines.join('\n');
}

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  onRetry?: (content: string) => void;
  onQuestionClick?: (question: string) => void;
}

const intentLabels: Record<string, string> = {
  generalist: 'Generalist',
  summarize: 'Summary',
  explain: 'Explainer',
  compare: 'Comparison',
  case_study: 'Case Study',
  generate_questions: 'Assessment',
  critique: 'Critique',
  methodology: 'Methodology',
  lesson_plan: 'Lesson Plan',
};

const intentDescriptions: Record<string, string> = {
  generalist: 'Grounded in retrieved sources with inline citations. Adapts structure and depth to the complexity of the question.',
  summarize: 'Extracts key findings, methodology, and implications directly from retrieved sources. Minimal inference.',
  explain: 'Simplifies retrieved content using definitions and analogies. May elaborate beyond direct source text to aid understanding — treat as a guided interpretation, not a verbatim quote.',
  compare: 'Analyzes retrieved sources across defined dimensions. Evidence-backed synthesis with balanced presentation of each side.',
  case_study: 'Frames retrieved content as a structured case study. All claims grounded in sources; any inferences are flagged explicitly.',
  generate_questions: 'Creates assessment questions directly from retrieved source content across Bloom\'s Taxonomy levels.',
  critique: 'Balanced critical analysis of retrieved content — strengths, gaps, methodological concerns, and alternative perspectives.',
  methodology: 'Reviews research design, data sources, and analytical approach from retrieved materials. Distinguishes retrieved facts from interpretation.',
  lesson_plan: 'Designs teaching resources synthesised from retrieved syllabi content. Targets graduate-level audience unless otherwise specified.',
};

const allIntents = [
  { key: 'generalist', label: 'Generalist', desc: 'Cited answers, adaptive depth' },
  { key: 'summarize', label: 'Summary', desc: 'Key findings, minimal inference' },
  { key: 'explain', label: 'Explainer', desc: 'Simplified — may elaborate beyond sources' },
  { key: 'compare', label: 'Comparison', desc: 'Evidence-based, side-by-side' },
  { key: 'case_study', label: 'Case Study', desc: 'Source-grounded, flags inferences' },
  { key: 'generate_questions', label: 'Assessment', desc: 'Quiz & exam from source content' },
  { key: 'critique', label: 'Critique', desc: 'Strengths & gaps analysis' },
  { key: 'methodology', label: 'Methodology', desc: 'Research design from sources' },
  { key: 'lesson_plan', label: 'Lesson Plan', desc: 'Teaching resources from syllabi' },
];


// Pre-define markdown components outside component to avoid recreation
const markdownComponents = {
  code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
    const isInline = !className;
    if (isInline) {
      return <code className="inline-code" {...props}>{children}</code>;
    }
    return (
      <pre className="code-block">
        <code {...props}>{children}</code>
      </pre>
    );
  },
  p({ children }: { children?: React.ReactNode }) {
    return <p>{children}</p>;
  },
  ul({ children }: { children?: React.ReactNode }) {
    return <ul>{children}</ul>;
  },
  ol({ children }: { children?: React.ReactNode }) {
    return <ol>{children}</ol>;
  },
  li({ children }: { children?: React.ReactNode }) {
    return <li>{children}</li>;
  },
  a({ href, children }: { href?: string; children?: React.ReactNode }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  table({ children }: { children?: React.ReactNode }) {
    return <table className="markdown-table">{children}</table>;
  },
  thead({ children }: { children?: React.ReactNode }) {
    return <thead>{children}</thead>;
  },
  tbody({ children }: { children?: React.ReactNode }) {
    return <tbody>{children}</tbody>;
  },
  tr({ children }: { children?: React.ReactNode }) {
    return <tr>{children}</tr>;
  },
  th({ children }: { children?: React.ReactNode }) {
    return <th>{children}</th>;
  },
  td({ children }: { children?: React.ReactNode }) {
    return <td>{children}</td>;
  },
  hr() {
    return <hr />;
  },
  h1({ children }: { children?: React.ReactNode }) {
    return <h1>{children}</h1>;
  },
  h2({ children }: { children?: React.ReactNode }) {
    return <h2>{children}</h2>;
  },
  h3({ children }: { children?: React.ReactNode }) {
    return <h3>{children}</h3>;
  },
  h4({ children }: { children?: React.ReactNode }) {
    return <h4>{children}</h4>;
  },
  // Custom citation component handler
  citation({ number }: { number: number }) {
    // This will be replaced dynamically with sources
    return <span data-citation={number}>[{number}]</span>;
  },
};

const remarkPlugins = [remarkGfm, remarkCitations];

export const ChatMessage = memo(function ChatMessage({ message, isStreaming, onRetry, onQuestionClick }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const displayName = useAuthStore((s) => s.user?.user_metadata?.display_name) || useAuthStore((s) => s.user?.email?.split('@')[0]) || 'You';
  const AvatarIcon = getAvatarIcon(useAuthStore((s) => s.user?.user_metadata?.avatar_icon));
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // Skip expensive emoji processing during streaming — AnimatedMarkdown uses raw content
  const processedContent = useMemo(
    () => isStreaming ? '' : processEmojiLists(message.content),
    [message.content, isStreaming]
  );

  // Create custom markdown components with citation support
  const markdownComponentsWithCitations = useMemo(() => {
    if (!message.sources || message.sources.length === 0) {
      return markdownComponents;
    }

    // Return components with custom citation handler
    return {
      ...markdownComponents,
      citation({ number }: { number: number }) {
        const source = message.sources?.find(s => s.citation_number === number);
        return (
          <InlineCitation
            number={number}
            source={source}
          />
        );
      },
    };
  }, [message.sources]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };


  const handleRetry = async () => {
    if (retrying || !onRetry) return;
    setRetrying(true);
    try {
      await onRetry(message.content);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className={`chat-message ${isUser ? 'user' : 'assistant'}`}>
      <div className={`message-avatar ${isUser ? 'user' : 'assistant'}`}>
        {isUser ? <AvatarIcon size={16} /> : <img src="/qodex-logo.png" alt="Qodex" className="assistant-logo" />}
      </div>

      <div className="message-content">
        <div className="message-header">
          <span className="message-author">{isUser ? displayName : 'Qodex'}</span>
          {!isUser && message.intent && (
            <span className="intent-chip-wrapper">
              <span className={`message-intent ${message.intent}`}>
                {intentLabels[message.intent] || message.intent}
              </span>
              <div className="intent-tooltip">
                <div className="intent-tooltip-header">
                  <span className={`intent-tooltip-active ${message.intent}`}>
                    {intentLabels[message.intent] || message.intent}
                  </span>
                  <span className="intent-tooltip-desc">
                    {intentDescriptions[message.intent] || ''}
                  </span>
                </div>
                <div className="intent-tooltip-divider" />
                <div className="intent-tooltip-label">All response modes</div>
                <div className="intent-tooltip-list">
                  {allIntents.map((item) => (
                    <div
                      key={item.key}
                      className={`intent-tooltip-item ${item.key === message.intent ? 'active' : ''}`}
                    >
                      <span className={`intent-tooltip-dot ${item.key}`} />
                      <span className="intent-tooltip-item-label">{item.label}</span>
                      <span className="intent-tooltip-item-desc">{item.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </span>
          )}
          {message.response_time_ms && (
            <span className="message-time">
              {(message.response_time_ms / 1000).toFixed(1)}s
            </span>
          )}
          {!isStreaming && (
            <>
              {!isUser && onRetry && (
                <button className="message-retry" onClick={handleRetry} title="Retry question" disabled={retrying}>
                  {retrying ? <Loader2 size={14} className="spinning" /> : <RotateCcw size={14} />}
                </button>
              )}
              <ExportDropdown
                mode="message"
                content={message.content}
                provider={message.provider}
                timestamp={message.timestamp}
              >
                {(_open, toggle) => (
                  <button className="message-export" onClick={toggle} title="Download message">
                    <Download size={14} />
                  </button>
                )}
              </ExportDropdown>
              <button className="message-copy" onClick={handleCopy} title="Copy message">
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </>
          )}
        </div>

        <div className={`message-body ${isStreaming ? 'streaming' : ''}`}>
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            components={markdownComponentsWithCitations}
          >
            {isStreaming ? message.content : processedContent}
          </ReactMarkdown>

          {/* Show source documents for assistant messages */}
          {!isUser && message.sources && message.sources.length > 0 && (
            <SourcesDisplay sources={message.sources} />
          )}

          {/* Show suggested questions for assistant messages */}
          {!isUser && message.suggested_questions && message.suggested_questions.length > 0 && onQuestionClick && (
            <SuggestedQuestions
              questions={message.suggested_questions}
              onQuestionClick={onQuestionClick}
              isLoading={isStreaming}
            />
          )}
        </div>
      </div>
    </div>
  );
});
