import { useState } from 'react';
import { Modal } from '@/components/ui';
import { DocumentPreviewPane } from '../sources/DocumentPreviewPane';
import { DocumentChat } from '../chat/DocumentChat';
import { useDocumentPreviewStore } from '@/features/documents';
import { exportDocumentToPDF } from '@/shared/services/pdfExport';
import { X, FileText, ZoomIn, ZoomOut, Copy, Check, Download } from 'lucide-react';
import './DocumentPreviewModal.css';

export function DocumentPreviewModal() {
  const {
    previewDocument,
    documentContent,
    highlightedChunk,
    citationNumber,
    isLoading,
    isFormatting,
    error,
    closeDocumentPreview,
    clearError
  } = useDocumentPreviewStore();

  const isBusy = isLoading || isFormatting;

  const [zoomLevel, setZoomLevel] = useState(100);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  if (!previewDocument) return null;

  const handleClose = () => { clearError(); closeDocumentPreview(); };

  const fullContent = documentContent?.full_content || '';
  const chunks = documentContent?.chunks || [];

  const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 10, 200));
  const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 10, 50));

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(fullContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleDownloadPDF = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await exportDocumentToPDF({ filename: previewDocument.filename, fullContent, chunks });
    } catch (err) {
      console.error('Failed to download PDF:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal
      isOpen={!!previewDocument}
      onClose={handleClose}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {citationNumber != null && (
            <span className="document-chip-citation">[{citationNumber}]</span>
          )}
          {previewDocument.filename}
        </span>
      }
      size="xl"
    >
      <div className="document-preview-modal">
        {error && (
          <div className="document-preview-error">
            <span>{error}</span>
            <button onClick={clearError} className="error-close-btn">
              <X size={16} />
            </button>
          </div>
        )}

        <div className="document-shared-header">
          <div className="document-title-wrapper">
            <FileText size={18} className="document-icon" />
            <h3 className="document-title">{previewDocument.filename}</h3>
          </div>
          {isBusy ? (
            <div className="document-controls-skeleton">
              <div className="document-control-skeleton" style={{ width: '80px' }} />
              <div className="document-control-skeleton" style={{ width: '60px' }} />
              <div className="document-control-skeleton" style={{ width: '52px' }} />
            </div>
          ) : (
            <div className="document-controls">
              <div className="zoom-controls">
                <button onClick={handleZoomOut} className="zoom-btn" title="Zoom out">
                  <ZoomOut size={16} />
                </button>
                <span className="zoom-level">{zoomLevel}%</span>
                <button onClick={handleZoomIn} className="zoom-btn" title="Zoom in">
                  <ZoomIn size={16} />
                </button>
              </div>
              <button onClick={handleCopyAll} className="copy-all-btn" title="Copy all content">
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button onClick={handleDownloadPDF} className="copy-all-btn" disabled={downloading} title="Download as PDF">
                <Download size={16} />
                {downloading ? 'Downloading...' : 'PDF'}
              </button>
            </div>
          )}
        </div>

        <div className="document-preview-content">
          <div className="document-preview-left">
            <DocumentPreviewPane
              documentContent={documentContent}
              highlightedChunk={highlightedChunk}
              zoomLevel={zoomLevel}
            />
          </div>

          <div className="pane-divider" />

          <div className="document-chat-right">
            <DocumentChat
              documentId={previewDocument.id}
              documentContent={fullContent}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
