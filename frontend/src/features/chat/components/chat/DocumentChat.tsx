import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Bot, ArrowUpRight } from 'lucide-react';
import { useDocumentPreviewStore } from '@/features/documents';
import { useAuthStore } from '@/features/auth';
import { getAvatarIcon } from '@/shared/constants/avatarIcons';
import './DocumentChat.css';

interface DocumentChatProps {
  documentId: string;
  documentContent: string;
}

export function DocumentChat({ documentId, documentContent: _documentContent }: DocumentChatProps) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const AvatarIcon = getAvatarIcon(useAuthStore((s) => s.user?.user_metadata?.avatar_icon));

  const {
    documentChatMessages,
    documentChatContent,
    isDocumentChatStreaming,
    sendDocumentChatMessage,
  } = useDocumentPreviewStore();

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [documentChatMessages, documentChatContent]);

  const handleSend = async () => {
    if (!inputValue.trim() || isDocumentChatStreaming) return;

    const message = inputValue.trim();
    setInputValue('');

    await sendDocumentChatMessage(message, 'mistral');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="document-chat">
      <div className="document-chat-messages">
            {documentChatMessages.length === 0 && !isDocumentChatStreaming && (
              <div className="chat-welcome">
                <div className="welcome-suggestions">
                  <button
                    onClick={() => setInputValue("What is this document about?")}
                    className="suggestion-btn"
                  >
                    <span>What is this document about?</span>
                    <ArrowUpRight size={14} />
                  </button>
                  <button
                    onClick={() => setInputValue("Summarize the key points")}
                    className="suggestion-btn"
                  >
                    <span>Summarize the key points</span>
                    <ArrowUpRight size={14} />
                  </button>
                  <button
                    onClick={() => setInputValue("What are the main findings?")}
                    className="suggestion-btn"
                  >
                    <span>What are the main findings?</span>
                    <ArrowUpRight size={14} />
                  </button>
                  <button
                    onClick={() => setInputValue("Explain this in simpler terms")}
                    className="suggestion-btn"
                  >
                    <span>Explain this in simpler terms</span>
                    <ArrowUpRight size={14} />
                  </button>
                  <button
                    onClick={() => setInputValue("What questions could be asked about this?")}
                    className="suggestion-btn"
                  >
                    <span>What questions could be asked about this?</span>
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {documentChatMessages.map((message) => (
              <div
                key={message.id}
                className={`chat-message ${message.role}`}
              >
                <div className="message-avatar">
                  {message.role === 'user' ? (
                    <AvatarIcon size={16} />
                  ) : (
                    <Bot size={16} />
                  )}
                </div>
                <div className="message-content">
                  <div className={`message-text ${message.role === 'assistant' ? 'markdown-body' : ''}`}>
                    {message.role === 'assistant' ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                    ) : (
                      message.content
                    )}
                  </div>
                  <div className="message-time">
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}

            {isDocumentChatStreaming && (
              <div className="chat-message assistant streaming">
                <div className="message-avatar">
                  <Bot size={16} />
                </div>
                <div className="message-content">
                  <div className="message-text markdown-body streaming">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{documentChatContent}</ReactMarkdown>
                    <span className="streaming-cursor">|</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
      </div>

      <div className="document-chat-input">
        <div className="input-container">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask a question about this document..."
            className="chat-input"
            rows={1}
            disabled={isDocumentChatStreaming}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isDocumentChatStreaming}
            className="send-button"
            title="Send message"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
