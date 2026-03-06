import { useState, useRef, useEffect } from 'react';
import { FileText, Sparkles } from 'lucide-react';
import { DocumentSource } from '@/shared/types';
import { useDocumentPreviewStore } from '@/features/documents';
import './InlineCitation.css';

interface InlineCitationProps {
  number?: number;
  source?: DocumentSource;
  ai?: boolean | string;
  resolvedAiSources?: DocumentSource[];
}

export function InlineCitation({ number, source, ai, resolvedAiSources }: InlineCitationProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<'top' | 'bottom'>('top');
  const citationRef = useRef<HTMLSpanElement>(null);
  const { openDocumentPreview } = useDocumentPreviewStore();

  useEffect(() => {
    if (showTooltip && citationRef.current) {
      const rect = citationRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const tooltipHeight = 150;

      if (rect.top < tooltipHeight && rect.bottom + tooltipHeight < viewportHeight) {
        setTooltipPosition('bottom');
      } else {
        setTooltipPosition('top');
      }
    }
  }, [showTooltip]);

  // AI citation — attributed [AI:N,M] or plain [AI]
  if (ai) {
    const isAttributed = resolvedAiSources && resolvedAiSources.length > 0;
    return (
      <span
        ref={citationRef}
        className="inline-citation-wrapper"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <sup className={`inline-citation ai-knowledge${isAttributed ? ' ai-attributed' : ''}`}>[AI]</sup>

        <div className={`citation-tooltip ${tooltipPosition}${showTooltip ? ' visible' : ''}`}>
          <div className="citation-tooltip-header">
            <Sparkles size={14} />
            <span className="citation-tooltip-filename">
              {isAttributed ? 'Reasoned Inference' : 'General AI Knowledge'}
            </span>
          </div>
          <div className="citation-tooltip-preview">
            {isAttributed ? (
              <>
                Causal bridge reasoning derived from:{' '}
                {resolvedAiSources!.map((s, i) => (
                  <span key={s.id || i}>
                    {i > 0 && ', '}
                    <strong>{s.filename}</strong>
                  </span>
                ))}
              </>
            ) : (
              'This statement reflects the model\'s general training knowledge and was used to support the claim, but was not derived or connected to the retrieved sources.'
            )}
          </div>
        </div>
      </span>
    );
  }

  if (!source) {
    // Fallback for numeric citations without source mapping — suppress
    return null;
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
