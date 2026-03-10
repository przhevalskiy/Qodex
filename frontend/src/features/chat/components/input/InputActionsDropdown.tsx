import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgePlus, Paperclip, X, FileText, ImageIcon, Upload, Check } from 'lucide-react';
import { useAttachmentStore } from '@/features/attachments/store';
import { useDiscussionStore } from '@/features/discussions';
import { useResearchModeStore, RESEARCH_MODE_UI } from '@/features/research';
import { ResearchMode } from '@/shared/types';
import './InputActionsDropdown.css';

const ALLOWED_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.md', '.docx', '.jpg', '.jpeg', '.png', '.webp'];

export function InputActionsDropdown() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { activeDiscussionId, createDiscussion } = useDiscussionStore();

  const {
    attachments,
    isUploading,
    uploadProgress,
    uploadAttachment,
    deleteAttachment,
  } = useAttachmentStore();

  const { activeMode, setActiveMode, modes } = useResearchModeStore();

  const validateFile = (file: File): boolean => {
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_TYPES.includes(file.type) && !ALLOWED_EXTENSIONS.includes(extension)) {
      setError(`Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File too large. Maximum size is 10MB');
      return false;
    }
    return true;
  };

  /** Ensure a discussion exists, auto-creating + navigating if needed. */
  const ensureDiscussion = async (): Promise<string> => {
    if (activeDiscussionId) return activeDiscussionId;
    const newDiscussion = await createDiscussion();
    navigate(`/chat/${newDiscussion.id}`);
    return newDiscussion.id;
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setError(null);
    const file = files[0];

    if (!validateFile(file)) return;

    try {
      const discussionId = await ensureDiscussion();
      await uploadAttachment(discussionId, file);
      setShowAttachments(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleAttachFiles = () => {
    if (attachments.length > 0) {
      setShowAttachments(true);
      setIsOpen(false);
    } else {
      fileInputRef.current?.click();
      setIsOpen(false);
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!activeDiscussionId) return;
    try {
      await deleteAttachment(activeDiscussionId, attachmentId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleModeSelect = (mode: ResearchMode) => {
    setActiveMode(mode);
    setIsOpen(false);
  };

  return (
    <div className="input-actions">
      {/* Main trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="input-actions-trigger"
        title="Actions"
      >
        <BadgePlus size={20} />
        {attachments.length > 0 && (
          <span className="input-actions-badge">{attachments.length}</span>
        )}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_EXTENSIONS.join(',')}
        onChange={(e) => handleFileSelect(e.target.files)}
        style={{ display: 'none' }}
      />

      {/* Dropdown menu */}
      {isOpen && (
        <>
          <div className="input-actions-backdrop" onClick={() => setIsOpen(false)} />
          <div className="input-actions-dropdown">
            {/* File attachment option */}
            <button
              type="button"
              className="input-actions-item"
              onClick={handleAttachFiles}
            >
              <Paperclip size={18} />
              <div className="input-actions-item-content">
                <span className="input-actions-item-label">Attach files</span>
                <span className="input-actions-item-desc">Add context to this conversation</span>
              </div>
              {attachments.length > 0 && (
                <span className="input-actions-item-count">{attachments.length}</span>
              )}
            </button>

            <div className="input-actions-divider" />

            {/* Research mode section */}
            <div className="input-actions-section-label">Research Depth</div>

            {modes.map((mode) => {
              const config = RESEARCH_MODE_UI[mode.mode];
              const Icon = config.icon;
              const isActive = mode.mode === activeMode;

              return (
                <button
                  key={mode.mode}
                  type="button"
                  className={`input-actions-item input-actions-research-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleModeSelect(mode.mode)}
                >
                  <Icon size={18} />
                  <div className="input-actions-item-content">
                    <span className="input-actions-item-label">{config.label}</span>
                    <span className="input-actions-item-desc">{config.description}</span>
                  </div>
                  {isActive && <Check size={16} className="input-actions-check" />}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Attachments panel */}
      {showAttachments && attachments.length > 0 && (
        <>
          <div className="input-actions-backdrop" onClick={() => setShowAttachments(false)} />
          <div className="input-actions-documents">
            <div className="input-actions-documents-header">
              <span>Conversation Attachments</span>
              <button onClick={() => setShowAttachments(false)} type="button">
                <X size={16} />
              </button>
            </div>

            <div className="input-actions-documents-list">
              {attachments.map((att) => (
                <div key={att.id} className="input-actions-doc-item selected">
                  {att.is_image ? <ImageIcon size={16} /> : <FileText size={16} />}
                  <span className="input-actions-doc-name">{att.filename}</span>
                  <button onClick={() => handleDeleteAttachment(att.id)} type="button">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`input-actions-dropzone ${isDragging ? 'dragging' : ''}`}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={18} />
              <span>Drop file or click to attach</span>
            </div>
          </div>
        </>
      )}

      {/* Upload Progress */}
      {isUploading && uploadProgress > 0 && (
        <div className="input-actions-progress">
          <div className="input-actions-progress-bar">
            <div
              className="input-actions-progress-fill"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="input-actions-error">
          {error}
          <button onClick={() => setError(null)} type="button">Dismiss</button>
        </div>
      )}
    </div>
  );
}
