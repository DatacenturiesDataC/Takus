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

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };

  const inlineFormat = (raw) => {
    let s = esc(raw);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);border-radius:3px;padding:1px 5px;font-size:0.9em;font-family:monospace;">$1</code>');
    return s;
  };

  for (const line of lines) {
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
