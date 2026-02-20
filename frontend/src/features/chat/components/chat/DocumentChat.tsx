import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, ArrowUpRight } from 'lucide-react';
import { useDocumentPreviewStore } from '@/features/documents';
import { useAuthStore } from '@/features/auth';
import { getAvatarIcon } from '@/shared/constants/avatarIcons';
import { remarkCitations } from '@/shared/utils/remarkCitations';
import { exportDocumentToPDF } from '@/shared/services/pdfExport';
import './DocumentChat.css';

interface DocumentChatProps {
  documentId: string;
  documentContent: string;
}

export function DocumentChat({ documentId, documentContent: _documentContent }: DocumentChatProps) {
  const [inputValue, setInputValue] = useState('');
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const AvatarIcon = getAvatarIcon(useAuthStore((s) => s.user?.user_metadata?.avatar_icon));
  const displayName = useAuthStore((s) => s.user?.user_metadata?.display_name) || useAuthStore((s) => s.user?.email?.split('@')[0]) || 'You';

  const {
    documentChatMessages,
    documentChatContent,
    isDocumentChatStreaming,
    sendDocumentChatMessage,
    previewDocument,
    documentContent,
    isLoading,
    isFormatting,
  } = useDocumentPreviewStore();

  const isBusy = isLoading || isFormatting;

  const handleCitationClick = async () => {
    if (!previewDocument || !documentContent || pdfDownloading) return;
    setPdfDownloading(true);
    try {
      await exportDocumentToPDF({
        filename: previewDocument.filename,
        fullContent: documentContent.full_content || '',
        chunks: documentContent.chunks || [],
      });
    } catch (err) {
      console.error('Failed to download PDF:', err);
    } finally {
      setPdfDownloading(false);
    }
  };

  const docChatComponents: any = {
    citation({ number }: { number: number }) {
      return (
        <span className="inline-citation-wrapper">
          <sup
            className="inline-citation interactive"
            onClick={handleCitationClick}
            title="Download document as PDF"
          >
            [{number}]
          </sup>
        </span>
      );
    },
  };

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

  const handleSuggestionClick = async (question: string) => {
    if (isDocumentChatStreaming) return;
    await sendDocumentChatMessage(question, 'mistral');
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
                {isBusy ? (
                  <div className="welcome-suggestions">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="suggestion-btn-skeleton" />
                    ))}
                  </div>
                ) : (
                  <div className="welcome-suggestions">
                    <button onClick={() => handleSuggestionClick("What is this document about?")} className="suggestion-btn">
                      <span>What is this document about?</span>
                      <ArrowUpRight size={14} />
                    </button>
                    <button onClick={() => handleSuggestionClick("Summarize the key points")} className="suggestion-btn">
                      <span>Summarize the key points</span>
                      <ArrowUpRight size={14} />
                    </button>
                    <button onClick={() => handleSuggestionClick("What are the main findings?")} className="suggestion-btn">
                      <span>What are the main findings?</span>
                      <ArrowUpRight size={14} />
                    </button>
                    <button onClick={() => handleSuggestionClick("Explain this in simpler terms")} className="suggestion-btn">
                      <span>Explain this in simpler terms</span>
                      <ArrowUpRight size={14} />
                    </button>
                    <button onClick={() => handleSuggestionClick("What questions could be asked about this?")} className="suggestion-btn">
                      <span>What questions could be asked about this?</span>
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {documentChatMessages.map((message) => (
              <div
                key={message.id}
                className={`chat-message ${message.role}`}
              >
                <div className={`message-avatar ${message.role}`}>
                  {message.role === 'user' ? (
                    <AvatarIcon size={16} />
                  ) : (
                    <img src="/qodex-logo.png" alt="Qodex" className="assistant-logo" />
                  )}
                </div>
                <div className="message-content">
                  <div className="message-header">
                    <span className="message-author">{message.role === 'user' ? displayName : 'Qodex'}</span>
                  </div>
                  <div className={`message-text ${message.role === 'assistant' ? 'markdown-body' : ''}`}>
                    {message.role === 'assistant' ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCitations]} components={docChatComponents}>{message.content}</ReactMarkdown>
                    ) : (
                      message.content
                    )}
                  </div>
                </div>
              </div>
            ))}

            {isDocumentChatStreaming && (
              <div className="chat-message assistant streaming">
                <div className="message-avatar assistant">
                  <img src="/qodex-logo.png" alt="Qodex" className="assistant-logo" />
                </div>
                <div className="message-content">
                  <div className="message-header">
                    <span className="message-author">Qodex</span>
                  </div>
                  <div className="message-text markdown-body streaming">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkCitations]} components={docChatComponents}>{documentChatContent}</ReactMarkdown>
                    <span className="streaming-cursor">|</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
      </div>

      <div className="document-chat-input">
        {isBusy ? (
          <div className="chat-input-skeleton" />
        ) : (
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
        )}
      </div>
    </div>
  );
}
