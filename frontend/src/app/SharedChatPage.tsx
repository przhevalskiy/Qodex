import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Lock } from 'lucide-react';
import { useDiscussionStore } from '@/features/discussions';
import { ChatMessage } from '@/features/chat/components/chat/ChatMessage';
import { Discussion } from '@/shared/types';
import './SharedChatPage.css';

/**
 * Read-only view of a shared discussion.
 *
 * Invariants:
 * - Route is only reachable when the user is authenticated (App.tsx gates on user).
 * - Does NOT write to the discussion store's `discussions` list — shared threads
 *   must never appear in the viewer's sidebar.
 * - Input is hidden; no mutations are possible from this view.
 * - Returns 404-style error if the discussion is not found or not public.
 */
export function SharedChatPage() {
  const { discussionId } = useParams<{ discussionId: string }>();
  const navigate = useNavigate();
  const { loadSharedDiscussion } = useDiscussionStore();
  const [discussion, setDiscussion] = useState<Discussion | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!discussionId) {
      navigate('/chat', { replace: true });
      return;
    }

    setIsLoading(true);
    setError(null);

    loadSharedDiscussion(discussionId)
      .then((d) => {
        setDiscussion(d);
        setIsLoading(false);
      })
      .catch(() => {
        setError('This conversation is not available or has not been shared.');
        setIsLoading(false);
      });
  }, [discussionId, loadSharedDiscussion, navigate]);

  if (isLoading) {
    return (
      <div className="shared-page-state">
        <Loader2 size={28} className="shared-page-spinner" />
        <p>Loading conversation…</p>
      </div>
    );
  }

  if (error || !discussion) {
    return (
      <div className="shared-page-state">
        <Lock size={28} className="shared-page-lock" />
        <p className="shared-page-error">{error || 'Conversation not found.'}</p>
        <button className="shared-page-back" onClick={() => navigate('/chat')}>
          Go to my chats
        </button>
      </div>
    );
  }

  return (
    <div className="shared-page">
      <div className="shared-page-header">
        <h1 className="shared-page-title">{discussion.title}</h1>
        <span className="shared-page-badge">Read-only</span>
      </div>

      <div className="shared-page-messages">
        {discussion.messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            isStreaming={false}
          />
        ))}
      </div>
    </div>
  );
}
