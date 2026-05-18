// Takus — History Panel: Entry Item Template
// Extracted from history-panel.js
// Pure template function — no side effects, no DOM manipulation.

import { icons } from '../../lib/icons.js';
import { esc, renderMarkdown, parseVTT } from '../../lib/utils.js';
import { formatDuration, formatSize } from '../../lib/recorder.js';

import {
  typeBadge,
  archiveBadge,
  stateBadge,
  tldwStrip,
  metaTags,
  highlight,
  timeAgo,
  renderTranscriptViewer,
} from '../history-utils.js';

/**
 * Render a single history entry item as HTML.
 *
 * @param {object} r - Entry object
 * @param {string} searchQ - Current search query for highlighting
 * @param {boolean} selectMode - Whether batch selection mode is active
 * @param {Set<string>} selectedIds - Currently selected entry IDs
 * @param {string} activeTagFilter - Active tag filter value
 * @returns {string} HTML for one history-item card
 */
export function renderHistoryItem(r, searchQ, selectMode, selectedIds, activeTagFilter) {
  const date = new Date(r.date);
  const ago = timeAgo(date);
  const isRaw = r.state === 'raw';
  const isProcessing = r.state === 'processing';
  const rawStyle = isRaw ? 'opacity:0.55;border-left:3px solid var(--color-warning);' : '';
  const processingStyle = isProcessing ? 'opacity:0.7;border-left:3px solid var(--color-primary);' : '';
  return `
    <div class="history-item" data-id="${r.id}" style="display:flex; flex-direction:column; gap:var(--space-2); ${rawStyle}${processingStyle}">
      ${isRaw ? `<div style="display:flex;align-items:center;gap:var(--space-2);padding:4px 8px;background:rgba(245,158,11,0.08);border-radius:var(--radius-sm);margin-bottom:var(--space-1);">
        <span style="font-size:var(--font-xs);color:var(--color-warning);font-weight:600;">📥 Inbox</span>
        <span style="font-size:10px;color:var(--color-text-muted);">Not yet processed by AI</span>
        <button class="btn btn-sm history-process-raw" data-id="${r.id}" style="margin-left:auto;font-size:11px;padding:2px 10px;background:var(--color-warning);color:#000;border-radius:var(--radius-sm);font-weight:600;border:none;cursor:pointer;">${icons.zap(12)} Process</button>
      </div>` : ''}
      ${isProcessing ? `<div style="display:flex;align-items:center;gap:var(--space-2);padding:4px 8px;background:rgba(99,102,241,0.08);border-radius:var(--radius-sm);margin-bottom:var(--space-1);">
        <span style="font-size:var(--font-xs);color:var(--color-primary-light);font-weight:600;">⏳ Processing…</span>
        <span style="font-size:10px;color:var(--color-text-muted);">AI pipeline running</span>
      </div>` : ''}
      <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
        <div style="display:flex; align-items:center; gap:var(--space-3); min-width:0;">
          <input type="checkbox" class="batch-cb" data-id="${r.id}" style="display:${selectMode ? 'block' : 'none'};accent-color:var(--color-primary);width:16px;height:16px;cursor:pointer;flex-shrink:0;" ${selectedIds.has(r.id) ? 'checked' : ''} />
          <div class="history-icon">${isRaw ? icons.info(16) : icons.video(16)}</div>
          <div class="history-info" style="min-width:0;" title="Click to open · Double-click to rename">
            <div class="flex-center gap-2 flex-wrap">
              <div class="history-title">${highlight(r.title || 'Untitled', searchQ)}</div>
              ${typeBadge(r.type)}
              ${stateBadge(r)}
            </div>
            <div class="history-meta">${ago} · ${formatDuration(r.duration)} · ${formatSize(r.size)}${archiveBadge(r)}</div>
            ${metaTags(r)}
          </div>
        </div>
        <div class="history-actions" style="flex-shrink:0;">
          ${r.aiSummary ? `<button class="btn btn-ghost btn-icon btn-sm history-summary-toggle" title="View AI Summary" aria-label="View AI Summary" data-target="${r.id}">${icons.zap(14)}</button>` : ''}
          ${r.aiSummary ? `<button class="btn btn-ghost btn-icon btn-sm history-share-link" title="Copy shareable summary link" aria-label="Copy shareable link" data-id="${r.id}">${icons.send(14)}</button>` : ''}
          ${r.aiSummary ? `<button class="btn btn-ghost btn-icon btn-sm history-qr-link" title="Show QR code" aria-label="Show QR code for shareable link" data-id="${r.id}">${icons.qrCode(14)}</button>` : ''}
          <button class="btn btn-ghost btn-icon btn-sm history-watch" title="Watch entry" aria-label="Watch entry" data-id="${r.id}">${icons.play(14)}</button>
          <button class="btn btn-ghost btn-icon btn-sm history-note-btn ${r.notes ? 'has-note' : ''}" title="${r.notes ? 'Edit notes' : 'Add notes'}" aria-label="${r.notes ? 'Edit notes' : 'Add notes'}" data-id="${r.id}">${icons.edit(14)}</button>
          ${(r.participants?.length) ? `<button class="btn btn-ghost btn-icon btn-sm history-share" title="Share with participants" aria-label="Share with participants" data-id="${r.id}">${icons.users(14)}</button>` : ''}
          ${(r.aiDocLink && r.aiDocLink.startsWith('https://')) ? `<a href="${esc(r.aiDocLink)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-icon btn-sm" title="Open meeting notes" aria-label="Open meeting notes">${icons.info(14)}</a>` : ''}
          ${(r.driveLink && r.driveLink.startsWith('https://')) ? `
            <button class="btn btn-ghost btn-icon btn-sm history-copy-link" title="Copy cloud link" aria-label="Copy cloud link" data-link="${esc(r.driveLink)}">${icons.link(14)}</button>
            <a href="${esc(r.driveLink)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-icon btn-sm" title="Open in cloud" aria-label="Open in cloud">${icons.externalLink(14)}</a>
          ` : ''}
          <button class="btn btn-ghost btn-icon btn-sm history-tag-btn ${r.tags?.length ? 'has-tags' : ''}" title="Edit tags" aria-label="Edit tags" data-id="${r.id}">${icons.tag(14)}</button>
          <button class="btn btn-ghost btn-icon btn-sm history-archive" data-id="${r.id}" title="${r.archiveStatus === 'archived' ? 'View archive' : 'Archive entry'}" aria-label="Archive action" style="display:none;">${icons.download(14)}</button>
          ${r.archiveStatus === 'archived' ? `<button class="btn btn-ghost btn-icon btn-sm history-restore" data-id="${r.id}" title="Restore from cloud" aria-label="Restore archived entry" style="display:none;">${icons.refresh(14)}</button>` : ''}
          <button class="btn btn-ghost btn-icon btn-sm history-pin ${r.pinned ? 'pinned' : ''}" title="${r.pinned ? 'Unpin entry' : 'Pin to top'}" aria-label="${r.pinned ? 'Unpin entry' : 'Pin entry to top'}" data-id="${r.id}">${icons.star(14)}</button>
          <button class="btn btn-ghost btn-icon btn-sm history-delete" title="Delete" aria-label="Delete entry" data-id="${r.id}">${icons.trash(14)}</button>
        </div>
      </div>
      ${r.tags?.length ? `<div class="history-tag-row">${r.tags.map(t => `<button class="history-tag-chip${activeTagFilter === t ? ' active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      <div class="history-tag-editor hidden" data-id="${r.id}">
        <input type="text" class="input history-tag-input" placeholder="Add tags, comma-separated (e.g. sprint, bug, Q2)…" value="${esc((r.tags || []).join(', '))}" data-id="${r.id}" />
      </div>
      <div class="history-note-area" data-id="${r.id}">
        ${r.notes ? `<div class="history-note-preview" data-id="${r.id}">${renderMarkdown(r.notes)}</div>` : ''}
        <textarea class="history-note-textarea hidden" data-id="${r.id}" placeholder="Add notes… (markdown supported)" rows="3">${esc(r.notes || '')}</textarea>
      </div>
      ${tldwStrip(r)}
      ${r.aiSummary ? `
      <div class="ai-summary-box hidden" data-id="${r.id}" style="background:rgba(255,255,255,0.03); border-radius:var(--radius-md); padding:var(--space-3); margin-top:var(--space-2); font-size:var(--font-sm); color:var(--color-text-secondary); border:1px solid rgba(255,255,255,0.05);">
        <!-- Tab bar -->
        <div class="flex-between gap-2" style="margin-bottom:var(--space-2);">
          <div style="display:flex;gap:2px;">
            <button class="ai-tab active" data-tab="summary" data-id="${r.id}" style="font-size:var(--font-xs);padding:3px 10px;border-radius:6px 6px 0 0;border:none;cursor:pointer;background:rgba(255,255,255,0.08);color:var(--color-primary-light);font-weight:var(--weight-semi);">${icons.zap(12)} Summary</button>
            ${r.aiVtt || r.textContent ? `<button class="ai-tab" data-tab="transcript" data-id="${r.id}" style="font-size:var(--font-xs);padding:3px 10px;border-radius:6px 6px 0 0;border:none;cursor:pointer;background:transparent;color:var(--color-text-muted);font-weight:var(--weight-semi);">${icons.info(12)} Transcript</button>` : ''}
            <button class="ai-tab" data-tab="tasks" data-id="${r.id}" style="font-size:var(--font-xs);padding:3px 10px;border-radius:6px 6px 0 0;border:none;cursor:pointer;background:transparent;color:var(--color-text-muted);font-weight:var(--weight-semi);">${icons.checkSquare(12)} Tasks<span class="task-badge-slot" data-entry-id="${r.id}"></span></button>
          </div>
          <div style="display:flex;gap:var(--space-1);">
            <button class="btn btn-ghost btn-sm history-copy-summary" data-id="${r.id}" title="Copy summary">${icons.link(14)} Copy</button>
            ${r.textContent ? `<button class="btn btn-ghost btn-sm history-download-md" data-id="${r.id}" title="Download as Markdown">${icons.download(14)} .md</button>` : ''}
            ${r.aiVtt ? `<button class="btn btn-ghost btn-sm history-download-vtt" data-id="${r.id}" title="Download subtitles (.vtt)">${icons.download(14)} .vtt</button>` : ''}
          </div>
        </div>
        <!-- Tab content -->
        <div class="ai-tab-content" data-tab="summary" data-id="${r.id}" style="line-height:1.6;">${renderMarkdown(r.aiSummary)}</div>
        ${r.aiVtt || r.textContent ? `<div class="ai-tab-content hidden" data-tab="transcript" data-id="${r.id}">${r.aiVtt ? renderTranscriptViewer(parseVTT(r.aiVtt), r.id) : `<p style="font-size:var(--font-xs);color:var(--color-text-secondary);white-space:pre-wrap;line-height:1.6;">${esc(r.textContent)}</p>`}</div>` : ''}
        <div class="ai-tab-content hidden" data-tab="tasks" data-id="${r.id}"></div>
        <div class="related-slot" data-id="${r.id}" style="display:none;margin-top:var(--space-2);padding-top:var(--space-2);border-top:1px solid rgba(255,255,255,0.05);"></div>
      </div>
      ` : ''}
    </div>`;
}

/**
 * Build HTML for a list of history items.
 * Returns a no-match message if list is empty.
 *
 * @param {object[]} list - Filtered/sorted entry list
 * @param {string} searchQ - Search query for highlighting
 * @param {boolean} selectMode - Batch select mode active
 * @param {Set<string>} selectedIds - Currently selected entry IDs
 * @param {string} activeTagFilter - Active tag filter
 * @returns {string} Combined HTML
 */
export function buildHistoryItems(list, searchQ, selectMode, selectedIds, activeTagFilter) {
  if (!list.length) {
    return `<div style="padding:var(--space-4);text-align:center;font-size:var(--font-sm);color:var(--color-text-muted);">No entries match your search.</div>`;
  }
  return list.map(r => renderHistoryItem(r, searchQ, selectMode, selectedIds, activeTagFilter)).join('');
}
