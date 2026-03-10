import { visit } from 'unist-util-visit';
import type { Root, Text, Parent } from 'mdast';
import type { Plugin } from 'unified';

/**
 * Returns the index where the last sentence starts within `text`.
 * Splits on `. `, `! `, `? `, or a newline so we underline only the
 * final claim sentence, not the whole preceding paragraph.
 */
function getLastSentenceStart(text: string): number {
  const boundary = /[.!?]\s+|\n/g;
  let last = 0;
  let m;
  while ((m = boundary.exec(text)) !== null) {
    const end = m.index + m[0].length;
    // Ignore a boundary that lands at or past the end of the text —
    // that means the whole text IS the final sentence and should be underlined.
    if (end < text.length) {
      last = end;
    }
  }
  return last;
}

/**
 * Remark plugin to process citation markers [N] into custom nodes
 * This prevents markdown from treating them as link references
 */
export const remarkCitations: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index: number | undefined, parent: Parent | undefined) => {
      if (!parent || index === undefined) return;

      // Skip text nodes inside code blocks or inline code
      if (parent.type === 'code' || parent.type === 'inlineCode') return;

      const text = node.value;
      const citationRegex = /\[(\d+)\]|\[AI(?::(\d+(?:,\s*\d+)*))?\]/gi;

      // Check if this text node contains citation markers
      if (!citationRegex.test(text)) return;

      // Reset regex for actual processing
      citationRegex.lastIndex = 0;

      const newNodes: Array<Text | any> = [];
      let lastIndex = 0;
      let match;

      while ((match = citationRegex.exec(text)) !== null) {
        const preceding = text.substring(lastIndex, match.index);

        if (match[1]) {
          // Numeric source citation [N] — plain text before it, no underline
          if (preceding) {
            newNodes.push({ type: 'text', value: preceding });
          }
          newNodes.push({
            type: 'citation',
            data: {
              hName: 'citation',
              hProperties: { number: parseInt(match[1], 10) }
            },
            value: match[0]
          });
        } else {
          // AI knowledge citation [AI] or attributed [AI:N,M]
          // Underline only the final sentence/clause before the citation
          const sentenceStart = getLastSentenceStart(preceding);
          const beforeClaim = preceding.substring(0, sentenceStart);
          const claimText = preceding.substring(sentenceStart);

          // Strip leading punctuation (e.g. ": " or ", ") from claimText — push as plain text
          const leadingPunct = /^[:\s,;]+/.exec(claimText);
          const claimPrefix = leadingPunct ? leadingPunct[0] : '';
          const claimBody = claimText.substring(claimPrefix.length);

          if (beforeClaim || claimPrefix) {
            newNodes.push({ type: 'text', value: beforeClaim + claimPrefix });
          }
          if (claimBody) {
            newNodes.push({
              type: 'aiClaim',
              data: {
                hName: 'ai-claim',
                hProperties: {
                  attributed: match[2] ? 'true' : 'false'
                }
              },
              children: [{ type: 'text', value: claimBody }]
            });
          }
          newNodes.push({
            type: 'citation',
            data: {
              hName: 'citation',
              hProperties: {
                ai: "true",
                aiSources: match[2] ? match[2].replace(/\s/g, '') : ""
              }
            },
            value: match[0]
          });
        }

        lastIndex = match.index + match[0].length;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        newNodes.push({
          type: 'text',
          value: text.substring(lastIndex)
        });
      }

      // Replace the text node with our new nodes
      if (newNodes.length > 0) {
        parent.children.splice(index, 1, ...newNodes);
      }
    });
  };
};
