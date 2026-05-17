// Takus — Recording Detail View (Phase 14c: FOCUS)
// 70/30 split layout: left pane (Ask, Summary, Transcript, Tasks) · right pane (video, metadata, downloads)
import { icons } from '../lib/icons.js';
import { esc, renderMarkdown, parseVTT, fmtTimestamp, shortTime } from '../lib/utils.js';
import { getMediaBlob, getAllEmbeddings, getEntries, saveEntry, deleteEntry, deleteEntryBlob, deleteEmbeddings, removeEdgesForNode, getEdgesFromNode, saveEngagementEvent, removeInteractionsForEntry, removeContentItemsForEntry, removeVaultSync } from '../lib/storage.js';
import { recordSignal } from '../lib/preference-engine.js';
import { typeLabel, typeAccent } from './type-picker.js';
import { renderTasksPanel } from './tasks-panel.js';
import { formatDuration, formatSize } from '../lib/recorder.js';
import { extractTLDW, parseChapters } from '../lib/analytics.js';
import { semanticSearch, cosineSimilarity } from '../lib/embeddings.js';
import { meanVector } from '../lib/graph/vector-utils.js';
import { generateAnswer } from '../lib/ai-engine.js';
import { getSettings } from '../lib/settings-store.js';
import { getEdgeTypeConfig } from '../lib/edge-types.js';
import { OPEN_RECORDING } from '../lib/events.js';
import { togglePin } from '../lib/archive-engine.js';
import { toast } from './toast.js';



/**
 * Render a full recording detail view with 70/30 split layout.
 * @param {HTMLElement} container
 * @param {object} recording  Full recording object from IndexedDB
 * @param {Function} onBack   Called when user clicks "Back"
 * @param {Function} onUpdate Called with updated recording after changes
 */
export async function renderEntryDetail(container, recording, onBack, onUpdate) {
  const rec = recording;
  const accent = typeAccent(rec.type || 'screen');
  const dateStr = new Date(rec.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = shortTime(rec.date);
  const hasSummary = !!(rec.aiSummary || rec.aiTranscript);
  const hasTranscript = !!(rec.aiVtt || rec.aiTranscript);
  const chapters = hasSummary ? parseChapters(rec.aiSummary) : [];
  const tldw = hasSummary ? extractTLDW(rec.aiSummary) : '';
  const tags = rec.tags || [];
  const qualityScore = rec.qualityScore || null;
  const calEvent = rec.calendarEvent || null;
  const participants = rec.participants || calEvent?.attendees || [];

  // Load VTT segments for transcript viewer
  const vttSegments = rec.aiVtt ? parseVTT(rec.aiVtt) : [];

  // Check if this recording has embeddings
  let hasEmbeddings = false;
  try {
    const allEmb = await getAllEmbeddings();
    hasEmbeddings = allEmb.some(e => e.contentId === rec.id && e.chunks?.length > 0);
  } catch {}

  // Default active tab
  let activeTab = hasSummary ? 'summary' : (hasEmbeddings ? 'ask' : 'summary');

  // Record VIEW engagement event (best-effort, non-blocking)
  saveEngagementEvent({
    contentId: rec.id,
    contactId: null, // current user — not a specific contact
    type: 'VIEW',
    timestamp: Date.now(),
  }).catch(() => {});

  container.innerHTML = `
    <div class="entry-detail animate-in">
      <!-- Header -->
      <div class="rd-header">
        <button class="btn btn-ghost btn-sm" id="rd-back" aria-label="Back to list">
          ${icons.arrowLeft(14)} Back
        </button>
        <div class="rd-title-area">
          <span class="rd-type-badge" style="color:${accent};">${typeLabel(rec.type || 'screen')}</span>
          <h2 class="rd-title">${esc(rec.title || 'Untitled Recording')}</h2>
          <span class="rd-meta">${dateStr} · ${timeStr}${rec.duration ? ` · ${formatDuration(rec.duration)}` : ''}</span>
        </div>
      </div>

      <!-- Split layout -->
      <div class="rd-split">
        <!-- Left pane (70%) -->
        <div class="rd-left">
          <div class="rd-tabs" role="tablist">
            ${hasEmbeddings ? `<button class="rd-tab ${activeTab === 'ask' ? 'active' : ''}" data-rd-tab="ask" role="tab">${icons.search(12)} Ask</button>` : ''}
            <button class="rd-tab ${activeTab === 'summary' ? 'active' : ''}" data-rd-tab="summary" role="tab">${icons.edit(12)} Summary</button>
            ${hasTranscript ? `<button class="rd-tab ${activeTab === 'transcript' ? 'active' : ''}" data-rd-tab="transcript" role="tab">${icons.mic(12)} Transcript</button>` : ''}
            <button class="rd-tab" data-rd-tab="tasks" role="tab">${icons.zap(12)} Tasks</button>
          </div>
          <div class="rd-content" id="rd-content"></div>
        </div>

        <!-- Right pane (30%) -->
        <div class="rd-right">
          <!-- Video player -->
          <div class="rd-video-wrapper" id="rd-video-slot">
            <div style="display:flex;align-items:center;justify-content:center;height:180px;background:rgba(0,0,0,0.3);border-radius:var(--radius-md);color:var(--color-text-disabled);font-size:var(--font-xs);">
              ${icons.video(24)}
            </div>
          </div>

          ${calEvent ? `
          <!-- Calendar Event -->
          <div class="rd-section">
            <div class="rd-section-label">${icons.calendar(11)} Linked Event</div>
            <div style="font-size:var(--font-sm);color:var(--color-text-primary);font-weight:var(--weight-semi);">${esc(calEvent.summary || 'Calendar Event')}</div>
            ${calEvent.organizer ? `<div style="font-size:10px;color:var(--color-text-muted);margin-top:2px;">Organized by ${esc(calEvent.organizer)}</div>` : ''}
          </div>` : ''}

          ${participants.length ? `
          <!-- Participants -->
          <div class="rd-section">
            <div class="rd-section-label">${icons.users(11)} Participants (${participants.length})</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">
              ${participants.slice(0, 8).map(p => {
                const name = typeof p === 'string' ? p : (p.name || p.displayName || p.email || 'Unknown');
                const initial = name.charAt(0).toUpperCase();
                return `<span class="rd-participant" title="${esc(name)}">${initial}</span>`;
              }).join('')}
              ${participants.length > 8 ? `<span class="rd-participant" style="background:rgba(255,255,255,0.06);">+${participants.length - 8}</span>` : ''}
            </div>
          </div>` : ''}

          ${(calEvent && (rec.type === 'meeting' || participants.length)) ? `
          <!-- Meeting Context (lazy-loaded) -->
          <div class="rd-section" id="rd-meeting-prep-slot" style="display:none;">
            <div class="rd-section-label">${icons.zap(11)} Meeting Context</div>
            <div id="rd-meeting-prep-content" style="font-size:var(--font-xs);color:var(--color-text-secondary);">Loading…</div>
          </div>` : ''}

          <!-- Tags -->
          <div class="rd-section">
            <div class="rd-section-label">${icons.tag ? icons.tag(11) : '🏷'} Tags</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;" id="rd-tags">
              ${tags.length ? tags.map(t => `<span class="rd-tag">${esc(t)}</span>`).join('') : '<span style="font-size:var(--font-xs);color:var(--color-text-disabled);">No tags</span>'}
            </div>
          </div>

          <!-- Notes -->
          <div class="rd-section">
            <div class="rd-section-label">${icons.edit(11)} Notes</div>
            <textarea id="rd-notes" class="input" rows="3" placeholder="Add notes…" style="font-size:var(--font-xs);resize:vertical;min-height:48px;">${esc(rec.notes || '')}</textarea>
          </div>

          ${qualityScore !== null ? `
          <!-- Quality Score -->
          <div class="rd-section">
            <div class="rd-section-label">${icons.barChart(11)} Quality Score</div>
            <div style="display:flex;align-items:center;gap:var(--space-2);">
              <div style="flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">
                <div style="height:100%;width:${qualityScore}%;background:${qualityScore >= 70 ? 'var(--color-success)' : qualityScore >= 40 ? 'var(--color-warning)' : 'var(--color-danger)'};border-radius:3px;transition:width 0.3s;"></div>
              </div>
              <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);">${qualityScore}%</span>
            </div>
          </div>` : ''}

          <!-- Downloads -->
          <div class="rd-section">
            <div class="rd-section-label">${icons.download(11)} Downloads</div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              <button class="btn btn-ghost btn-sm rd-dl-btn" id="rd-dl-video" style="justify-content:flex-start;">${icons.video(12)} Video (.webm)${rec.size ? ` · ${formatSize(rec.size)}` : ''}</button>
              ${hasSummary ? `<button class="btn btn-ghost btn-sm rd-dl-btn" id="rd-dl-summary" style="justify-content:flex-start;">${icons.edit(12)} Summary (.md)</button>` : ''}
              ${hasTranscript ? `<button class="btn btn-ghost btn-sm rd-dl-btn" id="rd-dl-transcript" style="justify-content:flex-start;">${icons.mic(12)} Transcript (.vtt)</button>` : ''}
            </div>
          </div>

          ${rec.size ? `
          <!-- Info -->
          <div class="rd-section" style="border:none;">
            <div style="font-size:10px;color:var(--color-text-disabled);display:flex;flex-direction:column;gap:2px;">
              <span>Size: ${formatSize(rec.size)}</span>
              ${rec.duration ? `<span>Duration: ${formatDuration(rec.duration)}</span>` : ''}
              <span>ID: ${esc(rec.id?.slice(0, 8) || '—')}</span>
              ${rec.driveLink ? `<a href="${esc(rec.driveLink)}" target="_blank" rel="noopener" style="color:var(--color-primary-light);text-decoration:none;display:inline-flex;align-items:center;gap:3px;margin-top:2px;">${icons.link(10)} Open in Drive</a>` : ''}
              ${rec.aiDocLink ? `<a href="${esc(rec.aiDocLink)}" target="_blank" rel="noopener" style="color:var(--color-primary-light);text-decoration:none;display:inline-flex;align-items:center;gap:3px;">${icons.edit(10)} View AI Doc</a>` : ''}
            </div>
          </div>` : ''}

          <!-- Linked Goals (populated async) -->
          <div class="rd-section" id="rd-goals-slot" style="display:none;">
            <div class="rd-section-label">🎯 Linked Goals</div>
            <div id="rd-goals-list" style="display:flex;flex-direction:column;gap:4px;"></div>
          </div>

          <!-- Knowledge Connections (populated async) -->
          <div class="rd-section" id="rd-connections-slot" style="display:none;">
            <div class="rd-section-label">${icons.link(11)} Connections</div>
            <div id="rd-connections-list" style="display:flex;flex-direction:column;gap:4px;"></div>
          </div>

          <!-- Related Recordings (populated async) -->
          <div class="rd-section" id="rd-related-slot" style="display:none;">
            <div class="rd-section-label">${icons.arrowRight(11)} Related</div>
            <div id="rd-related-list" style="display:flex;flex-direction:column;gap:4px;"></div>
          </div>

          ${rec.archiveLog?.length ? `
          <!-- Archive Audit Trail -->
          <div class="rd-section">
            <div class="rd-section-label">${icons.download(11)} Archive History</div>
            <div style="display:flex;flex-direction:column;gap:2px;">
              ${rec.archiveLog.map(entry => {
                const time = new Date(entry.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                const statusColors = {
                  active: 'var(--color-success)',
                  pending: 'var(--color-warning)',
                  archived: '#8b5cf6',
                  cold: '#6366f1',
                  restored: '#22d3ee',
                };
                const color = statusColors[entry.status] || 'var(--color-text-muted)';
                return `<div style="display:flex;align-items:center;gap:var(--space-2);padding:3px 0;font-size:10px;">
                  <span style="width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0;"></span>
                  <span style="color:${color};font-weight:600;min-width:60px;">${esc(entry.status)}</span>
                  <span style="color:var(--color-text-disabled);flex:1;">${entry.reason ? esc(entry.reason) : ''}</span>
                  <span style="color:var(--color-text-disabled);flex-shrink:0;">${time}</span>
                </div>`;
              }).join('')}
            </div>
          </div>` : ''}

          ${rec.pipelineRun?.steps?.length ? `
          <!-- Pipeline Steps -->
          <div class="rd-section">
            <details>
              <summary class="rd-section-label" style="cursor:pointer;user-select:none;">⚡ Pipeline Steps
                <span style="font-size:10px;font-weight:400;color:${rec.pipelineRun.status === 'done' ? 'var(--color-success)' : rec.pipelineRun.status === 'failed' ? 'var(--color-danger)' : 'var(--color-warning)'};">
                  ${rec.pipelineRun.status}${rec.pipelineRun.durationMs ? ` · ${Math.round(rec.pipelineRun.durationMs / 1000)}s` : ''}
                </span>
              </summary>
              <div style="display:flex;flex-direction:column;gap:2px;margin-top:var(--space-1);">
                ${rec.pipelineRun.steps.map(s => {
                  const icon = s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : s.status === 'running' ? '⏳' : '○';
                  const color = s.status === 'done' ? 'var(--color-success)' : s.status === 'failed' ? 'var(--color-danger)' : s.status === 'running' ? 'var(--color-warning)' : 'var(--color-text-disabled)';
                  const dur = s.startedAt && s.completedAt ? `${Math.round((s.completedAt - s.startedAt) / 1000)}s` : '';
                  return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:10px;">
                    <span style="color:${color};font-weight:600;width:12px;text-align:center;flex-shrink:0;">${icon}</span>
                    <span style="color:var(--color-text-secondary);flex:1;">${esc(s.label)}</span>
                    ${dur ? `<span style="color:var(--color-text-disabled);">${dur}</span>` : ''}
                    ${s.error ? `<span style="color:var(--color-danger);font-size:9px;" title="${esc(s.error)}">error</span>` : ''}
                  </div>`;
                }).join('')}
                ${rec.pipelineRun.status === 'failed' ? `
                <button class="btn btn-sm rd-pipeline-retry" data-id="${rec.id}" style="margin-top:var(--space-1);font-size:10px;padding:3px 10px;background:var(--color-warning);color:#000;border:none;border-radius:var(--radius-sm);font-weight:600;cursor:pointer;align-self:flex-start;">
                  ↻ Retry Pipeline
                </button>` : ''}
              </div>
            </details>
          </div>` : ''}

          <!-- Actions -->
          <div class="rd-section" style="border:none;">
            <div class="rd-section-label">${icons.zap(11)} Actions</div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              <button class="btn btn-ghost btn-sm rd-dl-btn" id="rd-action-pin" style="justify-content:flex-start;">
                ${icons.star(12)} <span>${rec.pinned ? 'Unpin recording' : 'Pin to top'}</span>
              </button>
              <button class="btn btn-ghost btn-sm rd-dl-btn" id="rd-action-delete" style="justify-content:flex-start;color:var(--color-danger);">
                ${icons.trash(12)} Delete recording
              </button>
              <button class="btn btn-ghost btn-sm rd-dl-btn" id="rd-action-archive" style="justify-content:flex-start;display:none;">
                ${icons.download(12)} <span>${rec.archiveStatus === 'archived' ? 'View archive' : 'Archive recording'}</span>
              </button>
              ${rec.archiveStatus === 'archived' ? `<button class="btn btn-ghost btn-sm rd-dl-btn" id="rd-action-restore" style="justify-content:flex-start;display:none;">
                ${icons.refresh(12)} <span>Restore from cloud</span>
              </button>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>`;

  // ── Event bindings ────────────────────────────────────────────────────────

  // Back button
  container.querySelector('#rd-back')?.addEventListener('click', onBack);

  // Meeting Context — lazy load meeting-prep data
  const prepSlot = container.querySelector('#rd-meeting-prep-slot');
  if (prepSlot && calEvent) {
    import('../lib/meeting-prep.js').then(async ({ generateMeetingPrep }) => {
      try {
        const prep = await generateMeetingPrep(calEvent);
        const parts = [];
        if (prep.previousMeetings.length) {
          parts.push(`<div style="margin-bottom:6px;"><strong>${prep.previousMeetings.length}</strong> previous meeting${prep.previousMeetings.length > 1 ? 's' : ''} with these participants</div>`);
          parts.push(prep.previousMeetings.map(m =>
            `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;" class="rd-prep-meeting" data-id="${m.id}">
              ${icons.video(10)}
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(m.title)}</span>
              <span style="color:var(--color-text-disabled);font-size:10px;">${new Date(m.date).toLocaleDateString()}</span>
            </div>`
          ).join(''));
        }
        if (prep.openTasks.length) {
          parts.push(`<div style="margin-top:8px;margin-bottom:4px;"><strong>${prep.openTasks.length}</strong> open task${prep.openTasks.length > 1 ? 's' : ''}</div>`);
          parts.push(prep.openTasks.slice(0, 5).map(t =>
            `<div style="padding:2px 0;display:flex;gap:4px;">
              <span style="color:var(--color-warning);">○</span>
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.text)}</span>
            </div>`
          ).join(''));
        }
        if (prep.keyDecisions.length) {
          parts.push(`<div style="margin-top:8px;margin-bottom:4px;"><strong>${prep.keyDecisions.length}</strong> key decision${prep.keyDecisions.length > 1 ? 's' : ''}</div>`);
          parts.push(prep.keyDecisions.slice(0, 5).map(d =>
            `<div style="padding:2px 0;display:flex;gap:4px;">
              <span style="color:var(--color-success);">✓</span>
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(d.decision)}</span>
            </div>`
          ).join(''));
        }
        if (parts.length === 0) {
          parts.push('<span style="color:var(--color-text-disabled);">No related context found</span>');
        }
        container.querySelector('#rd-meeting-prep-content').innerHTML = parts.join('');
        prepSlot.style.display = '';

        // Navigate to related recording on click
        prepSlot.querySelectorAll('.rd-prep-meeting').forEach(el => {
          el.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent(OPEN_RECORDING, { detail: { id: el.dataset.id } }));
          });
        });
      } catch { prepSlot.style.display = 'none'; }
    }).catch(() => {});
  }

  // Tab switching
  const tabBar = container.querySelector('.rd-tabs');
  const contentSlot = container.querySelector('#rd-content');

  function switchTab(tabId) {
    activeTab = tabId;
    tabBar.querySelectorAll('.rd-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.rdTab === tabId);
    });
    _renderTabContent(contentSlot, tabId, rec, onUpdate, hasEmbeddings, vttSegments, chapters, tldw);
  }

  tabBar?.addEventListener('click', (e) => {
    const tab = e.target.closest('.rd-tab');
    if (tab) switchTab(tab.dataset.rdTab);
  });

  // Render initial tab content
  switchTab(activeTab);

  // Load video into right pane
  const videoSlot = container.querySelector('#rd-video-slot');
  try {
    const blob = await getMediaBlob(rec.id);
    if (blob && videoSlot) {
      const url = URL.createObjectURL(blob);
      videoSlot.innerHTML = `<video id="rd-video" src="${url}" controls preload="metadata" style="width:100%;border-radius:var(--radius-md);background:#000;max-height:220px;"></video>`;

      // Record PLAY engagement event on first play
      const videoEl = videoSlot.querySelector('#rd-video');
      if (videoEl) {
        videoEl.addEventListener('play', function _onPlay() {
          videoEl.removeEventListener('play', _onPlay);
          saveEngagementEvent({
            contentId: rec.id,
            contactId: null,
            type: 'PLAY',
            timestamp: Date.now(),
          }).catch(() => {});
        });
      }

      // Clean up blob URL when detail view is removed
      const observer = new MutationObserver(() => {
        if (!document.contains(videoSlot)) {
          URL.revokeObjectURL(url);
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  } catch {}

  // Download buttons
  container.querySelector('#rd-dl-video')?.addEventListener('click', async () => {
    try {
      const blob = await getMediaBlob(rec.id);
      if (!blob) { toast.warning('No video', 'Recording blob not found.'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${rec.title || 'recording'}.webm`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success('Downloaded', 'Video saved');
    } catch (e) { toast.error('Download failed', e.message); }
  });

  container.querySelector('#rd-dl-summary')?.addEventListener('click', () => {
    const md = rec.aiSummary || '';
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${rec.title || 'recording'}-summary.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast.success('Downloaded', 'Summary saved');
  });

  container.querySelector('#rd-dl-transcript')?.addEventListener('click', () => {
    const vtt = rec.aiVtt || rec.aiTranscript || '';
    const blob = new Blob([vtt], { type: 'text/vtt' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${rec.title || 'recording'}-transcript.vtt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast.success('Downloaded', 'Transcript saved');
  });

  // Pin toggle
  container.querySelector('#rd-action-pin')?.addEventListener('click', async () => {
    try {
      await togglePin(rec);
      const pinBtn = container.querySelector('#rd-action-pin');
      if (pinBtn) {
        const label = pinBtn.querySelector('span');
        if (label) label.textContent = rec.pinned ? 'Unpin recording' : 'Pin to top';
      }
      toast.success(rec.pinned ? 'Pinned' : 'Unpinned', rec.pinned ? 'Recording pinned to top of history' : 'Recording unpinned');
      if (onUpdate) onUpdate(rec);
    } catch (e) {
      toast.error('Pin failed', e.message);
    }
  });

  // Delete
  container.querySelector('#rd-action-delete')?.addEventListener('click', async () => {
    if (!confirm(`Delete "${rec.title || 'Untitled'}"? This cannot be undone.`)) return;
    try {
      await Promise.all([
        deleteEntry(rec.id),
        deleteMediaBlob(rec.id),
        deleteEmbeddings(rec.id).catch(() => {}),
        removeEdgesForNode('entry', rec.id).catch(() => {}),
        removeInteractionsForEntry(rec.id).catch(() => {}),
        removeContentItemsForEntry(rec.id).catch(() => {}),
        removeVaultSync(rec.id).catch(() => {}),
      ]);
      toast.info('Deleted', 'Recording removed');
      if (onUpdate) onUpdate(rec);
      if (onBack) onBack();
    } catch (e) {
      toast.error('Delete failed', e.message);
    }
  });

  // Notes auto-save on blur
  const notesTA = container.querySelector('#rd-notes');
  if (notesTA) {
    notesTA.addEventListener('blur', async () => {
      const val = notesTA.value.trim();
      if (val !== (rec.notes || '').trim()) {
        rec.notes = val || '';
        await saveEntry(rec).catch(() => {});
        // Record SUMMARY_EDITED signal for RL preference learning
        recordSignal('SUMMARY_EDITED', {
          contentId: rec.id,
          contentType: rec.type || 'screen',
          notesLength: val.length,
        }).catch(() => {});
        if (onUpdate) onUpdate(rec);
      }
    });
  }

  // Archive action — gated by archiveEngine feature flag
  const archiveBtn = container.querySelector('#rd-action-archive');
  if (archiveBtn) {
    import('../lib/feature-flags.js').then(async ({ isEnabled }) => {
      if (await isEnabled('archiveEngine')) {
        archiveBtn.style.display = '';
      }
    }).catch(() => {});

    archiveBtn.addEventListener('click', async () => {
      try {
        if (rec.archiveStatus === 'archived') {
          // Open archive player for archived recordings
          const { openArchivePlayer } = await import('./archive-player.js');
          openArchivePlayer(rec);
        } else {
          // Trigger archival
          const { archiveRecording } = await import('../lib/archive-engine.js');
          archiveBtn.disabled = true;
          archiveBtn.querySelector('span').textContent = 'Archiving…';
          const result = await archiveRecording(rec.id);
          if (result.success) {
            rec.archiveStatus = 'archived';
            await saveEntry(rec).catch(() => {});
            archiveBtn.querySelector('span').textContent = 'View archive';
            toast.success('Archived', 'Recording archived — video blob freed');
            if (onUpdate) onUpdate(rec);
          } else {
            toast.warning('Not eligible', result.reason || 'Recording cannot be archived yet');
          }
          archiveBtn.disabled = false;
        }
      } catch (e) {
        toast.error('Archive failed', e.message);
        archiveBtn.disabled = false;
      }
    });
  }

  // Restore action — re-download archived recording from cloud
  const restoreBtn = container.querySelector('#rd-action-restore');
  if (restoreBtn) {
    import('../lib/feature-flags.js').then(async ({ isEnabled }) => {
      if (await isEnabled('archiveEngine')) restoreBtn.style.display = '';
    }).catch(() => {});

    restoreBtn.addEventListener('click', async () => {
      if (!confirm(`Restore "${rec.title || 'Untitled'}" from cloud? This will re-download the video.`)) return;
      try {
        const { restoreRecording } = await import('../lib/archive-engine.js');
        restoreBtn.disabled = true;
        restoreBtn.querySelector('span').textContent = 'Restoring…';
        const result = await restoreRecording(rec, (stage, pct) => {
          restoreBtn.querySelector('span').textContent = `${stage} ${Math.round(pct * 100)}%`;
        });
        if (result.success) {
          toast.success('Restored', 'Recording restored from cloud');
          if (onUpdate) onUpdate(rec);
          renderEntryDetail(container, rec, onBack, onUpdate);
        } else {
          toast.warning('Restore failed', result.reason || 'Could not restore recording');
          restoreBtn.querySelector('span').textContent = 'Restore from cloud';
        }
      } catch (e) {
        toast.error('Restore failed', e.message);
        restoreBtn.querySelector('span').textContent = 'Restore from cloud';
      }
      restoreBtn.disabled = false;
    });
  }

  // Pipeline retry button (Phase 46)
  container.querySelector('.rd-pipeline-retry')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const id = btn.dataset.id;
    btn.disabled = true;
    btn.textContent = '⏳ Retrying…';
    try {
      const { retryFailedStep } = await import('../lib/content-pipeline.js');
      await retryFailedStep(id, {
        onComplete: (updated) => {
          // Re-render the detail panel with updated data
          if (onUpdate) onUpdate(updated);
          renderEntryDetail(container, updated, onBack, onUpdate);
        },
      });
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '↻ Retry Pipeline';
    }
  });

  // Async: populate related recordings via cosine similarity
  _populateRelated(container, rec).catch(() => {});
  _populateConnections(container, rec).catch(() => {});
  _populateGoals(container, rec).catch(() => {});
}

async function _populateRelated(container, rec) {
  const allEmb = await getAllEmbeddings().catch(() => []);
  const allRecs = await getEntries().catch(() => []);
  if (allRecs.length < 2) return;

  const scored = new Map(); // contentId → { rec, score, reasons[] }

  // ── Method 1: Embedding similarity ──────────────────────────────────────
  if (allEmb.length >= 2) {
    const srcEntry = allEmb.find(e => e.contentId === rec.id);
    if (srcEntry?.chunks?.length) {
      const srcMean = meanVector(srcEntry.chunks);
      if (srcMean) {
        for (const entry of allEmb) {
          if (entry.contentId === rec.id || !entry.chunks?.length) continue;
          const mean = meanVector(entry.chunks);
          if (!mean) continue;
          const sim = cosineSimilarity(srcMean, mean);
          if (sim > 0.35) {
            const r = allRecs.find(x => x.id === entry.contentId);
            if (r) scored.set(r.id, { rec: r, score: sim, reasons: [`${Math.round(sim * 100)}% similar`] });
          }
        }
      }
    }
  }

  // ── Method 2: Shared participants ───────────────────────────────────────
  const srcAttendees = new Set([
    ...(rec.calendarEvent?.attendees || []),
    ...(rec.participants || []).map(p => typeof p === 'string' ? p : p.email).filter(Boolean),
    ...(rec.aiParticipants?.map(p => p.email).filter(Boolean) || []),
  ].map(e => e.toLowerCase()));

  if (srcAttendees.size > 0) {
    for (const other of allRecs) {
      if (other.id === rec.id) continue;
      const otherAttendees = new Set([
        ...(other.calendarEvent?.attendees || []),
        ...(other.participants || []).map(p => typeof p === 'string' ? p : p.email).filter(Boolean),
        ...(other.aiParticipants?.map(p => p.email).filter(Boolean) || []),
      ].map(e => e.toLowerCase()));

      const shared = [...srcAttendees].filter(e => otherAttendees.has(e));
      if (shared.length > 0) {
        const existing = scored.get(other.id);
        const participantScore = Math.min(0.8, 0.3 + shared.length * 0.15);
        if (existing) {
          existing.score = Math.max(existing.score, participantScore);
          existing.reasons.push(`${shared.length} shared`);
        } else {
          scored.set(other.id, { rec: other, score: participantScore, reasons: [`${shared.length} shared`] });
        }
      }
    }
  }

  // ── Method 3: Knowledge graph edges ─────────────────────────────────────
  try {
    const edges = await getEdgesFromNode('recording', rec.id);
    for (const edge of edges) {
      if (edge.targetType !== 'recording') continue;
      const edgeRec = allRecs.find(r => r.id === edge.targetId);
      if (!edgeRec) continue;
      const existing = scored.get(edge.targetId);
      const edgeScore = edge.metadata?.score || 0.5;
      const label = edge.edgeType === 'SIMILAR_TO' ? 'similar' : edge.edgeType.toLowerCase().replace(/_/g, ' ');
      if (existing) {
        existing.score = Math.max(existing.score, edgeScore);
        existing.reasons.push(label);
      } else {
        scored.set(edge.targetId, { rec: edgeRec, score: edgeScore, reasons: [label] });
      }
    }
  } catch { /* edge store unavailable — graceful degradation */ }

  const related = [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  if (!related.length) return;

  const slot = container.querySelector('#rd-related-slot');
  const list = container.querySelector('#rd-related-list');
  if (!slot || !list) return;

  slot.style.display = '';
  list.innerHTML = related.map(({ rec: r, score, reasons }) => {
    const pct = Math.round(score * 100);
    const accent = typeAccent(r.type || 'screen');
    const reason = reasons.join(' · ');
    return `<button class="btn btn-ghost btn-sm rd-dl-btn rd-related-btn" data-related-id="${esc(r.id)}" style="justify-content:flex-start;gap:8px;">
      <span style="width:6px;height:6px;border-radius:50%;background:${accent};flex-shrink:0;"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;">${esc(r.title || 'Untitled')}</span>
      <span style="font-size:10px;color:var(--color-text-disabled);flex-shrink:0;">${reason}</span>
    </button>`;
  }).join('');

  // Click → navigate to that recording
  list.querySelectorAll('.rd-related-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const relId = btn.dataset.relatedId;
      const relRec = allRecs.find(r => r.id === relId);
      if (relRec) {
        document.dispatchEvent(new CustomEvent(OPEN_RECORDING, { detail: { recording: relRec } }));
      }
    });
  });
}



// ── Tab Content Renderers ──────────────────────────────────────────────────

async function _renderTabContent(container, tabId, rec, onUpdate, hasEmbeddings, vttSegments, chapters, tldw) {
  switch (tabId) {
    case 'ask':     _renderAskTab(container, rec, hasEmbeddings); break;
    case 'summary': await _renderSummaryTab(container, rec, chapters, tldw); break;
    case 'transcript': _renderTranscriptTab(container, rec, vttSegments); break;
    case 'tasks':   renderTasksPanel(container, rec, onUpdate); break;
  }
}

function _renderAskTab(container, rec, hasEmbeddings) {
  if (!hasEmbeddings) {
    container.innerHTML = `
      <div style="padding:var(--space-6);text-align:center;color:var(--color-text-muted);">
        ${icons.search(24)}
        <p style="margin-top:var(--space-2);">Process this recording with AI to enable Ask.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div style="padding:var(--space-3);">
      <div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-3);">
        <input type="text" class="input" id="rd-ask-input" placeholder="Ask about this recording…" autocomplete="off" style="flex:1;" />
        <button class="btn btn-primary btn-sm" id="rd-ask-submit">Ask</button>
      </div>
      <div id="rd-ask-result" style="font-size:var(--font-sm);color:var(--color-text-secondary);"></div>
    </div>`;

  const input = container.querySelector('#rd-ask-input');
  const submitBtn = container.querySelector('#rd-ask-submit');
  const resultDiv = container.querySelector('#rd-ask-result');

  async function doAsk() {
    const q = input?.value?.trim();
    if (!q) return;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<div class="spinner" style="width:12px;height:12px;border-width:2px;"></div>`;

    // Record search signal for RL preference learning
    recordSignal('SEARCH_CLICKED', {
      contentId: rec.id,
      queryLength: q.length,
    }).catch(() => {});
    resultDiv.innerHTML = '<div style="color:var(--color-text-muted);">Thinking…</div>';

    try {
      const settings = getSettings();
      const apiKey = settings.aiProvider === 'gemini' ? settings.geminiKey : settings.openaiKey;
      const provider = settings.aiProvider || 'openai';
      const allEmb = await getAllEmbeddings();
      // Filter to this recording's embeddings only
      const recEmb = allEmb.filter(e => e.contentId === rec.id);
      const topChunks = await semanticSearch(q, recEmb, apiKey, provider, 5);

      if (!topChunks.length) {
        resultDiv.innerHTML = '<div style="color:var(--color-text-muted);">No relevant content found for this query.</div>';
        return;
      }

      const answer = await generateAnswer(q, topChunks, [rec], apiKey, provider);
      resultDiv.innerHTML = renderMarkdown(answer);
    } catch (e) {
      resultDiv.innerHTML = `<div style="color:var(--color-danger);">Error: ${esc(e.message)}</div>`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Ask';
    }
  }

  submitBtn?.addEventListener('click', doAsk);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAsk(); });
}

async function _renderSummaryTab(container, rec, chapters, tldw) {
  if (!rec.aiSummary) {
    container.innerHTML = `
      <div style="padding:var(--space-6);text-align:center;color:var(--color-text-muted);">
        ${icons.edit(24)}
        <p style="margin-top:var(--space-2);">No summary available yet.</p>
        <p style="font-size:var(--font-xs);color:var(--color-text-disabled);">Summary is generated after AI processing completes.</p>
      </div>`;
    return;
  }

  const chaptersHtml = chapters.length ? `
    <div style="margin-bottom:var(--space-3);">
      <div style="font-size:10px;font-weight:var(--weight-semi);color:var(--color-text-disabled);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:var(--space-2);">Chapters</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">
        ${chapters.map((c, i) => `
          <button class="btn btn-ghost btn-sm rd-chapter-btn" data-seconds="${c.seconds}" style="font-size:10px;padding:2px 8px;">
            <span style="color:var(--color-primary-light);font-weight:600;">${i + 1}.</span> ${esc(c.title)} <span style="color:var(--color-text-disabled);font-family:monospace;">${fmtTimestamp(c.seconds)}</span>
          </button>
        `).join('')}
      </div>
    </div>` : '';

  const tldwHtml = tldw ? `
    <div style="background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.15);border-radius:var(--radius-md);padding:var(--space-3);margin-bottom:var(--space-3);">
      <div style="font-size:10px;font-weight:var(--weight-semi);color:var(--color-primary-light);margin-bottom:var(--space-1);">TL;DW</div>
      <div style="font-size:var(--font-sm);color:var(--color-text-secondary);line-height:1.6;">${esc(tldw)}</div>
    </div>` : '';
  // Classify insights from this recording's summary (async, non-blocking)
  let knowledgePillsHtml = '';
  let chainHtml = '';
  try {
    const { classifySummaryInsights, computeAssumptionRisk, buildReasoningChain } = await import('../lib/knowledge-framework.js');
    const insights = classifySummaryInsights(rec.aiSummary, rec.id);
    if (insights.length >= 2) {
      const facts = insights.filter(i => i.type === 'fact').length;
      const decisions = insights.filter(i => i.type === 'decision').length;
      const assumptions = insights.filter(i => i.type === 'assumption').length;
      const questions = insights.filter(i => i.type === 'open_question').length;
      const risk = computeAssumptionRisk(insights);
      const riskBg = risk.riskLevel === 'high' ? 'rgba(239,68,68,0.12)'
        : risk.riskLevel === 'medium' ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.08)';
      const riskColor = risk.riskLevel === 'high' ? 'var(--color-danger)'
        : risk.riskLevel === 'medium' ? 'var(--color-warning)' : 'var(--color-success)';
      knowledgePillsHtml = `
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:var(--space-3);font-size:10px;">
          ${facts ? `<span style="background:rgba(34,197,94,0.1);color:var(--color-success);padding:2px 8px;border-radius:10px;">${facts} fact${facts > 1 ? 's' : ''}</span>` : ''}
          ${decisions ? `<span style="background:rgba(124,58,237,0.1);color:var(--color-primary-light);padding:2px 8px;border-radius:10px;">${decisions} decision${decisions > 1 ? 's' : ''}</span>` : ''}
          ${assumptions ? `<span style="background:rgba(245,158,11,0.1);color:var(--color-warning);padding:2px 8px;border-radius:10px;">${assumptions} assumption${assumptions > 1 ? 's' : ''}</span>` : ''}
          ${questions ? `<span style="background:rgba(148,163,184,0.1);color:var(--color-text-muted);padding:2px 8px;border-radius:10px;">${questions} open</span>` : ''}
          <span style="background:${riskBg};color:${riskColor};padding:2px 8px;border-radius:10px;margin-left:auto;" title="${esc(risk.details)}">${risk.riskLevel} risk</span>
        </div>`;

      // Decision reasoning chains
      const chains = buildReasoningChain(insights);
      const chainsWithContent = chains.filter(c => c.supportedBy.length > 0 || c.gapCount > 0);
      if (chainsWithContent.length > 0) {
        chainHtml = `
          <details style="margin-bottom:var(--space-3);font-size:11px;">
            <summary style="cursor:pointer;color:var(--color-primary-light);font-size:10px;font-weight:var(--weight-semi);margin-bottom:var(--space-1);">
              ${icons.trendingUp(10)} Decision Chains (${chainsWithContent.length})
            </summary>
            ${chainsWithContent.map(c => `
              <div style="padding:var(--space-1) 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                <div style="color:var(--color-primary-light);font-weight:var(--weight-semi);margin-bottom:2px;">
                  ${esc(c.decision.length > 80 ? c.decision.slice(0, 80) + '…' : c.decision)}
                </div>
                ${c.supportedBy.length > 0 ? c.supportedBy.map(s =>
                  `<div style="color:var(--color-text-muted);padding-left:var(--space-3);display:flex;gap:4px;">
                    <span style="color:var(--color-success);flex-shrink:0;">✓</span>
                    <span>${esc(s.length > 100 ? s.slice(0, 100) + '…' : s)}</span>
                  </div>`
                ).join('') : `
                  <div style="color:var(--color-warning);padding-left:var(--space-3);display:flex;gap:4px;">
                    <span style="flex-shrink:0;">⚠</span> No supporting evidence found
                  </div>`}
              </div>
            `).join('')}
          </details>`;
      }
    }
  } catch { /* non-critical */ }

  container.innerHTML = `
    <div style="padding:var(--space-3);">
      ${tldwHtml}
      ${chaptersHtml}
      ${knowledgePillsHtml}
      ${chainHtml}
      <div class="rd-summary-body">${renderMarkdown(rec.aiSummary)}</div>
    </div>`;

  // Chapter click → seek video
  container.querySelectorAll('.rd-chapter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const video = document.getElementById('rd-video');
      if (video) {
        video.currentTime = Number(btn.dataset.seconds);
        video.play();
      }
    });
  });
}

function _renderTranscriptTab(container, rec, vttSegments) {
  if (!vttSegments.length && !rec.aiTranscript) {
    container.innerHTML = `
      <div style="padding:var(--space-6);text-align:center;color:var(--color-text-muted);">
        ${icons.mic(24)}
        <p style="margin-top:var(--space-2);">No transcript available.</p>
      </div>`;
    return;
  }

  // Fallback: plain-text transcript (no timestamps, e.g. Gemini path)
  if (!vttSegments.length && rec.aiTranscript) {
    container.innerHTML = `
      <div style="padding:var(--space-3);">
        <div style="font-size:var(--font-sm);color:var(--color-text-secondary);line-height:1.8;white-space:pre-wrap;">${esc(rec.aiTranscript)}</div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div style="padding:var(--space-2) var(--space-3);">
      <input type="text" class="input" id="rd-transcript-search" placeholder="Search transcript…" autocomplete="off" style="font-size:var(--font-xs);margin-bottom:var(--space-2);" />
      <div class="rd-transcript-list" id="rd-tlist">
        ${vttSegments.map((seg, i) => `
          <div class="rd-transcript-row" data-idx="${i}" data-start="${seg.start}" data-end="${seg.end}">
            <span class="rd-ts">${fmtTimestamp(Math.floor(seg.start))}</span>
            <span class="rd-text">${esc(seg.text)}</span>
          </div>
        `).join('')}
      </div>
    </div>`;

  const rows = container.querySelectorAll('.rd-transcript-row');
  const searchInput = container.querySelector('#rd-transcript-search');

  // Click to seek
  rows.forEach(row => {
    row.addEventListener('click', () => {
      const video = document.getElementById('rd-video');
      if (video) {
        video.currentTime = Number(row.dataset.start);
        video.play();
      }
    });
  });

  // Search filter
  searchInput?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    rows.forEach(row => {
      const text = row.querySelector('.rd-text')?.textContent?.toLowerCase() || '';
      row.style.display = !q || text.includes(q) ? '' : 'none';
    });
  });

  // Sync active transcript line with video playback
  const video = document.getElementById('rd-video');
  if (video) {
    let lastActiveIdx = -1;
    const tList = container.querySelector('#rd-tlist');
    video.addEventListener('timeupdate', () => {
      const t = video.currentTime;
      let activeIdx = -1;
      for (let i = 0; i < vttSegments.length; i++) {
        if (t >= vttSegments[i].start && t < vttSegments[i].end) { activeIdx = i; break; }
      }
      if (activeIdx !== lastActiveIdx) {
        rows.forEach(r => r.classList.remove('active'));
        if (activeIdx >= 0 && rows[activeIdx]) {
          rows[activeIdx].classList.add('active');
          rows[activeIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        lastActiveIdx = activeIdx;
      }
    });
  }
}

/**
 * Populate the "Connections" section from the knowledge graph edge store.
 * Groups edges by type and renders them as compact badge rows.
 */
async function _populateConnections(container, rec) {
  const edges = await getEdgesFromNode('recording', rec.id).catch(() => []);
  if (!edges.length) return;

  const slot = container.querySelector('#rd-connections-slot');
  const list = container.querySelector('#rd-connections-list');
  if (!slot || !list) return;

  // Group by edge type
  const grouped = {};
  for (const e of edges) {
    const key = e.edgeType;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(e);
  }

  const html = Object.entries(grouped).map(([type, items]) => {
    const cfg = getEdgeTypeConfig(type);
    const preview = items.slice(0, 4).map(e => {
      const name = e.metadata?.name || e.targetId;
      const shortName = typeof name === 'string' && name.length > 20 ? name.slice(0, 18) + '…' : name;
      return `<span style="background:rgba(255,255,255,0.06);padding:1px 6px;border-radius:4px;font-size:10px;" title="${esc(String(name))}">${esc(String(shortName))}</span>`;
    }).join('');
    const extra = items.length > 4 ? `<span style="font-size:10px;color:var(--color-text-disabled);">+${items.length - 4}</span>` : '';
    return `
      <div style="display:flex;align-items:center;gap:6px;padding:4px 0;">
        <span style="flex-shrink:0;">${cfg.icon}</span>
        <span style="font-size:var(--font-xs);color:${cfg.cssVar};font-weight:var(--weight-semi);min-width:65px;">${cfg.label}</span>
        <div style="display:flex;flex-wrap:wrap;gap:3px;flex:1;">${preview}${extra}</div>
      </div>`;
  }).join('');

  slot.style.display = '';
  list.innerHTML = html;
}

/**
 * Populate the "🎯 Linked Goals" section from CONTRIBUTES_TO edges.
 * Shows goals detected in this recording's transcript.
 */
async function _populateGoals(container, rec) {
  const edges = await getEdgesFromNode('recording', rec.id).catch(() => []);
  const goalEdges = edges.filter(e => e.edgeType === 'CONTRIBUTES_TO' && e.targetType === 'goal');
  if (!goalEdges.length) return;

  const slot = container.querySelector('#rd-goals-slot');
  const list = container.querySelector('#rd-goals-list');
  if (!slot || !list) return;

  // Resolve goal nodes
  let goals = [];
  try {
    const { getNode } = await import('../lib/storage.js');
    goals = (await Promise.all(
      goalEdges.map(e => getNode(e.targetId).catch(() => null))
    )).filter(Boolean);
  } catch { return; }

  if (!goals.length) return;

  const stateIcons = { 'at-risk': '🔴', active: '🟢', aspiration: '💭', achieved: '✅', abandoned: '🚫' };

  slot.style.display = '';
  list.innerHTML = goals.map(g => {
    const props = g.properties || {};
    const state = props.state || 'aspiration';
    const icon = stateIcons[state] || '🎯';
    const title = props.title || 'Untitled goal';
    return `
      <div style="display:flex;align-items:center;gap:6px;padding:4px 0;">
        <span style="flex-shrink:0;">${icon}</span>
        <span style="font-size:var(--font-xs);color:var(--color-text-secondary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(title)}">${esc(title)}</span>
        <span style="font-size:10px;color:var(--color-text-disabled);text-transform:capitalize;">${state}</span>
      </div>`;
  }).join('');
}
