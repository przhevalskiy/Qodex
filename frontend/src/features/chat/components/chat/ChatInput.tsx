import { useState, useRef, useEffect, FormEvent, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Square } from 'lucide-react';
import { useSSE } from '@/shared/hooks/useSSE';
import { useChatStore } from '@/features/chat';
import { useDiscussionStore } from '@/features/discussions';
import { ProviderToggles } from '@/features/providers';
import { InputActionsDropdown } from '../input/InputActionsDropdown';
import { VoiceInput } from '../ui/VoiceInput';
import './ChatInput.css';

interface ChatInputProps {
  initialValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
}

export function ChatInput({ initialValue = '', onValueChange, placeholder }: ChatInputProps) {
  const hoverPlaceholder = useChatStore((s) => s.hoverPlaceholder);
  const navigate = useNavigate();
  const [input, setInput] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage, stopStream, isStreaming } = useSSE();
  const { activeDiscussionId, createDiscussion } = useDiscussionStore();
  const { skipNextMessageLoad } = useChatStore();

  useEffect(() => {
    if (initialValue !== input) {
      setInput(initialValue);
    }
  }, [initialValue]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }
  }, [input]);

  const handleInputChange = (value: string) => {
    setInput(value);
    onValueChange?.(value);
  };

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();

    const message = input.trim();
    if (!message || isStreaming) return;

    let discussionId = activeDiscussionId;
    if (!discussionId) {
      const newDiscussion = await createDiscussion();
      discussionId = newDiscussion.id;
      // Prevent ChatArea from overwriting messages for this fresh discussion
      skipNextMessageLoad();
      navigate(`/chat/${discussionId}`);
    }

    setInput('');
    onValueChange?.('');

    try {
      await sendMessage(message, undefined, discussionId);
    } catch (error) {
      console.error('Failed to send message:', error);
      const errorMessage = (error as Error).message || '';
      // If discussion not found (404), likely server restarted - auto-recover by creating new discussion
      if (errorMessage.includes('not found') || errorMessage.includes('404')) {
        try {
          // Create a fresh discussion and retry automatically
          const newDiscussion = await createDiscussion();
          navigate(`/chat/${newDiscussion.id}`);
          await sendMessage(message, undefined, newDiscussion.id);
        } catch (retryError) {
          console.error('Failed to recover:', retryError);
          // Restore the message so user doesn't lose it
          setInput(message);
          onValueChange?.(message);
        }
      } else {
        // For other errors, restore the message
        setInput(message);
        onValueChange?.(message);
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="chat-input">
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <div className="chat-input-box">
          <InputActionsDropdown />

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hoverPlaceholder || placeholder || "Ask anything..."}
            disabled={isStreaming}
            rows={1}
            className="chat-textarea"
          />

          <ProviderToggles />

          <VoiceInput
            onTranscript={(text) => {
              setInput(prev => {
                const newValue = prev ? `${prev} ${text}` : text;
                onValueChange?.(newValue);
                return newValue;
              });
            }}
            disabled={isStreaming}
          />

          {isStreaming ? (
            <button
              type="button"
              className="send-btn stop"
              onClick={stopStream}
              title="Stop generating"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              type="submit"
              className="send-btn"
              disabled={!input.trim()}
              title="Send message"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </form>

      <p className="chat-input-hint">
        Press <kbd>Enter</kbd> to send, <kbd>Shift+Enter</kbd> for new line
      </p>
    </div>
  );
}
