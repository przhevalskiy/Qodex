import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './FormattedContent.css';

interface ContentBlock {
  id: string;
  content: string;
  chunk_index: number;
  content_type?: string;
}

interface FormattedContentProps {
  chunks: ContentBlock[];
  /** AI-formatted markdown text keyed by chunk id. Falls back to raw content when absent. */
  formattedMap?: Map<string, string>;
  zoomLevel?: number;
  onChunkClick?: (chunkId: string) => void;
  highlightedChunk?: string | null;
}

export function FormattedContent({
  chunks,
  formattedMap,
  zoomLevel = 100,
  onChunkClick,
  highlightedChunk
}: FormattedContentProps) {
  return (
    <div
      className="formatted-content"
      style={{ fontSize: `${zoomLevel}%` }}
    >
      {chunks.map((chunk) => {
        const isHighlighted = highlightedChunk === chunk.id;
        const displayContent = formattedMap?.get(chunk.id) ?? chunk.content;

        return (
          <div
            key={chunk.id}
            className={`content-block ${isHighlighted ? 'content-block--highlighted' : ''}`}
            onClick={() => onChunkClick?.(chunk.id)}
            data-chunk-id={chunk.id}
          >
            <div className="content-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayContent}
              </ReactMarkdown>
            </div>
          </div>
        );
      })}
    </div>
  );
}
