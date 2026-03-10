/**
 * Cleans and formats a raw chunk preview string for display in tooltips and source cards.
 * - Normalizes whitespace
 * - Strips mid-word artifacts at boundaries
 * - Returns the first complete sentence; falls back to trimmed raw text
 */
export function formatChunkPreview(raw: string | undefined, maxLength = 160): string {
  if (!raw) return '';

  // Normalize whitespace
  const cleaned = raw.replace(/\s+/g, ' ').trim();

  // Find the first complete sentence boundary
  const sentenceEnd = cleaned.search(/[.!?](\s|$)/);
  const firstSentence = sentenceEnd !== -1
    ? cleaned.substring(0, sentenceEnd + 1).trim()
    : cleaned;

  // If still too long, hard-cut at maxLength on a word boundary
  if (firstSentence.length <= maxLength) return firstSentence;

  const cut = firstSentence.lastIndexOf(' ', maxLength);
  return (cut > 0 ? firstSentence.substring(0, cut) : firstSentence.substring(0, maxLength)) + '…';
}
