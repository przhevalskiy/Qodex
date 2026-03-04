import { useState } from 'react';
import { FileText, ChevronDown, ChevronUp, LayoutGrid } from 'lucide-react';
import { DocumentSource } from '@/shared/types';
import { useDocumentPreviewStore } from '@/features/documents';
import { AllSourcesModal } from '../modals/AllSourcesModal';
import './SourcesDisplay.css';

interface SourcesDisplayProps {
  sources: DocumentSource[];
  maxVisible?: number;
}

export function SourcesDisplay({ sources, maxVisible = 3 }: SourcesDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const { openDocumentPreview } = useDocumentPreviewStore();

  if (!sources || sources.length === 0) {
    return null;
  }

  const visibleSources = isExpanded ? sources : sources.slice(0, maxVisible);
  const hiddenCount = sources.length - maxVisible;

  const handleSourceSelect = (source: DocumentSource) => {
    openDocumentPreview(source.document_id || source.id, source.chunk_id, source.citation_number ?? undefined);
  };

  return (
    <div className="sources-display">
      <div className="sources-chips">
        {visibleSources.map((source) => (
          <DocumentChip
            key={source.chunk_id || `${source.id}-${source.citation_number}`}
            source={source}
            onClick={() => openDocumentPreview(source.document_id || source.id, source.chunk_id, source.citation_number ?? undefined)}
          />
        ))}

        {!isExpanded && hiddenCount > 0 && (
          <button
            className="sources-expand-btn"
            onClick={() => setIsExpanded(true)}
          >
            +{hiddenCount} more
            <ChevronDown size={14} />
          </button>
        )}

        {isExpanded && sources.length > maxVisible && (
          <button
            className="sources-expand-btn"
            onClick={() => setIsExpanded(false)}
          >
            Show less
            <ChevronUp size={14} />
          </button>
        )}

        {sources.length > 1 && (
          <button
            className="sources-view-all-btn"
            onClick={() => setShowAllSources(true)}
            title="View all sources in a grid"
          >
            <LayoutGrid size={14} />
            View All
          </button>
        )}
      </div>

      <AllSourcesModal
        isOpen={showAllSources}
        onClose={() => setShowAllSources(false)}
        sources={sources}
        onSourceSelect={handleSourceSelect}
      />
    </div>
  );
}

interface DocumentChipProps {
  source: DocumentSource;
  onClick: () => void;
}

function DocumentChip({ source, onClick }: DocumentChipProps) {
  const truncatedName = source.filename.length > 24
    ? source.filename.slice(0, 21) + '...'
    : source.filename;

  // Color based on score (higher = more green)
  const scorePercent = Math.round(source.score * 100);

  return (
    <div 
      className="document-chip clickable" 
      title={`${source.filename} (${scorePercent}% match) - Click to preview`}
      onClick={onClick}
    >
      {source.citation_number && (
        <span className="document-chip-citation">[{source.citation_number}]</span>
      )}
      <FileText size={14} className="document-chip-icon" />
      <span className="document-chip-name">{truncatedName}</span>
      <span className="document-chip-score">{scorePercent}%</span>
    </div>
  );
}
