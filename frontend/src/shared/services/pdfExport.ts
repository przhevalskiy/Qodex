import jsPDF from 'jspdf';
import { Message } from '../types';

interface ExportOptions {
  content: string;
  provider?: string;
  timestamp?: string;
  title?: string;
}

interface ConversationExportOptions {
  messages: Message[];
  title?: string;
}

interface DocumentExportOptions {
  filename: string;
  fullContent: string;
  chunks?: Array<{
    id: string;
    content: string;
    chunk_index: number;
    content_type?: string;
  }>;
}

/**
 * Load the Qodex logo as a base64 data URL.
 */
async function loadLogoBase64(): Promise<string | null> {
  try {
    const response = await fetch('/qodex-logo.png');
    if (!response.ok) return null;
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Add Qodex logo centered at the top of every page.
 * Logo is ~square (2000x2032), rendered as 14×14mm.
 */
function addLogoToPages(pdf: jsPDF, logoBase64: string, pageWidth: number, totalPages: number): void {
  const logoSize = 14; // mm (square logo)
  const logoX = (pageWidth - logoSize) / 2;
  const logoY = 4;

  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    pdf.addImage(logoBase64, 'PNG', logoX, logoY, logoSize, logoSize);
  }
}

/**
 * Clean markdown text for PDF rendering.
 * Strips markdown syntax while preserving readable text.
 */
function cleanMarkdownText(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')           // Remove bold markers
    .replace(/\*(.*?)\*/g, '$1')               // Remove italic markers
    .replace(/`(.*?)`/g, '$1')                 // Remove inline code markers
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')      // Convert links to just text
    .replace(/\[\d+\]/g, '')                   // Remove citation markers like [1], [2]
    .replace(/\s+/g, ' ')                      // Normalize whitespace
    .trim();
}

/**
 * Calculate indent level from leading whitespace.
 * Returns indent level (0, 1, 2, etc.) based on 2-space indentation.
 */
function getIndentLevel(line: string): number {
  const match = line.match(/^(\s*)/);
  if (!match) return 0;
  const spaces = match[1].length;
  return Math.floor(spaces / 2);
}

/**
 * Draw a bullet dot at the given position using PDF graphics (avoids Unicode encoding issues).
 * Level 0: filled circle; level 1+: outlined circle, slightly smaller.
 */
function drawBulletDot(pdf: jsPDF, x: number, y: number, level: number): void {
  const dotY = y - 1.3;
  pdf.setFillColor(0, 0, 0);
  pdf.setDrawColor(0, 0, 0);
  if (level === 0) {
    pdf.circle(x, dotY, 1.1, 'F');
  } else if (level === 1) {
    pdf.circle(x, dotY, 0.9, 'DF');
  } else {
    // Tiny filled square for deeper levels
    pdf.rect(x - 0.8, dotY - 0.8, 1.6, 1.6, 'F');
  }
}

/**
 * Render a markdown table to the PDF.
 * tableLines: array of raw pipe-delimited lines.
 * Returns new yPosition after the table.
 */
function renderTable(
  pdf: jsPDF,
  tableLines: string[],
  margin: number,
  contentWidth: number,
  yPosition: number,
  pageHeight: number
): number {
  // Parse rows, skip separator rows (cells all dashes/colons)
  const rows = tableLines
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
    .filter(cells => cells.length > 0 && !cells.every(cell => /^[-: ]+$/.test(cell)));

  if (rows.length === 0) return yPosition;

  const colCount = Math.max(...rows.map(r => r.length));
  const colWidth = contentWidth / colCount;
  const cellPadH = 2;  // horizontal padding mm
  const cellPadV = 1.5; // vertical padding mm
  const lineHeight = 4.5;
  const fontSize = 9;

  pdf.setFontSize(fontSize);

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const isHeader = rowIdx === 0;
    const row = rows[rowIdx];

    // Calculate row height based on max wrapped lines in any cell
    let maxLines = 1;
    pdf.setFont('helvetica', isHeader ? 'bold' : 'normal');
    pdf.setFontSize(fontSize);
    for (let colIdx = 0; colIdx < colCount; colIdx++) {
      const cellText = row[colIdx] || '';
      const wrapped = pdf.splitTextToSize(cleanMarkdownText(cellText), colWidth - cellPadH * 2);
      maxLines = Math.max(maxLines, wrapped.length);
    }
    const rowHeight = maxLines * lineHeight + cellPadV * 2;

    // Page break check
    if (yPosition + rowHeight > pageHeight - margin - 15) {
      pdf.addPage();
      yPosition = margin;
    }

    // Header background
    if (isHeader) {
      pdf.setFillColor(235, 242, 255);
      pdf.rect(margin, yPosition, contentWidth, rowHeight, 'F');
    } else if (rowIdx % 2 === 0) {
      pdf.setFillColor(250, 251, 255);
      pdf.rect(margin, yPosition, contentWidth, rowHeight, 'F');
    }

    // Draw cells
    pdf.setDrawColor(180, 200, 230);
    for (let colIdx = 0; colIdx < colCount; colIdx++) {
      const cellX = margin + colIdx * colWidth;
      const cellText = row[colIdx] || '';

      // Cell border
      pdf.rect(cellX, yPosition, colWidth, rowHeight);

      // Cell text
      pdf.setFont('helvetica', isHeader ? 'bold' : 'normal');
      pdf.setFontSize(fontSize);
      pdf.setTextColor(0, 0, 0);

      const wrapped = pdf.splitTextToSize(cleanMarkdownText(cellText), colWidth - cellPadH * 2);
      for (let lineIdx = 0; lineIdx < wrapped.length; lineIdx++) {
        pdf.text(
          wrapped[lineIdx],
          cellX + cellPadH,
          yPosition + cellPadV + lineHeight * (lineIdx + 0.8)
        );
      }
    }

    yPosition += rowHeight;
  }

  // Reset draw color after table
  pdf.setDrawColor(200, 200, 200);
  return yPosition + 4;
}

/**
 * Render formatted content to PDF with proper structure and styling.
 */
function renderContentToPDF(
  pdf: jsPDF,
  content: string,
  margin: number,
  contentWidth: number,
  pageHeight: number,
  startY: number
): number {
  let yPosition = startY;
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];

  const checkPageBreak = (height: number) => {
    if (yPosition + height > pageHeight - margin - 15) {
      pdf.addPage();
      yPosition = margin;
    }
  };

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Handle code blocks
    if (trimmedLine.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockContent = [];
        continue;
      } else {
        // End of code block - render it
        inCodeBlock = false;
        if (codeBlockContent.length > 0) {
          checkPageBreak(codeBlockContent.length * 4 + 6);

          // Draw code block background
          const blockHeight = codeBlockContent.length * 4 + 4;
          pdf.setFillColor(245, 245, 245);
          pdf.rect(margin, yPosition - 2, contentWidth, blockHeight, 'F');

          // Render code
          pdf.setFont('courier', 'normal');
          pdf.setFontSize(9);
          pdf.setTextColor(50, 50, 50);

          for (const codeLine of codeBlockContent) {
            const wrappedCode = pdf.splitTextToSize(codeLine, contentWidth - 6);
            for (const wrappedCodeLine of wrappedCode) {
              pdf.text(wrappedCodeLine, margin + 3, yPosition + 2);
              yPosition += 4;
            }
          }
          yPosition += 4;

          // Reset font
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(11);
          pdf.setTextColor(0, 0, 0);
        }
        continue;
      }
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Handle markdown tables (lookahead to collect all rows)
    if (trimmedLine.startsWith('|') && trimmedLine.endsWith('|')) {
      const tableLines = [line];
      let j = i + 1;
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        tableLines.push(lines[j]);
        j++;
      }
      i = j - 1; // Skip to last consumed row (loop will increment)
      yPosition = renderTable(pdf, tableLines, margin, contentWidth, yPosition, pageHeight);
      continue;
    }

    // Handle horizontal rules
    if (/^[-*_]{3,}$/.test(trimmedLine)) {
      checkPageBreak(8);
      yPosition += 3;
      pdf.setDrawColor(200, 200, 200);
      pdf.line(margin, yPosition, margin + contentWidth, yPosition);
      yPosition += 5;
      continue;
    }

    // Handle H4 headers
    if (trimmedLine.startsWith('#### ')) {
      checkPageBreak(10);
      yPosition += 4;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      const headerText = cleanMarkdownText(trimmedLine.replace(/^####\s*/, ''));
      const wrappedHeaders = pdf.splitTextToSize(headerText, contentWidth);
      for (const wrappedHeader of wrappedHeaders) {
        pdf.text(wrappedHeader, margin, yPosition);
        yPosition += 5;
      }
      yPosition += 2;
      pdf.setFont('helvetica', 'normal');
      continue;
    }

    // Handle H3 headers
    if (trimmedLine.startsWith('### ')) {
      checkPageBreak(12);
      yPosition += 5;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      const headerText = cleanMarkdownText(trimmedLine.replace(/^###\s*/, ''));
      const wrappedHeaders = pdf.splitTextToSize(headerText, contentWidth);
      for (const wrappedHeader of wrappedHeaders) {
        pdf.text(wrappedHeader, margin, yPosition);
        yPosition += 6;
      }
      yPosition += 2;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      continue;
    }

    // Handle H2 headers
    if (trimmedLine.startsWith('## ')) {
      checkPageBreak(14);
      yPosition += 6;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(14);
      const headerText = cleanMarkdownText(trimmedLine.replace(/^##\s*/, ''));
      const wrappedHeaders = pdf.splitTextToSize(headerText, contentWidth);
      for (const wrappedHeader of wrappedHeaders) {
        pdf.text(wrappedHeader, margin, yPosition);
        yPosition += 7;
      }
      yPosition += 3;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      continue;
    }

    // Handle H1 headers
    if (trimmedLine.startsWith('# ')) {
      checkPageBreak(16);
      yPosition += 7;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      const headerText = cleanMarkdownText(trimmedLine.replace(/^#\s*/, ''));
      const wrappedHeaders = pdf.splitTextToSize(headerText, contentWidth);
      for (const wrappedHeader of wrappedHeaders) {
        pdf.text(wrappedHeader, margin, yPosition);
        yPosition += 8;
      }
      yPosition += 3;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      continue;
    }

    // Handle unordered list items — includes •, ●, ○ as well as - and *
    // These Unicode bullet chars can't be rendered by jsPDF standard fonts, so we catch them here
    // and draw the bullet dot programmatically.
    const bulletMatch = line.match(/^(\s*)([-*\u2022\u25CF\u25E6\u25AA\u2013])\s+(.*)$/) ||
                        line.match(/^(\s*)(•|●|○|–)\s+(.*)$/);

    if (bulletMatch) {
      const indentLevel = getIndentLevel(line);
      const indent = indentLevel * 5;
      const itemText = cleanMarkdownText(bulletMatch[3] || bulletMatch[bulletMatch.length - 1]);

      checkPageBreak(6);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      pdf.setTextColor(0, 0, 0);

      const wrappedLines = pdf.splitTextToSize(itemText, contentWidth - indent - 8);

      for (let j = 0; j < wrappedLines.length; j++) {
        checkPageBreak(5);
        if (j === 0) {
          drawBulletDot(pdf, margin + indent + 1.5, yPosition, indentLevel);
          pdf.text(wrappedLines[j], margin + indent + 5, yPosition);
        } else {
          pdf.text(wrappedLines[j], margin + indent + 5, yPosition);
        }
        yPosition += 5;
      }
      continue;
    }

    // Handle numbered list items
    const numberedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);

    if (numberedMatch) {
      const indentLevel = getIndentLevel(line);
      const indent = indentLevel * 5;
      const number = numberedMatch[2];
      const itemText = cleanMarkdownText(numberedMatch[3]);

      checkPageBreak(6);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      pdf.setTextColor(0, 0, 0);

      const wrappedLines = pdf.splitTextToSize(itemText, contentWidth - indent - 10);

      for (let j = 0; j < wrappedLines.length; j++) {
        checkPageBreak(5);
        if (j === 0) {
          pdf.text(`${number}.`, margin + indent, yPosition);
          pdf.text(wrappedLines[j], margin + indent + 7, yPosition);
        } else {
          pdf.text(wrappedLines[j], margin + indent + 7, yPosition);
        }
        yPosition += 5;
      }
      continue;
    }

    // Handle empty lines
    if (trimmedLine === '') {
      yPosition += 3;
      continue;
    }

    // Handle bold-only lines (like **Title**)
    if (trimmedLine.startsWith('**') && trimmedLine.endsWith('**') && !trimmedLine.slice(2, -2).includes('**')) {
      checkPageBreak(6);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      const boldText = trimmedLine.slice(2, -2);
      const wrappedLines = pdf.splitTextToSize(boldText, contentWidth);
      for (const wrappedLine of wrappedLines) {
        checkPageBreak(5);
        pdf.text(wrappedLine, margin, yPosition);
        yPosition += 5;
      }
      pdf.setFont('helvetica', 'normal');
      continue;
    }

    // Regular text
    checkPageBreak(6);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.setTextColor(0, 0, 0);

    const cleanLine = cleanMarkdownText(line);
    if (cleanLine) {
      const wrappedLines = pdf.splitTextToSize(cleanLine, contentWidth);
      for (const wrappedLine of wrappedLines) {
        checkPageBreak(5);
        pdf.text(wrappedLine, margin, yPosition);
        yPosition += 5;
      }
    }
  }

  return yPosition;
}

/**
 * Export a message to PDF with clean formatting.
 * Uses jsPDF for direct text rendering (cleaner than html2canvas for text content).
 */
export async function exportMessageToPDF({
  content,
  provider,
  timestamp,
  title = 'Qodex Response',
}: ExportOptions): Promise<void> {
  const logoBase64 = await loadLogoBase64();

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let yPosition = margin;

  // Title
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  pdf.text(title, margin, yPosition);
  yPosition += 10;

  // Metadata line
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(128, 128, 128);

  const metaParts: string[] = [];
  if (provider) {
    const providerNames: Record<string, string> = {
      openai: 'OpenAI',
      mistral: 'Mistral',
      claude: 'Claude',
      cohere: 'Cohere',
    };
    metaParts.push(`Provider: ${providerNames[provider] || provider}`);
  }
  if (timestamp) {
    metaParts.push(`Generated: ${new Date(timestamp).toLocaleString()}`);
  } else {
    metaParts.push(`Exported: ${new Date().toLocaleString()}`);
  }

  pdf.text(metaParts.join('  |  '), margin, yPosition);
  yPosition += 8;

  // Separator line
  pdf.setDrawColor(200, 200, 200);
  pdf.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 10;

  // Render content
  pdf.setTextColor(0, 0, 0);
  renderContentToPDF(pdf, content, margin, contentWidth, pageHeight, yPosition);

  // Footer + logo on all pages
  const totalPages = pdf.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(9);
    pdf.setTextColor(150, 150, 150);
    pdf.text(
      `Generated by Qodex  |  Page ${i} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
  }

  if (logoBase64) {
    addLogoToPages(pdf, logoBase64, pageWidth, totalPages);
  }

  // Generate filename
  const dateStr = new Date().toISOString().split('T')[0];
  const providerStr = provider ? `-${provider}` : '';
  const filename = `qodex-response${providerStr}-${dateStr}.pdf`;

  // Download
  pdf.save(filename);
}

/**
 * Export an entire conversation to PDF with all messages.
 * Reuses the same PDF formatting as single message export.
 */
export async function exportConversationToPDF({
  messages,
  title = 'Qodex Conversation',
}: ConversationExportOptions): Promise<void> {
  const logoBase64 = await loadLogoBase64();

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let yPosition = margin;

  // Helper to add new page if needed
  const checkPageBreak = (height: number) => {
    if (yPosition + height > pageHeight - margin - 15) {
      pdf.addPage();
      yPosition = margin;
    }
  };

  // Title
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  pdf.text(title, margin, yPosition);
  yPosition += 10;

  // Metadata
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(128, 128, 128);
  pdf.text(`Exported: ${new Date().toLocaleString()}  |  Messages: ${messages.length}`, margin, yPosition);
  yPosition += 8;

  // Separator line
  pdf.setDrawColor(200, 200, 200);
  pdf.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 12;

  // Process each message
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    checkPageBreak(15);

    // Message header with role
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');

    if (message.role === 'user') {
      pdf.setTextColor(59, 130, 246); // Blue for user
      pdf.text('You:', margin, yPosition);
    } else {
      pdf.setTextColor(16, 185, 129); // Green for assistant
      const providerNames: Record<string, string> = {
        openai: 'OpenAI',
        mistral: 'Mistral',
        claude: 'Claude',
        cohere: 'Cohere',
      };
      const providerName = message.provider ? providerNames[message.provider] || message.provider : 'Qodex';
      pdf.text(`${providerName}:`, margin, yPosition);
    }

    yPosition += 8;

    // Render message content using shared renderer
    pdf.setTextColor(0, 0, 0);
    yPosition = renderContentToPDF(pdf, message.content, margin + 3, contentWidth - 3, pageHeight, yPosition);

    // Add spacing between messages
    yPosition += 6;

    // Add separator between messages (except after last one)
    if (i < messages.length - 1) {
      checkPageBreak(8);
      pdf.setDrawColor(220, 220, 220);
      pdf.line(margin + 10, yPosition, pageWidth - margin - 10, yPosition);
      yPosition += 8;
    }
  }

  // Footer + logo on all pages
  const totalPages = pdf.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(9);
    pdf.setTextColor(150, 150, 150);
    pdf.text(
      `Generated by Qodex  |  Page ${i} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
  }

  if (logoBase64) {
    addLogoToPages(pdf, logoBase64, pageWidth, totalPages);
  }

  // Generate filename
  const dateStr = new Date().toISOString().split('T')[0];
  const titleSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  const filename = `qodex-${titleSlug}-${dateStr}.pdf`;

  // Download
  pdf.save(filename);
}

/**
 * Preprocess plain text content to add markdown-like structure.
 * Detects headings, lists, and sections common in syllabi and academic documents.
 */
function preprocessDocumentContent(content: string): string {
  let text = content;

  // Split inline structural elements onto their own lines
  // Split "Session N:" / "Class N:" / "Week N:" etc. patterns
  text = text.replace(/([^\n])\s+((?:Session|Class|Week|Lecture|Module|Seminar|Topic|Part)\s+\d+)/gi, '$1\n\n$2');

  // Split body text after Session/Week/Lecture headings with date parentheticals
  text = text.replace(/((?:Session|Class|Week|Lecture|Module|Seminar|Topic|Part)\s+\d+[^)\n]*\([^)]+\))\s+(?=[A-Z][a-z])/gi, '$1\n\n');

  // Split ALL-CAPS headers (3+ words) that run inline after punctuation
  text = text.replace(/([.!?)\d])\s+((?:[A-Z][A-Z&,\-()/%\d]+)(?:\s+(?:[A-Z][A-Z&,\-()/%\d]+|OF|ON|THE|AND|FOR|IN|TO|A|AN))+)\s+(?=[A-Z][a-z])/g, '$1\n\n$2\n\n');

  // Split "Required readings" / "Additional readings" etc. onto own lines
  text = text.replace(/([^\n])\s+((?:Required|Additional|Recommended|Suggested|Further|Optional)\s+(?:readings?|texts?|materials?|resources?))/gi, '$1\n\n$2');

  // Split "Grading" related headers
  text = text.replace(/([^\n])\s+(Grading\s+(?:rubric|criteria|breakdown|policy|scheme|structure)?)/gi, '$1\n\n$2');

  // Split assignment headers
  text = text.replace(/([^\n])\s+((?:INDIVIDUAL|GROUP|FINAL|MIDTERM|COURSE)\s+(?:ASSIGNMENT|PROJECT|EXAM|PAPER|PLAN|EVALUATION))/g, '$1\n\n$2');

  // Split inline bullets
  text = text.replace(/([^\n])(\s*[•●○]\s+)/g, '$1\n$2');
  text = text.replace(/([^\n-])\s+(- [A-Za-z])/g, '$1\n$2');

  // Convert roman numeral lists: (i), (ii), (iii), (iv), etc. to bullet points
  text = text.replace(/\s*\(i+v?\)\s+/gi, '\n• ');
  text = text.replace(/\s*\(v?i+\)\s+/gi, '\n• ');
  text = text.replace(/\s*\(x+\)\s+/gi, '\n• ');

  // Split sentences that start numbered items after punctuation
  text = text.replace(/([.!?:;])\s+(\d+[.)]\s+[A-Z])/g, '$1\n$2');

  // Normalize multiple spaces
  text = text.replace(/[ \t]{2,}/g, ' ');

  // Now process line by line to add markdown formatting
  const lines = text.split('\n');
  const formattedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      formattedLines.push('');
      continue;
    }

    // Detect ALL-CAPS headers (2+ uppercase words, under 100 chars)
    if (/^[A-Z][A-Z\s:&,\-()/%\d]{3,}$/.test(line) && line.length < 100 && line.length > 5) {
      // Major section header - use ## (H2)
      formattedLines.push('');
      formattedLines.push(`## ${line}`);
      formattedLines.push('');
      continue;
    }

    // Detect "Session N:" / "Week N:" / "Class N:" patterns
    if (/^(?:Session|Class|Week|Lecture|Module|Seminar|Topic|Part)\s+\d+/i.test(line) && line.length < 150) {
      formattedLines.push('');
      formattedLines.push(`### ${line}`);
      formattedLines.push('');
      continue;
    }

    // Detect "Course Description", "Learning Objectives", etc. with trailing colon or standalone
    if (/^[A-Z][A-Za-z\s,&\-']+:\s*$/.test(line) && line.length < 80) {
      formattedLines.push('');
      formattedLines.push(`### ${line.replace(/:\s*$/, '')}`);
      formattedLines.push('');
      continue;
    }

    // Detect standalone subheadings like "Required readings", "Grading rubric"
    if (/^(?:Required|Additional|Recommended|Suggested|Further|Optional)\s+(?:readings?|texts?|materials?|resources?)\s*$/i.test(line)) {
      formattedLines.push('');
      formattedLines.push(`#### ${line}`);
      formattedLines.push('');
      continue;
    }

    if (/^Grading\s+(?:rubric|criteria|breakdown|policy|scheme|structure)?\s*$/i.test(line)) {
      formattedLines.push('');
      formattedLines.push(`#### ${line}`);
      formattedLines.push('');
      continue;
    }

    // Convert bullet-like patterns to proper markdown bullets
    if (/^[•●○]\s+/.test(line)) {
      formattedLines.push(`- ${line.replace(/^[•●○]\s+/, '')}`);
      continue;
    }

    // Numbered list items
    if (/^\d+[.)]\s+/.test(line)) {
      formattedLines.push(line);
      continue;
    }

    // Regular paragraph text
    formattedLines.push(line);
  }

  return formattedLines.join('\n');
}

/**
 * Clean up document title for display.
 * Removes underscores/dashes and formats nicely.
 */
function cleanDocumentTitle(filename: string): string {
  return filename
    .replace(/\.[^/.]+$/, '')           // Remove extension
    .replace(/[-_]+/g, ' ')             // Replace dashes/underscores with spaces
    .replace(/\s+/g, ' ')               // Normalize spaces
    .trim();
}

/**
 * Export a document (from stored chunks) to PDF.
 * Reconstructs the document from chunks with syllabus-appropriate formatting.
 */
export async function exportDocumentToPDF({
  filename,
  fullContent,
  chunks,
}: DocumentExportOptions): Promise<void> {
  const logoBase64 = await loadLogoBase64();

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let yPosition = margin;

  // Document title (cleaned up for display)
  const docTitle = cleanDocumentTitle(filename);
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');

  // Wrap title if too long
  const wrappedTitle = pdf.splitTextToSize(docTitle, contentWidth);
  for (const titleLine of wrappedTitle) {
    pdf.text(titleLine, margin, yPosition);
    yPosition += 8;
  }
  yPosition += 4;

  // Metadata line
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(128, 128, 128);

  const chunkCount = chunks?.length || 0;
  const metaText = chunkCount > 0
    ? `Reconstructed from ${chunkCount} sections  |  Downloaded: ${new Date().toLocaleString()}`
    : `Downloaded: ${new Date().toLocaleString()}`;
  pdf.text(metaText, margin, yPosition);
  yPosition += 8;

  // Separator line
  pdf.setDrawColor(200, 200, 200);
  pdf.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 10;

  // Render document content
  pdf.setTextColor(0, 0, 0);

  // Use chunks if available (preserves structure), otherwise use full content
  let rawContent = '';
  if (chunks && chunks.length > 0) {
    // Join chunk content with spacing for better readability
    rawContent = chunks
      .sort((a, b) => a.chunk_index - b.chunk_index)
      .map(chunk => chunk.content)
      .join('\n\n');
  } else if (fullContent) {
    rawContent = fullContent;
  }

  // Preprocess to detect and add markdown-like structure
  const processedContent = preprocessDocumentContent(rawContent);
  yPosition = renderContentToPDF(pdf, processedContent, margin, contentWidth, pageHeight, yPosition);

  // Footer + logo on all pages
  const totalPages = pdf.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(9);
    pdf.setTextColor(150, 150, 150);
    pdf.text(
      `Downloaded from Qodex  |  Page ${i} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
  }

  if (logoBase64) {
    addLogoToPages(pdf, logoBase64, pageWidth, totalPages);
  }

  // Generate filename for download
  const dateStr = new Date().toISOString().split('T')[0];
  const safeFilename = filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 50);
  const downloadFilename = `${safeFilename}-${dateStr}.pdf`;

  // Download
  pdf.save(downloadFilename);
}
