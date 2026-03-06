import { X, FileText, ImageIcon, Loader2 } from 'lucide-react';
import { useAttachmentStore } from '@/features/attachments/store';
import { FormattedContent } from '../sources/FormattedContent';
import './FilePreviewModal.css';

export function FilePreviewModal() {
  const { previewAttachment, isLoadingPreview, closePreview } = useAttachmentStore();

  if (!previewAttachment && !isLoadingPreview) return null;

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="file-preview-overlay" onClick={closePreview}>
      <div className="file-preview-modal" onClick={(e) => e.stopPropagation()}>
        {isLoadingPreview ? (
          <div className="file-preview-loading">
            <Loader2 size={24} className="spinning" />
            <span>Loading preview...</span>
          </div>
        ) : previewAttachment ? (
          <>
            <div className="file-preview-header">
              <div className="file-preview-title">
                {previewAttachment.is_image ? <ImageIcon size={18} /> : <FileText size={18} />}
                <span>{previewAttachment.filename}</span>
              </div>
              <div className="file-preview-meta">
                {formatSize(previewAttachment.file_size)}
                {!previewAttachment.is_image && <> &middot; {previewAttachment.chunk_count} chunks</>}
              </div>
              <button onClick={closePreview} className="file-preview-close" type="button">
                <X size={18} />
              </button>
            </div>

            <div className="file-preview-content">
              {previewAttachment.is_image && previewAttachment.image_data ? (
                <img
                  src={`data:${previewAttachment.file_content_type};base64,${previewAttachment.image_data}`}
                  alt={previewAttachment.filename}
                  style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
                />
              ) : (
                <FormattedContent chunks={previewAttachment.chunks} />
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
