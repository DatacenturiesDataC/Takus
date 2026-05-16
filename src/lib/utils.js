// Takus — Shared Utilities
// Centralised helpers used across multiple components.

// ── Time constants (milliseconds) ──────────────────────────────────────────

/** One hour in milliseconds */
export const MS_PER_HOUR = 60 * 60 * 1000;

/** One day in milliseconds */
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** One week in milliseconds */
export const MS_PER_WEEK = 7 * MS_PER_DAY;

// ── String helpers ─────────────────────────────────────────────────────────

/**
 * Extract initials from a name, with optional email fallback.
 * @param {string} [name]
 * @param {string} [email]
 * @returns {string}
 */
export function getInitials(name, email) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return '?';
}

// ── Date / time formatting ───────────────────────────────────────────────────

/**
 * Format seconds into a compact M:SS string (e.g. 3:05).
 * @param {number} sec
 * @returns {string}
 */
export function fmtTimestamp(sec) {
  if (!sec || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Format a date value into a short human-readable string (e.g. "Jan 5").
 * @param {number|string|Date} dateVal
 * @returns {string}
 */
export function shortDate(dateVal) {
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Format a date value into a long human-readable string (e.g. "January 5, 2026").
 * Used for external-facing shared summaries.
 * @param {number|string|Date} dateVal
 * @returns {string}
 */
export function longDate(dateVal) {
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Format a date/time value into a short time string (e.g. "14:05" or "2:05 PM").
 * Uses the user's locale for 12/24-hour format.
 * @param {number|string|Date} dateVal
 * @returns {string}
 */
export function shortTime(dateVal) {
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

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
 * Format a date/timestamp into a human-friendly relative time string.
 * @param {Date|number} dateVal - Date object or timestamp
 * @returns {string}
 */
export function timeAgo(dateVal) {
  const date = dateVal instanceof Date ? dateVal : new Date(dateVal);
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return date.toLocaleDateString();
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

// ── Browser capability checks ──────────────────────────────────────────────

/**
 * Returns a browser compatibility descriptor for screen capture.
 * Screen capture requires getDisplayMedia, which is unavailable on:
 *  - iOS (all browsers — Apple restricts the API)
 *  - Android (most browsers except Chrome/Edge on Android 11+, still limited)
 *  - Very old desktop browsers
 */
function _getCompatInfo() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const hasDisplayMedia = typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  const hasMediaRecorder = typeof MediaRecorder !== 'undefined';

  if (isIOS) {
    return { supported: false, reason: 'iOS does not support screen recording in the browser. Please use a Mac, Windows, or Linux desktop browser.' };
  }
  if (isAndroid && !hasDisplayMedia) {
    return { supported: false, reason: 'Screen recording is not supported in this Android browser. Try Chrome on a desktop device.' };
  }
  if (!hasDisplayMedia) {
    return { supported: false, reason: 'Your browser does not support screen capture. Please use Chrome, Edge, or Firefox on a desktop.' };
  }
  if (!hasMediaRecorder) {
    return { supported: false, reason: 'Your browser does not support the MediaRecorder API required for recording. Please update your browser.' };
  }
  return { supported: true, isMobile: isIOS || isAndroid };
}

/**
 * Whether the current browser/device can record the screen.
 * @returns {boolean}
 */
export function isScreenCaptureSupported() {
  return _getCompatInfo().supported;
}

/**
 * Returns a short platform label (e.g. "Windows", "macOS", "Linux").
 * Used for the Device tag in recording history.
 * @returns {string}
 */
export function deviceName() {
  const p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (p.includes('win')) return 'Windows';
  if (p.includes('mac')) return 'macOS';
  if (p.includes('linux')) return 'Linux';
  if (p.includes('iphone') || p.includes('ipad') || p.includes('ios')) return 'iOS';
  if (p.includes('android')) return 'Android';
  return 'Web';
}
