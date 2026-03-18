import { useState } from 'react';
import { Modal } from '@/components/ui';
import { Copy, Check, Link, Loader2 } from 'lucide-react';
import { useDiscussionStore } from '@/features/discussions';
import './ShareModal.css';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  discussionId: string;
  discussionTitle: string;
  isPublic: boolean;  // current is_public state — avoids re-sharing an already-public discussion
}

export function ShareModal({ isOpen, onClose, discussionId, discussionTitle, isPublic }: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shared, setShared] = useState(isPublic);
  const { shareDiscussion } = useDiscussionStore();

  // /share/ route is the cross-user readable URL; /chat/ is owner-only deep link
  const shareUrl = `${window.location.origin}/share/${discussionId}`;

  const handleCopy = async () => {
    try {
      // If not yet public, mark as public before writing link to clipboard.
      // Invariant: copy button is the activation gate — link is useless until is_public=true.
      if (!shared) {
        setIsSharing(true);
        await shareDiscussion(discussionId);
        setShared(true);
        setIsSharing(false);
      }
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      setIsSharing(false);
      console.error('Failed to share or copy:', error);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share Conversation" size="md">
      <div className="share-modal-content">
        <div className="share-modal-info">
          <Link size={20} className="share-modal-icon" />
          <div className="share-modal-text">
            <h3 className="share-modal-title">{discussionTitle || 'Untitled Conversation'}</h3>
            <p className="share-modal-description">
              {shared
                ? 'Anyone logged in with this link can view this conversation'
                : 'Copying will activate the link — anyone logged in can then view it'}
            </p>
          </div>
        </div>

        <div className="share-modal-url">
          <div className="share-url-container">
            <input
              type="text"
              value={shareUrl}
              readOnly
              className="share-url-input"
              onClick={(e) => e.currentTarget.select()}
            />
          </div>
          <button
            onClick={handleCopy}
            className="share-copy-btn"
            disabled={isSharing}
            title={copied ? 'Copied!' : 'Copy link'}
          >
            {isSharing ? (
              <Loader2 size={16} className="spin" />
            ) : copied ? (
              <Check size={16} />
            ) : (
              <Copy size={16} />
            )}
            <span>{isSharing ? 'Sharing…' : copied ? 'Copied!' : 'Copy'}</span>
          </button>
        </div>

        <div className="share-modal-footer">
          <p className="share-modal-note">
            {shared
              ? 'This link is active. Recipients must be logged in to view.'
              : 'The link activates the first time you copy it.'}
          </p>
        </div>
      </div>
    </Modal>
  );
}
