import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui';
import { DocumentSource } from '@/shared/types';
import { api } from '@/shared/services/api';
import { FormattedContent } from '../sources/FormattedContent';
import { ChunkSkeleton } from '../sources/ChunkSkeleton';
import { exportDocumentToPDF } from '@/shared/services/pdfExport';
import { FileText, ArrowUpRight, Loader2, Download, ZoomIn, ZoomOut, Copy, Check } from 'lucide-react';
import './AllSourcesModal.css';

interface AllSourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
  sources: DocumentSource[];
  onSourceSelect: (source: DocumentSource) => void;
}

export function AllSourcesModal({
  isOpen,
  onClose,
  sources,
  onSourceSelect,
}: AllSourcesModalProps) {
  const [selectedSource, setSelectedSource] = useState<DocumentSource | null>(null);
  const [documentContent, setDocumentContent] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [formattedMap, setFormattedMap] = useState<Map<string, string>>(new Map());
  const [formatting, setFormatting] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [copied, setCopied] = useState(false);

  // Select first source by default when modal opens
  useEffect(() => {
    if (isOpen && sources.length > 0 && !selectedSource) {
      setSelectedSource(sources[0]);
    }
  }, [isOpen, sources, selectedSource]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedSource(null);
      setDocumentContent(null);
      setFormattedMap(new Map());
      setZoomLevel(100);
    }
  }, [isOpen]);

  // Fetch document content when source changes, then AI-format it
  useEffect(() => {
    if (!selectedSource) return;

    setFormattedMap(new Map());

    const fetchContent = async () => {
      setIsLoading(true);
      try {
        const docId = selectedSource.document_id || selectedSource.id;
        const content = await api.getDocumentContent(docId);
        setDocumentContent(content);

        // AI-format the chunks immediately after content loads
        if (content?.chunks?.length > 0) {
          setFormatting(true);
          const rawChunks = content.chunks.map((c: any) => ({ id: c.id, content: c.content }));
          api.formatDocumentPreview(docId, rawChunks)
            .then(({ formatted }) => {
              const map = new Map<string, string>();
              formatted.forEach((f: any) => map.set(f.id, f.content));
              setFormattedMap(map);
            })
            .catch((err) => { console.error('[format-preview] failed:', err); })
            .finally(() => setFormatting(false));
        }
      } catch (error) {
        console.error('Failed to fetch document content:', error);
        setDocumentContent(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchContent();
  }, [selectedSource]);

  const handleSourceClick = (source: DocumentSource) => {
    setSelectedSource(source);
  };

  const handleDiveClick = (source: DocumentSource) => {
    onClose();
    onSourceSelect(source);
  };

  const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 10, 200));
  const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 10, 50));

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(documentContent?.full_content || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleDownloadPDF = async () => {
    if (!documentContent || downloading) return;
    setDownloading(true);
    try {
      await exportDocumentToPDF({
        filename: documentContent.filename,
        fullContent: documentContent.full_content || '',
        chunks: documentContent.chunks,
      });
    } catch (err) {
      console.error('Failed to download PDF:', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`All Sources (${sources.length})`}
      size="xl"
    >
      <div className="all-sources-modal">
        {/* Shared header — spans full width above both panes */}
        {documentContent && (
          <div className="document-shared-header">
            <div className="document-title-wrapper">
              <FileText size={18} className="document-icon" />
              <h3 className="document-title">{selectedSource?.filename}</h3>
            </div>
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
          </div>
        )}

        {/* Two-pane layout */}
        <div className="all-sources-panes">
          {/* Left Pane - Document Preview */}
          <div className="all-sources-left-pane">
            {isLoading ? (
              <div className="all-sources-loading">
                <Loader2 size={24} className="spinning" />
                <span>Loading document...</span>
              </div>
            ) : documentContent ? (
              <div className="all-sources-document">
                <div className="all-sources-document-content">
                  {documentContent.chunks && documentContent.chunks.length > 0 ? (
                    <>
                      {formatting ? (
                        <ChunkSkeleton count={Math.min(documentContent.chunks.length, 6)} />
                      ) : (
                        <FormattedContent
                          chunks={documentContent.chunks}
                          formattedMap={formattedMap}
                          zoomLevel={zoomLevel}
                          highlightedChunk={selectedSource?.chunk_id}
                        />
                      )}
                    </>
                  ) : documentContent.full_content ? (
                    <div className="all-sources-full-content">
                      {documentContent.full_content}
                    </div>
                  ) : (
                    <div className="all-sources-no-content">No content available</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="all-sources-empty">
                Select a source to preview the document
              </div>
            )}
          </div>

          {/* Right Pane - Source Cards */}
          <div className="all-sources-right-pane">
            <div className="all-sources-cards-header">
              Sources
            </div>
            <div className="all-sources-cards-list">
              {sources.map((source) => {
                const isSelected = selectedSource?.chunk_id === source.chunk_id;
                const scorePercent = Math.round(source.score * 100);

                return (
                  <div
                    key={source.chunk_id || `${source.id}-${source.citation_number}`}
                    className={`all-sources-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSourceClick(source)}
                  >
                    <div className="all-sources-card-header">
                      {source.citation_number && (
                        <span className="all-sources-card-citation">{source.citation_number}</span>
                      )}
                      <span className="all-sources-card-filename" title={source.filename}>
                        {source.filename.length > 30
                          ? source.filename.slice(0, 27) + '...'
                          : source.filename}
                      </span>
                      <span className="all-sources-card-score">{scorePercent}%</span>
                    </div>

                    <button
                      className="all-sources-card-dive-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDiveClick(source);
                      }}
                    >
                      Dive Deeper
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
