import { visit } from 'unist-util-visit';
import type { Root, Text, Parent } from 'mdast';
import type { Plugin } from 'unified';

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
        // Add text before citation
        if (match.index > lastIndex) {
          newNodes.push({
            type: 'text',
            value: text.substring(lastIndex, match.index)
          });
        }

        if (match[1]) {
          // Numeric source citation [N]
          newNodes.push({
            type: 'citation',
            data: {
              hName: 'citation',
              hProperties: {
                number: parseInt(match[1], 10)
              }
            },
            value: match[0]
          });
        } else {
          // AI knowledge citation [AI] or attributed [AI:N,M]
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
