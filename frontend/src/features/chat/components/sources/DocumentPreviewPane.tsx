import { useState, useRef, useEffect } from 'react';
import { FileText } from 'lucide-react';
import { FormattedContent } from './FormattedContent';
import { ChunkSkeleton } from './ChunkSkeleton';
import { api } from '@/shared/services/api';
import { useDocumentPreviewStore } from '@/features/documents';
import './DocumentPreviewPane.css';

interface DocumentPreviewPaneProps {
  documentContent: any;
  highlightedChunk?: string | null;
  onChunkClick?: (chunkId: string) => void;
  zoomLevel?: number;
}

export function DocumentPreviewPane({
  documentContent,
  highlightedChunk,
  onChunkClick,
  zoomLevel = 100,
}: DocumentPreviewPaneProps) {
  const [formattedMap, setFormattedMap] = useState<Map<string, string>>(new Map());
  const { isFormatting, isLoading, setFormatting } = useDocumentPreviewStore();
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to highlighted chunk when it changes
  useEffect(() => {
    if (!highlightedChunk || !contentRef.current) return;

    const timer = setTimeout(() => {
      const el = contentRef.current?.querySelector(
        `[data-chunk-id="${highlightedChunk}"]`
      );
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [highlightedChunk]);

  const documentId = documentContent?.id;
  const chunks = documentContent?.chunks || [];

  // AI-format chunks once when the document loads (cached server-side on repeat opens)
  useEffect(() => {
    if (!documentId || chunks.length === 0 || formattedMap.size > 0) return;

    const rawChunks = chunks.map((c: any) => ({ id: c.id, content: c.content }));

    api.formatDocumentPreview(documentId, rawChunks)
      .then(({ formatted }) => {
        const map = new Map<string, string>();
        formatted.forEach((f: any) => map.set(f.id, f.content));
        setFormattedMap(map);
      })
      .catch((err) => { console.error('[format-preview] failed:', err); })
      .finally(() => setFormatting(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  if (!documentContent) {
    return (
      <div className="document-preview-pane">
        {isLoading || isFormatting ? (
          <ChunkSkeleton count={6} />
        ) : (
          <div className="document-preview-empty">
            <FileText size={48} className="empty-icon" />
            <h3>No Document Available</h3>
            <p>Document content could not be loaded</p>
          </div>
        )}
      </div>
    );
  }

  const fullContent = documentContent.full_content || '';

  return (
    <div className="document-preview-pane">
      <div className="document-content" ref={contentRef}>
        {chunks.length > 0 ? (
          <>
            {isFormatting ? (
              <ChunkSkeleton count={Math.min(chunks.length, 6)} />
            ) : (
              <FormattedContent
                chunks={chunks}
                formattedMap={formattedMap}
                zoomLevel={zoomLevel}
                onChunkClick={onChunkClick}
                highlightedChunk={highlightedChunk}
              />
            )}
          </>
        ) : fullContent ? (
          <div className="document-full-content" style={{ fontSize: `${zoomLevel}%` }}>
            <p>{fullContent}</p>
          </div>
        ) : (
          <div className="document-preview-empty">
            <p>No content available</p>
          </div>
        )}
      </div>
    </div>
  );
}
