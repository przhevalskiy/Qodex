import { FileText } from 'lucide-react';
import { DocumentSource } from '@/shared/types';
import { formatChunkPreview } from '@/shared/utils/formatChunkPreview';
import './SourceCard.css';

interface SourceCardProps {
  source: DocumentSource;
  onClick: () => void;
}

export function SourceCard({ source, onClick }: SourceCardProps) {
  const scorePercent = Math.round(source.score * 100);

  // Truncate filename if too long
  const displayName = source.filename.length > 40
    ? source.filename.slice(0, 37) + '...'
    : source.filename;

  const previewText = formatChunkPreview(source.chunk_preview) || 'No preview available';

  return (
    <div className="source-card" onClick={onClick} role="button" tabIndex={0}>
      <div className="source-card-header">
        {source.citation_number && (
          <span className="source-card-citation">[{source.citation_number}]</span>
        )}
        <FileText size={16} className="source-card-icon" />
        <span className="source-card-filename" title={source.filename}>
          {displayName}
        </span>
      </div>

      <div className="source-card-preview">
        {previewText}
      </div>

      <div className="source-card-footer">
        <div className="source-card-score">
          <div className="source-card-score-bar">
            <div
              className="source-card-score-fill"
              style={{ width: `${scorePercent}%` }}
            />
          </div>
          <span className="source-card-score-text">{scorePercent}% match</span>
        </div>
      </div>
    </div>
  );
}
