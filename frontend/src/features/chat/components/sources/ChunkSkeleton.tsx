import './ChunkSkeleton.css';

interface ChunkSkeletonProps {
  count?: number;
}

/** Pulsing skeleton placeholder shown while AI formats chunk content. */
export function ChunkSkeleton({ count = 5 }: ChunkSkeletonProps) {
  // Each "chunk" gets a varied set of line widths to feel organic
  const patterns = [
    [100, 95, 88, 70],
    [100, 92, 100, 55],
    [100, 85, 100, 78, 40],
    [100, 90, 60],
    [100, 96, 88, 100, 45],
  ];

  return (
    <div className="chunk-skeleton-wrapper">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="chunk-skeleton-block">
          {patterns[i % patterns.length].map((w, j) => (
            <div
              key={j}
              className="chunk-skeleton-line"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
