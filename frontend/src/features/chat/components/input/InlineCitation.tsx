import { useState, useRef, useEffect } from 'react';
import { FileText } from 'lucide-react';
import { DocumentSource } from '@/shared/types';
import { useDocumentPreviewStore } from '@/features/documents';
import './InlineCitation.css';

interface InlineCitationProps {
  number: number;
  source?: DocumentSource;
}

export function InlineCitation({ number, source }: InlineCitationProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<'top' | 'bottom'>('top');
  const citationRef = useRef<HTMLSpanElement>(null);
  const { openDocumentPreview } = useDocumentPreviewStore();

  useEffect(() => {
    if (showTooltip && citationRef.current && source) {
      const rect = citationRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const tooltipHeight = 150; // Approximate tooltip height

      // Show tooltip on bottom if too close to top, considering available space
      if (rect.top < tooltipHeight && rect.bottom + tooltipHeight < viewportHeight) {
        setTooltipPosition('bottom');
      } else {
        setTooltipPosition('top');
      }
    }
  }, [showTooltip, source]);

  if (!source) {
    // Fallback for citations without source mapping
    return <sup className="inline-citation">[{number}]</sup>;
  }

  return (
    <span
      ref={citationRef}
      className="inline-citation-wrapper"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={() => {
        const docId = source.document_id || source.id;
        if (docId) openDocumentPreview(docId, source.chunk_id);
      }}
    >
      <sup className="inline-citation interactive">[{number}]</sup>

      <div className={`citation-tooltip ${tooltipPosition}${showTooltip ? ' visible' : ''}`}>
        <div className="citation-tooltip-header">
          <FileText size={14} />
          <span className="citation-tooltip-filename">{source.filename}</span>
        </div>
        {source.chunk_preview && (
          <div className="citation-tooltip-preview">
            {source.chunk_preview}
          </div>
        )}
        <div className="citation-tooltip-score">
          Relevance: {Math.round(source.score * 100)}%
        </div>
      </div>
    </span>
  );
}
