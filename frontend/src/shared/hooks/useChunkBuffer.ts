import { useRef, useCallback, useEffect } from 'react';

const DRAIN_INTERVAL_MS = 50;  // release 2 words per tick → ~40 words/sec, halves render count
const NORMAL_BATCH = 2;
const CATCHUP_THRESHOLD = 8;   // start catching up sooner, avoids visible lurch
const CATCHUP_BURST = 5;

/**
 * Buffers incoming SSE text chunks into a word queue and drains them at a
 * fixed interval, decoupling the visual render rate from the API chunk
 * arrival rate. This gives uniform word-by-word streaming for all providers
 * regardless of how large their SDK chunks are.
 *
 * Usage:
 *   const { push, flush } = useChunkBuffer(appendToStream);
 *   // on each SSE chunk: push(chunk)
 *   // on stream end:     flush()  (drains remaining queue immediately)
 */
export function useChunkBuffer(onFlush: (buffered: string) => void) {
  const wordQueueRef = useRef<string[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onFlushRef = useRef(onFlush);
  onFlushRef.current = onFlush;

  const stopInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startInterval = useCallback(() => {
    if (intervalRef.current !== null) return; // already running
    intervalRef.current = setInterval(() => {
      const queue = wordQueueRef.current;
      if (queue.length === 0) {
        stopInterval();
        return;
      }
      const count = queue.length > CATCHUP_THRESHOLD ? CATCHUP_BURST : NORMAL_BATCH;
      const words = queue.splice(0, count);
      onFlushRef.current(words.join(''));
    }, DRAIN_INTERVAL_MS);
  }, [stopInterval]);

  /** Tokenise a chunk into words (preserving trailing spaces) and enqueue them. */
  const push = useCallback(
    (chunk: string) => {
      // Split on word boundaries while keeping the delimiter (space/newline) attached
      // to the preceding token so spacing is preserved when joined.
      const tokens = chunk.split(/(?<=\s)/);
      wordQueueRef.current.push(...tokens.filter(Boolean));
      startInterval();
    },
    [startInterval],
  );

  /** Drain any remaining queued words immediately (call on stream end). */
  const flush = useCallback(() => {
    stopInterval();
    const queue = wordQueueRef.current;
    if (queue.length > 0) {
      const remaining = queue.splice(0).join('');
      onFlushRef.current(remaining);
    }
  }, [stopInterval]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      stopInterval();
    };
  }, [stopInterval]);

  return { push, flush };
}
