// Takus — Shared Utilities
// Centralised helpers used across multiple components.

/**
 * HTML-escape a string to prevent XSS when inserting into innerHTML.
 * @param {string} str
 * @returns {string}
 */
export function esc(str) {
  const d = document.createElement('div');
  d.textContent = String(str ?? '');
  return d.innerHTML;
}

/**
 * Render a subset of Markdown (headings, lists, bold, inline code, HRs)
 * into sanitised HTML suitable for AI summary display.
 * @param {string} text  raw markdown text
 * @returns {string}  HTML string
 */
export function renderMarkdown(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  let listType = null; // 'ul' | 'ol' | null
  let tableRows = [];  // accumulate table rows

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };

  const flushTable = () => {
    if (!tableRows.length) return;
    const headerRow = tableRows[0];
    // Second row should be separator (---|---|---), skip it
    const bodyRows = tableRows.length > 2 ? tableRows.slice(2) : [];

    const thStyle = 'padding:4px 10px;font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-primary);text-align:left;border-bottom:1px solid rgba(255,255,255,0.12);white-space:nowrap;';
    const tdStyle = 'padding:4px 10px;font-size:var(--font-xs);color:var(--color-text-secondary);border-bottom:1px solid rgba(255,255,255,0.05);';

    const renderCells = (row, tag, style) => {
      const cells = row.split('|').map(c => c.trim()).filter(c => c !== '');
      return cells.map(c => `<${tag} style="${style}">${inlineFormat(c)}</${tag}>`).join('');
    };

    let html = '<div style="overflow-x:auto;margin:var(--space-2) 0;"><table style="width:100%;border-collapse:collapse;font-size:var(--font-xs);">';
    html += `<thead><tr>${renderCells(headerRow, 'th', thStyle)}</tr></thead>`;
    if (bodyRows.length) {
      html += '<tbody>';
      for (const row of bodyRows) {
        html += `<tr>${renderCells(row, 'td', tdStyle)}</tr>`;
      }
      html += '</tbody>';
    }
    html += '</table></div>';
    out.push(html);
    tableRows = [];
  };

  const inlineFormat = (raw) => {
    let s = esc(raw);
    // Bold: **text**
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Strikethrough: ~~text~~
    s = s.replace(/~~(.+?)~~/g, '<del style="opacity:0.6;">$1</del>');
    // Italic: *text* (must run after bold to avoid conflict)
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Inline code: `code`
    s = s.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);border-radius:3px;padding:1px 5px;font-size:0.9em;font-family:monospace;">$1</code>');
    return s;
  };

  for (const line of lines) {
    // Table rows: lines containing | characters (and not just a separator)
    if (/^\|?.+\|.+\|?$/.test(line.trim()) && !/^[\s|:-]+$/.test(line.trim())) {
      closeList();
      tableRows.push(line.trim());
      continue;
    }
    // Table separator row (---|---|---)
    if (/^[\s|:-]+$/.test(line.trim()) && tableRows.length > 0) {
      tableRows.push(line.trim());
      continue;
    }
    // If we were accumulating a table and hit a non-table line, flush it
    flushTable();

    if (/^#{1,3} /.test(line)) {
      closeList();
      const lvl = line.match(/^(#+)/)[1].length;
      const size = lvl === 1 ? 'var(--font-base)' : 'var(--font-sm)';
      out.push(`<p style="font-weight:var(--weight-semi);color:var(--color-text-primary);font-size:${size};margin:var(--space-2) 0 var(--space-1);">${inlineFormat(line.replace(/^#+\s/, ''))}</p>`);
    } else if (/^(\d+)\. /.test(line)) {
      if (listType !== 'ol') { closeList(); out.push('<ol style="margin:2px 0 2px var(--space-4);padding:0 0 0 var(--space-4);">'); listType = 'ol'; }
      out.push(`<li>${inlineFormat(line.replace(/^\d+\.\s/, ''))}</li>`);
    } else if (/^[*-] /.test(line)) {
      if (listType !== 'ul') { closeList(); out.push('<ul style="margin:2px 0 2px var(--space-4);padding:0;list-style:disc;">'); listType = 'ul'; }
      out.push(`<li>${inlineFormat(line.replace(/^[*-] /, ''))}</li>`);
    } else if (/^-{3,}$/.test(line.trim())) {
      closeList();
      out.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:var(--space-2) 0;">');
    } else if (line.trim() === '') {
      closeList();
      out.push('<br>');
    } else {
      closeList();
      out.push(inlineFormat(line) + '<br>');
    }
  }
  flushTable();
  closeList();
  return out.join('');
}

/**
 * Parse a WebVTT string into an array of timed segments.
 * @param {string} vtt  raw VTT content
 * @returns {Array<{start: number, end: number, text: string}>}
 */
export function parseVTT(vtt) {
  if (!vtt) return [];
  const segments = [];
  const blocks = vtt.replace(/^WEBVTT[^\n]*\n/, '').trim().split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const timeLine = lines.find(l => l.includes('-->'));
    if (!timeLine) continue;
    const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
    const text = lines.slice(lines.indexOf(timeLine) + 1).join(' ').trim();
    if (text) segments.push({ start: _vttToSec(startStr), end: _vttToSec(endStr), text });
  }
  return segments;
}

function _vttToSec(ts) {
  const parts = ts.replace(/,/g, '.').split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}
