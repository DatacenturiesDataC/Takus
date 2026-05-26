// Takus — Entry Detail View (Knowledge OS)
// 70/30 split layout: left pane (Ask, Summary, Content, Tasks) · right pane (media/text, metadata, downloads)
import { icons } from '../lib/icons.js';
import { esc, renderMarkdown, parseVTT, fmtTimestamp, shortTime } from '../lib/utils.js';
import { getCategory } from '../lib/content-types.js';
import { getMediaBlob, hasEmbeddingsForEntry, getAllEmbeddings, getEmbeddingsForEntries, getEntries, saveEntry, deleteEntry, deleteMediaBlob, deleteEmbeddings, removeEdgesForNode, getEdgesFromNode, getEdgesForNode, saveEngagementEvent, removeInteractionsForEntry, removeContentItemsForEntry, removeVaultSync } from '../lib/storage.js';
import { recordSignal } from '../lib/preference-engine.js';
import { typeLabel, typeAccent } from '../lib/content-types.js';
import { renderTasksPanel } from './tasks-panel.js';
import { formatDuration, formatSize } from '../lib/recorder.js';
import { extractTLDW, parseChapters } from '../lib/analytics.js';
import { semanticSearch, cosineSimilarity } from '../lib/embeddings.js';
import { meanVector } from '../lib/graph/vector-utils.js';
import { generateAnswer } from '../lib/ai-engine.js';
import { getSettings, getEffectiveAIConfig } from '../lib/settings-store.js';
import { getEdgeTypeConfig } from '../lib/edge-types.js';
import { OPEN_ENTRY } from '../lib/events.js';
import { togglePin } from '../lib/archive-engine.js';
import { renderPipelineProgress, injectPipelineStyles, bindPipelineRetry } from './pipeline-progress.js';
import { toast } from './toast.js';
import { confirmAsync } from '../lib/dialog-utils.js';



/**
 * Render a full entry detail view with 70/30 split layout.
 * @param {HTMLElement} container
 * @param {object} entry  Full entry object from IndexedDB
 * @param {Function} onBack   Called when user clicks "Back"
 * @param {Function} onUpdate Called with updated entry after changes
 */
export async function renderEntryDetail(container, entry, onBack, onUpdate) {
  // entry is used directly — no alias needed
  const accent = typeAccent(entry.type || 'screen');
  const isDocument = getCategory(entry.type) === 'document';
  const dateStr = new Date(entry.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = shortTime(entry.date);
  const hasSummary = !!(entry.aiSummary || entry.textContent);
  const hasTranscript = !!(entry.aiVtt || entry.textContent);
  const chapters = hasSummary ? parseChapters(entry.aiSummary) : [];
  const tldw = hasSummary ? extractTLDW(entry.aiSummary) : '';
  const tags = entry.tags || [];
  const qualityScore = entry.qualityScore || null;
  const calEvent = entry.calendarEvent || null;
  const participants = entry.participants || calEvent?.attendees || [];

  // Load VTT segments for transcript viewer
  const vttSegments = entry.aiVtt ? parseVTT(entry.aiVtt) : [];

  // Check if this entry has embeddings — O(1) key lookup, NOT a full scan
  let hasEmbeddings = false;
  try {
    hasEmbeddings = await hasEmbeddingsForEntry(entry.id);
  } catch { /* non-critical */ }

  // Default active tab
  let activeTab = hasSummary ? 'summary' : (hasEmbeddings ? 'ask' : 'summary');

  // Record VIEW engagement event (best-effort, non-blocking)
  saveEngagementEvent({
    contentId: entry.id,
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
          <span class="rd-type-badge" style="color:${accent};">${typeLabel(entry.type || 'screen')}</span>
          <h2 class="rd-title">${esc(entry.title || 'Untitled')}</h2>
          <span class="rd-meta">${dateStr} · ${timeStr}${entry.duration ? ` · ${formatDuration(entry.duration)}` : ''}</span>
        </div>
        <button class="btn btn-primary btn-sm" id="rd-share-brief" style="margin-left:auto;display:flex;align-items:center;gap:5px;flex-shrink:0;">
          ${icons.link(13)} Share Brief
        </button>
      </div>

      <!-- Split layout -->
      <div class="rd-split">
        <!-- Left pane (70%) -->
        <div class="rd-left">
          <!-- Combined Brief: Summary → Action Items → Transcript (scrollable) -->
          ${hasEmbeddings ? `
          <div class="rd-brief-section" id="rd-ask-section">
            <div class="set-flex-row mb-3">
              <input type="text" class="input flex-1" id="rd-ask-input" aria-label="Ask about this entry" placeholder="Ask about this meeting…" autocomplete="off" />
              <button class="btn btn-primary btn-sm" id="rd-ask-submit">Ask</button>
            </div>
            <div id="rd-ask-result" class="text-sm-secondary"></div>
          </div>` : ''}

          ${hasSummary ? `
          <div class="rd-brief-section" id="rd-summary-section">
            <div class="rd-brief-heading">${icons.edit(13)} Summary</div>
            <div id="rd-summary-content" class="rd-summary-body"></div>
          </div>` : ''}

          <div class="rd-brief-section" id="rd-tasks-section">
            <div class="rd-brief-heading">${icons.zap(13)} Action Items</div>
            <div id="rd-tasks-content"></div>
          </div>

          ${hasTranscript ? `
          <div class="rd-brief-section" id="rd-transcript-section">
            <button class="rd-brief-toggle" id="rd-transcript-toggle">
              ${icons.mic(13)} ${isDocument ? 'Content' : 'Transcript'}
              <span class="rd-brief-toggle-arrow">▸</span>
            </button>
            <div id="rd-transcript-content" style="display:none;"></div>
          </div>` : ''}
        </div>

        <!-- Right pane (30%) -->
        <div class="rd-right">
          ${isDocument ? `
          <!-- Document text preview -->
          <div class="rd-doc-preview" id="rd-doc-slot">
            ${esc((entry.textContent || '').slice(0, 2000))}${(entry.textContent || '').length > 2000 ? '\n\n[…]' : ''}
          </div>` : `
          <!-- Video player -->
          <div class="rd-video-wrapper" id="rd-video-slot">
            <div class="rd-video-placeholder">
              ${icons.video(24)}
            </div>
          </div>`}

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
            <div class="rd-flex-wrap">
              ${participants.slice(0, 8).map(p => {
                const name = typeof p === 'string' ? p : (p.name || p.displayName || p.email || 'Unknown');
                const initial = name.charAt(0).toUpperCase();
                return `<span class="rd-participant" title="${esc(name)}">${initial}</span>`;
              }).join('')}
              ${participants.length > 8 ? `<span class="rd-participant" style="background:rgba(255,255,255,0.06);">+${participants.length - 8}</span>` : ''}
            </div>
          </div>` : ''}

          ${(calEvent && (entry.type === 'meeting' || participants.length)) ? `
          <!-- Meeting Context (lazy-loaded) -->
          <div class="rd-section" id="rd-meeting-prep-slot" style="display:none;">
            <div class="rd-section-label">${icons.zap(11)} Meeting Context</div>
            <div id="rd-meeting-prep-content" class="rd-text-sm">Loading…</div>
          </div>` : ''}

          <!-- Tags -->
          <div class="rd-section">
            <div class="rd-section-label">${icons.tag ? icons.tag(11) : '🏷'} Tags</div>
            <div class="rd-flex-wrap" id="rd-tags">
              ${tags.length ? tags.map(t => `<span class="rd-tag">${esc(t)}</span>`).join('') : '<span class="ins-muted-label">No tags</span>'}
            </div>
          </div>

          <!-- Notes -->
          <div class="rd-section">
            <div class="rd-section-label">${icons.edit(11)} Notes</div>
            <textarea id="rd-notes" class="input" rows="3" placeholder="Add notes…" aria-label="Entry notes" style="font-size:var(--font-xs);resize:vertical;min-height:48px;">${esc(entry.notes || '')}</textarea>
          </div>

          ${qualityScore !== null ? `
          <!-- Quality Score -->
          <div class="rd-section">
            <div class="rd-section-label">${icons.barChart(11)} Quality Score</div>
            <div class="ins-bar-row">
              <div style="flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">
                <div style="height:100%;width:${qualityScore}%;background:${qualityScore >= 70 ? 'var(--color-success)' : qualityScore >= 40 ? 'var(--color-warning)' : 'var(--color-danger)'};border-radius:3px;transition:width 0.3s;"></div>
              </div>
              <span class="text-xs text-semi-secondary" >${qualityScore}%</span>
            </div>
          </div>` : ''}

          <!-- Downloads -->
          <div class="rd-section">
            <div class="rd-section-label">${icons.download(11)} Downloads</div>
            <div class="rd-col-stack">
              ${isDocument
                ? `<button class="btn btn-ghost btn-sm rd-dl-btn rd-action-btn" id="rd-dl-text" >${icons.edit(12)} Original text (.txt)${entry.textContent ? ` · ${formatSize(new Blob([entry.textContent]).size)}` : ''}</button>`
                : `<button class="btn btn-ghost btn-sm rd-dl-btn rd-action-btn" id="rd-dl-video" >${icons.video(12)} Video (.webm)${entry.size ? ` · ${formatSize(entry.size)}` : ''}</button>`
              }
              ${hasSummary ? `<button class="btn btn-ghost btn-sm rd-dl-btn rd-action-btn" id="rd-dl-summary" >${icons.edit(12)} Summary (.md)</button>` : ''}
              ${hasTranscript && !isDocument ? `<button class="btn btn-ghost btn-sm rd-dl-btn rd-action-btn" id="rd-dl-transcript" >${icons.mic(12)} Transcript (.vtt)</button>` : ''}
            </div>
          </div>

          <!-- Info -->
          <div class="rd-section">
            <div class="rd-info-meta">
              ${entry.duration ? `<span>Duration: ${formatDuration(entry.duration)}</span>` : ''}
              ${isDocument && entry.textContent ? `<span>${entry.textContent.split(/\s+/).length.toLocaleString()} words</span>` : ''}
              ${entry.size && !isDocument ? `<span>Size: ${formatSize(entry.size)}</span>` : ''}
              <span>ID: ${esc(entry.id?.slice(0, 8) || '—')}</span>
              ${entry.driveLink ? `<a href="${esc(entry.driveLink)}" target="_blank" rel="noopener" style="color:var(--color-primary-light);text-decoration:none;display:inline-flex;align-items:center;gap:3px;margin-top:2px;">${icons.link(10)} Open in Drive</a>` : ''}
              ${entry.aiDocLink ? `<a href="${esc(entry.aiDocLink)}" target="_blank" rel="noopener" style="color:var(--color-primary-light);text-decoration:none;display:inline-flex;align-items:center;gap:3px;">${icons.edit(10)} View AI Doc</a>` : ''}
            </div>
          </div>

          <!-- Linked Goals (populated async) -->
          <div class="rd-section" id="rd-goals-slot" style="display:none;">
            <div class="rd-section-label">🎯 Linked Goals</div>
            <div id="rd-goals-list" class="rd-col-stack"></div>
          </div>

          <!-- Knowledge Connections (populated async) -->
          <div class="rd-section" id="rd-connections-slot" style="display:none;">
            <div class="rd-section-label">${icons.link(11)} Connections</div>
            <div id="rd-connections-list" class="rd-col-stack"></div>
          </div>

          <!-- Related Entries (populated async — horizontal scrollable cards) -->
          <div class="rd-section" id="rd-related-slot">
            <div class="rd-section-label">${icons.arrowRight(11)} Related</div>
            <div id="rd-related-list" style="display:flex;gap:10px;overflow-x:auto;padding:4px 0 6px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;"></div>
          </div>

          ${entry.archiveLog?.length ? `
          <!-- Archive Audit Trail -->
          <div class="rd-section">
            <div class="rd-section-label">${icons.download(11)} Archive History</div>
            <div class="rd-col-stack" style="gap:2px;">
              ${entry.archiveLog.map(entry => {
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
                  <span class="text-disabled flex-shrink-0">${time}</span>
                </div>`;
              }).join('')}
            </div>
          </div>` : ''}

          ${entry.pipelineRun?.steps?.length ? `
          <!-- Pipeline Steps -->
          <div class="rd-section">
            ${renderPipelineProgress(entry.pipelineRun, { entryId: entry.id })}
          </div>` : ''}

          <!-- Actions -->
          <div class="rd-section">
            <div class="rd-section-label">${icons.zap(11)} Actions</div>
            <div class="rd-col-stack">
              <button class="btn btn-ghost btn-sm rd-dl-btn rd-action-btn" id="rd-action-pin" >
                ${icons.star(12)} <span>${entry.pinned ? 'Unpin entry' : 'Pin to top'}</span>
              </button>
              <button class="btn btn-ghost btn-sm rd-dl-btn rd-action-btn text-danger" id="rd-action-delete"  >
                ${icons.trash(12)} Delete entry
              </button>
              <button class="btn btn-ghost btn-sm rd-dl-btn rd-action-btn" id="rd-action-archive"  style="display:none;">
                ${icons.download(12)} <span>${entry.archiveStatus === 'archived' ? 'View archive' : 'Archive entry'}</span>
              </button>
              ${entry.archiveStatus === 'archived' ? `<button class="btn btn-ghost btn-sm rd-dl-btn rd-action-btn" id="rd-action-restore"  style="display:none;">
                ${icons.refresh(12)} <span>Restore from cloud</span>
              </button>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>`;

  // ── Event bindings ────────────────────────────────────────────────────────

  // Back button — also clean up blob URL (replaces the old MutationObserver on document.body)
  container.querySelector('#rd-back')?.addEventListener('click', () => {
    if (_mediaBlobUrl) { URL.revokeObjectURL(_mediaBlobUrl); _mediaBlobUrl = null; }
    _cachedMediaBlob = null;
    onBack();
  });

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
              <span class="truncate">${esc(m.title)}</span>
              <span class="ins-muted-label">${new Date(m.date).toLocaleDateString()}</span>
            </div>`
          ).join(''));
        }
        if (prep.openTasks.length) {
          parts.push(`<div class="mt-2 mb-1"><strong>${prep.openTasks.length}</strong> open task${prep.openTasks.length > 1 ? 's' : ''}</div>`);
          parts.push(prep.openTasks.slice(0, 5).map(t =>
            `<div class="rd-prep-item">
              <span class="text-warning">○</span>
              <span class="truncate">${esc(t.text)}</span>
            </div>`
          ).join(''));
        }
        if (prep.keyDecisions.length) {
          parts.push(`<div class="mt-2 mb-1"><strong>${prep.keyDecisions.length}</strong> key decision${prep.keyDecisions.length > 1 ? 's' : ''}</div>`);
          parts.push(prep.keyDecisions.slice(0, 5).map(d =>
            `<div class="rd-prep-item">
              <span class="text-success">✓</span>
              <span class="truncate">${esc(d.decision)}</span>
            </div>`
          ).join(''));
        }
        if (parts.length === 0) {
          parts.push('<span class="text-disabled">No related context found</span>');
        }
        container.querySelector('#rd-meeting-prep-content').innerHTML = parts.join('');
        prepSlot.style.display = '';

        // Navigate to related entry on click
        prepSlot.querySelectorAll('.rd-prep-meeting').forEach(el => {
          el.addEventListener('click', async () => {
            const targetId = el.dataset.id;
            if (!targetId) return;
            const allEntries = await getEntries().catch(() => []);
            const target = allEntries.find(e => e.id === targetId);
            if (target) {
              document.dispatchEvent(new CustomEvent(OPEN_ENTRY, { detail: { entry: target } }));
            }
          });
        });
      } catch { /* non-critical — hide prep slot on failure */ prepSlot.style.display = 'none'; }
    }).catch(() => {});
  }

  // ── Combined Brief: render all sections inline ──────────────────────────

  // Summary section
  const summarySlot = container.querySelector('#rd-summary-content');
  if (summarySlot) {
    _renderSummaryTab(summarySlot, entry, chapters, tldw);
  }

  // Tasks section
  const tasksSlot = container.querySelector('#rd-tasks-content');
  if (tasksSlot) {
    renderTasksPanel(tasksSlot, entry, onUpdate);
  }

  // Transcript section (collapsed by default)
  const transcriptToggle = container.querySelector('#rd-transcript-toggle');
  const transcriptSlot = container.querySelector('#rd-transcript-content');
  if (transcriptToggle && transcriptSlot) {
    let transcriptLoaded = false;
    transcriptToggle.addEventListener('click', () => {
      const isHidden = transcriptSlot.style.display === 'none';
      transcriptSlot.style.display = isHidden ? '' : 'none';
      transcriptToggle.querySelector('.rd-brief-toggle-arrow').textContent = isHidden ? '▾' : '▸';
      if (isHidden && !transcriptLoaded) {
        transcriptLoaded = true;
        _renderTranscriptTab(transcriptSlot, entry, vttSegments);
      }
    });
  }

  // Ask section (inline)
  const askInput = container.querySelector('#rd-ask-input');
  const askSubmit = container.querySelector('#rd-ask-submit');
  const askResult = container.querySelector('#rd-ask-result');
  if (askInput && askSubmit && askResult && hasEmbeddings) {
    _bindAskHandlers(askInput, askSubmit, askResult, entry);
  }

  // Share Brief button
  container.querySelector('#rd-share-brief')?.addEventListener('click', async () => {
    try {
      const shareData = {
        title: entry.title || 'Meeting Brief',
        date: entry.date,
        type: entry.type,
        aiSummary: entry.aiSummary || '',
      };
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shareData),
      });
      if (res.ok) {
        const { id } = await res.json();
        const url = `${window.location.origin}/api/share?id=${id}`;
        await navigator.clipboard.writeText(url).catch(() => {});
        toast.success('Link copied!', 'Share this link with meeting attendees');
      } else {
        toast.error('Share failed', 'Could not create share link');
      }
    } catch (e) {
      toast.error('Share failed', e.message);
    }
  });

  // Load media into right pane (only for non-document entries)
  // Track blob URL and media blob for cleanup and download reuse
  let _mediaBlobUrl = null;
  let _cachedMediaBlob = null;

  // Clean up blob URL when navigating away via OPEN_ENTRY (sidebar, related entry, etc.)
  const _cleanupOnNavigate = () => {
    if (_mediaBlobUrl) { URL.revokeObjectURL(_mediaBlobUrl); _mediaBlobUrl = null; }
    _cachedMediaBlob = null;
    document.removeEventListener(OPEN_ENTRY, _cleanupOnNavigate);
  };
  document.addEventListener(OPEN_ENTRY, _cleanupOnNavigate);

  if (!isDocument) {
    const videoSlot = container.querySelector('#rd-video-slot');
    try {
      const blob = await getMediaBlob(entry.id);
      if (blob && videoSlot) {
        _cachedMediaBlob = blob;
        _mediaBlobUrl = URL.createObjectURL(blob);
        videoSlot.innerHTML = `<video id="rd-video" src="${_mediaBlobUrl}" controls preload="metadata" style="width:100%;border-radius:var(--radius-md);background:#000;max-height:220px;"></video>`;

        // Record PLAY engagement event on first play
        const videoEl = videoSlot.querySelector('#rd-video');
        if (videoEl) {
          videoEl.addEventListener('play', function _onPlay() {
            videoEl.removeEventListener('play', _onPlay);
            saveEngagementEvent({
              contentId: entry.id,
              contactId: null,
              type: 'PLAY',
              timestamp: Date.now(),
            }).catch(() => {});
          });
        }
      } else if (videoSlot) {
        // Blob missing — show user-friendly fallback
        videoSlot.innerHTML = `<div style="padding:var(--space-4);text-align:center;color:var(--color-text-muted);font-size:var(--font-xs);border:1px dashed var(--color-border);border-radius:var(--radius-md);">
          <div style="margin-bottom:var(--space-2);opacity:0.5;">${icons.video(24)}</div>
          Media not available${entry.archiveStatus === 'archived' ? ' — entry archived' : ''}
        </div>`;
      }
    } catch {
      // Show error fallback instead of silent failure
      const videoSlot = container.querySelector('#rd-video-slot');
      if (videoSlot) {
        videoSlot.innerHTML = `<div style="padding:var(--space-4);text-align:center;color:var(--color-text-muted);font-size:var(--font-xs);border:1px dashed var(--color-border);border-radius:var(--radius-md);">
          <div style="margin-bottom:var(--space-2);opacity:0.5;">${icons.video(24)}</div>
          Could not load media
        </div>`;
      }
    }
  }

  // Download buttons
  // Download video (media entries only)
  container.querySelector('#rd-dl-video')?.addEventListener('click', async () => {
    try {
      // Reuse cached blob instead of re-fetching from IDB
      const blob = _cachedMediaBlob || await getMediaBlob(entry.id);
      if (!blob) { toast.warning('No media', 'Media file not found in storage.'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${entry.title || 'entry'}.webm`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success('Downloaded', 'Media saved');
    } catch (e) { toast.error('Download failed', e.message); }
  });

  // Download original text (document entries only)
  container.querySelector('#rd-dl-text')?.addEventListener('click', () => {
    const text = entry.textContent || '';
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${entry.title || 'document'}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast.success('Downloaded', 'Text saved');
  });

  container.querySelector('#rd-dl-summary')?.addEventListener('click', () => {
    const md = entry.aiSummary || '';
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${entry.title || 'entry'}-summary.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast.success('Downloaded', 'Summary saved');
  });

  container.querySelector('#rd-dl-transcript')?.addEventListener('click', () => {
    const vtt = entry.aiVtt || entry.textContent || '';
    const blob = new Blob([vtt], { type: 'text/vtt' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${entry.title || 'entry'}-transcript.vtt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast.success('Downloaded', 'Transcript saved');
  });

  // Pin toggle
  container.querySelector('#rd-action-pin')?.addEventListener('click', async () => {
    try {
      await togglePin(entry);
      const pinBtn = container.querySelector('#rd-action-pin');
      if (pinBtn) {
        const label = pinBtn.querySelector('span');
        if (label) label.textContent = entry.pinned ? 'Unpin entry' : 'Pin to top';
      }
      toast.success(entry.pinned ? 'Pinned' : 'Unpinned', entry.pinned ? 'Entry pinned to top of history' : 'Entry unpinned');
      if (onUpdate) onUpdate(entry);
    } catch (e) {
      toast.error('Pin failed', e.message);
    }
  });

  // Delete
  container.querySelector('#rd-action-delete')?.addEventListener('click', async () => {
    if (!(await confirmAsync(`Delete "${entry.title || 'Untitled'}"? This cannot be undone.`, { confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await Promise.all([
        deleteEntry(entry.id),
        deleteMediaBlob(entry.id),
        deleteEmbeddings(entry.id).catch(() => {}),
        removeEdgesForNode('entry', entry.id).catch(() => {}),
        removeInteractionsForEntry(entry.id).catch(() => {}),
        removeContentItemsForEntry(entry.id).catch(() => {}),
        removeVaultSync(entry.id).catch(() => {}),
      ]);
      toast.info('Deleted', 'Entry removed');
      if (onUpdate) onUpdate(entry);
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
      if (val !== (entry.notes || '').trim()) {
        entry.notes = val || '';
        await saveEntry(entry).catch(() => {});
        // Record SUMMARY_EDITED signal for RL preference learning
        recordSignal('SUMMARY_EDITED', {
          contentId: entry.id,
          contentType: entry.type || 'screen',
          notesLength: val.length,
        }).catch(() => {});
        if (onUpdate) onUpdate(entry);
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
        if (entry.archiveStatus === 'archived') {
          // Open archive player for archived entries
          const { openArchivePlayer } = await import('./archive-player.js');
          openArchivePlayer(entry);
        } else {
          // Trigger archival — archiveEntry expects (entry, videoBlob, onProgress)
          const { archiveEntry } = await import('../lib/archive-engine.js');
          archiveBtn.disabled = true;
          archiveBtn.querySelector('span').textContent = 'Archiving…';
          const videoBlob = _cachedMediaBlob || await getMediaBlob(entry.id).catch(() => null);
          const result = await archiveEntry(entry, videoBlob, (stage, pct) => {
            archiveBtn.querySelector('span').textContent = `${stage} ${Math.round(pct * 100)}%`;
          });
          if (result.success) {
            entry.archiveStatus = 'archived';
            await saveEntry(entry).catch(() => {});
            archiveBtn.querySelector('span').textContent = 'View archive';
            toast.success('Archived', 'Entry archived — media freed');
            if (onUpdate) onUpdate(entry);
          } else {
            toast.warning('Not eligible', result.reason || 'Entry cannot be archived yet');
          }
          archiveBtn.disabled = false;
        }
      } catch (e) {
        toast.error('Archive failed', e.message);
        archiveBtn.disabled = false;
      }
    });
  }

  // Restore action — re-download archived entry from cloud
  const restoreBtn = container.querySelector('#rd-action-restore');
  if (restoreBtn) {
    import('../lib/feature-flags.js').then(async ({ isEnabled }) => {
      if (await isEnabled('archiveEngine')) restoreBtn.style.display = '';
    }).catch(() => {});

    restoreBtn.addEventListener('click', async () => {
      if (!(await confirmAsync(`Restore "${entry.title || 'Untitled'}" from cloud? This will re-download the content.`, { confirmLabel: 'Restore' }))) return;
      try {
        const { restoreEntry } = await import('../lib/archive-engine.js');
        restoreBtn.disabled = true;
        restoreBtn.querySelector('span').textContent = 'Restoring…';
        const result = await restoreEntry(entry, (stage, pct) => {
          restoreBtn.querySelector('span').textContent = `${stage} ${Math.round(pct * 100)}%`;
        });
        if (result.success) {
          toast.success('Restored', 'Entry restored from cloud');
          if (onUpdate) onUpdate(entry);
          renderEntryDetail(container, entry, onBack, onUpdate);
        } else {
          toast.warning('Restore failed', result.reason || 'Could not restore entry');
          restoreBtn.querySelector('span').textContent = 'Restore from cloud';
        }
      } catch (e) {
        toast.error('Restore failed', e.message);
        restoreBtn.querySelector('span').textContent = 'Restore from cloud';
      }
      restoreBtn.disabled = false;
    });
  }

  // Pipeline retry button (via reusable component)
  bindPipelineRetry(container);
  // Re-bind with onComplete callback for re-render
  container.querySelectorAll('[data-pipeline-retry]').forEach(btn => {
    const originalHandler = btn.onclick;
    btn.onclick = null; // Clear the generic handler
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const id = btn.dataset.pipelineRetry;
      btn.disabled = true;
      btn.textContent = '⏳ Retrying…';
      try {
        const { retryFailedStep } = await import('../lib/content-pipeline.js');
        await retryFailedStep(id, {
          onComplete: (updated) => {
            if (onUpdate) onUpdate(updated);
            renderEntryDetail(container, updated, onBack, onUpdate);
          },
        });
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '↻ Retry Pipeline';
      }
    });
  });

  // Async: populate related entries via cosine similarity
  _populateRelated(container, entry).catch(() => {});
  _populateConnections(container, entry).catch(() => {});
  _populateGoals(container, entry).catch(() => {});
}

async function _populateRelated(container, entry) {
  const allRecs = await getEntries().catch(() => []);

  const slot = container.querySelector('#rd-related-slot');
  const list = container.querySelector('#rd-related-list');
  if (!slot || !list) return;

  if (allRecs.length < 2) {
    list.innerHTML = `<span style="font-size:var(--font-xs);color:var(--color-text-disabled);font-style:italic;padding:4px 0;">No connections yet — the autonomy engine will find related entries over time.</span>`;
    return;
  }

  // Load embeddings only for this entry + the most recent 50 entries (targeted, not all)
  const recentIds = allRecs.slice(0, 50).map(r => r.id);
  const targetIds = new Set([entry.id, ...recentIds]);
  const allEmb = await getEmbeddingsForEntries([...targetIds]).catch(() => []);

  const scored = new Map(); // contentId → { entry, score, reasons[] }

  // ── Method 1: Embedding similarity ──────────────────────────────────────
  if (allEmb.length >= 2) {
    const srcEntry = allEmb.find(e => e.contentId === entry.id);
    if (srcEntry?.chunks?.length) {
      const srcMean = meanVector(srcEntry.chunks);
      if (srcMean) {
        for (const emb of allEmb) {
          if (emb.contentId === entry.id || !emb.chunks?.length) continue;
          const mean = meanVector(emb.chunks);
          if (!mean) continue;
          const sim = cosineSimilarity(srcMean, mean);
          if (sim > 0.35) {
            const r = allRecs.find(x => x.id === emb.contentId);
            if (r) scored.set(r.id, { entry: r, score: sim, reasons: [`${Math.round(sim * 100)}% similar`] });
          }
        }
      }
    }
  }

  // ── Method 2: Shared participants ───────────────────────────────────────
  const srcAttendees = new Set([
    ...(entry.calendarEvent?.attendees || []),
    ...(entry.participants || []).map(p => typeof p === 'string' ? p : p.email).filter(Boolean),
    ...(entry.aiParticipants?.map(p => p.email).filter(Boolean) || []),
  ].map(e => e.toLowerCase()));

  if (srcAttendees.size > 0) {
    for (const other of allRecs) {
      if (other.id === entry.id) continue;
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
          scored.set(other.id, { entry: other, score: participantScore, reasons: [`${shared.length} shared`] });
        }
      }
    }
  }

  // ── Method 3: Knowledge graph edges (bidirectional) ─────────────────────
  try {
    const edges = await getEdgesForNode('entry', entry.id);
    for (const edge of edges) {
      // Determine which end is the "other" entry
      const isSource = edge.sourceType === 'entry' && edge.sourceId === entry.id;
      const otherId = isSource ? edge.targetId : edge.sourceId;
      const otherType = isSource ? edge.targetType : edge.sourceType;
      if (otherType !== 'entry') continue;

      const edgeRec = allRecs.find(r => r.id === otherId);
      if (!edgeRec) continue;
      const existing = scored.get(otherId);
      const edgeScore = edge.metadata?.score || 0.5;
      let label;
      if (edge.edgeType === 'SIMILAR_TO') {
        label = edgeScore > 0 ? `${Math.round(edgeScore * 100)}% similar` : 'similar';
      } else if (edge.edgeType === 'PARTICIPATED_IN') {
        label = 'shared participant';
      } else if (edge.edgeType === 'DERIVED_FROM') {
        label = 'derived';
      } else {
        label = edge.edgeType.toLowerCase().replace(/_/g, ' ');
      }
      if (existing) {
        existing.score = Math.max(existing.score, edgeScore);
        if (!existing.reasons.includes(label)) existing.reasons.push(label);
      } else {
        scored.set(otherId, { entry: edgeRec, score: edgeScore, reasons: [label] });
      }
    }
  } catch { /* edge store unavailable — graceful degradation */ }

  const related = [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  if (!related.length) {
    list.innerHTML = `<span style="font-size:var(--font-xs);color:var(--color-text-disabled);font-style:italic;padding:4px 0;">No connections yet — the autonomy engine will find related entries over time.</span>`;
    return;
  }

  list.innerHTML = related.map(({ entry: r, score, reasons }) => {
    const cardAccent = typeAccent(r.type || 'screen');
    const dateLabel = r.date ? new Date(r.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    const title = (r.title || 'Untitled').length > 32 ? (r.title || 'Untitled').slice(0, 30) + '…' : (r.title || 'Untitled');
    // Build badge HTML for each reason
    const badgesHtml = reasons.map(reason => {
      const isSimilar = reason.includes('similar');
      const bg = isSimilar ? 'rgba(59,130,246,0.12)' : 'rgba(139,92,246,0.10)';
      const color = isSimilar ? 'var(--color-primary-light)' : 'var(--color-info)';
      return `<span style="font-size:9px;padding:1px 5px;border-radius:6px;background:${bg};color:${color};white-space:nowrap;">${esc(reason)}</span>`;
    }).join('');

    return `<button class="rd-related-card" data-related-id="${esc(r.id)}" style="
      flex:0 0 auto;scroll-snap-align:start;
      width:150px;padding:10px 12px;
      background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
      border-radius:var(--radius-md);cursor:pointer;
      display:flex;flex-direction:column;gap:6px;
      text-align:left;font-family:inherit;
      transition:background 120ms ease,border-color 120ms ease;
    ">
      <div style="display:flex;align-items:center;gap:5px;">
        <span style="width:6px;height:6px;border-radius:50%;background:${cardAccent};flex-shrink:0;"></span>
        <span style="font-size:var(--font-xs);color:var(--color-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-weight:var(--weight-semi);">${esc(title)}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:3px;">${badgesHtml}</div>
      ${dateLabel ? `<span style="font-size:9px;color:var(--color-text-disabled);">${esc(dateLabel)}</span>` : ''}
    </button>`;
  }).join('');

  // Click → navigate to that entry
  list.querySelectorAll('.rd-related-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const relId = btn.dataset.relatedId;
      const relRec = allRecs.find(r => r.id === relId);
      if (relRec) {
        document.dispatchEvent(new CustomEvent(OPEN_ENTRY, { detail: { entry: relRec } }));
      }
    });
    // Hover effect
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.06)'; btn.style.borderColor = 'rgba(255,255,255,0.12)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(255,255,255,0.03)'; btn.style.borderColor = 'rgba(255,255,255,0.07)'; });
  });
}



// ── Tab Content Renderers ──────────────────────────────────────────────────

async function _renderTabContent(container, tabId, entry, onUpdate, hasEmbeddings, vttSegments, chapters, tldw) {
  switch (tabId) {
    case 'ask':     _renderAskTab(container, entry, hasEmbeddings); break;
    case 'summary': await _renderSummaryTab(container, entry, chapters, tldw); break;
    case 'transcript': _renderTranscriptTab(container, entry, vttSegments); break;
    case 'tasks':   renderTasksPanel(container, entry, onUpdate); break;
  }
}

function _renderAskTab(container, entry, hasEmbeddings) {
  if (!hasEmbeddings) {
    container.innerHTML = `
      <div class="rd-empty-state">
        ${icons.search(24)}
        <p class="mt-2">Process this entry with AI to enable Ask.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="rd-pad">
      <div class="set-flex-row mb-3" >
        <input type="text" class="input flex-1" id="rd-ask-input" aria-label="Ask about this entry" placeholder="Ask about this entry…" autocomplete="off"  />
        <button class="btn btn-primary btn-sm" id="rd-ask-submit">Ask</button>
      </div>
      <div id="rd-ask-result" class="text-sm-secondary"></div>
    </div>`;

  const input = container.querySelector('#rd-ask-input');
  const submitBtn = container.querySelector('#rd-ask-submit');
  const resultDiv = container.querySelector('#rd-ask-result');

  async function doAsk() {
    const q = input?.value?.trim();
    if (!q) return;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<div class="spinner spinner-sm" ></div>`;

    // Record search signal for RL preference learning
    recordSignal('SEARCH_CLICKED', {
      contentId: entry.id,
      queryLength: q.length,
    }).catch(() => {});
    resultDiv.innerHTML = '<div class="text-muted">Thinking…</div>';

    try {
      const aiConfig = getEffectiveAIConfig();
      const apiKey = aiConfig.apiKey;
      const provider = aiConfig.provider;
      if (!apiKey && !aiConfig.useProxy) {
        resultDiv.innerHTML = '<div class="text-danger">No API key configured. Add one in Settings or join a workspace.</div>';
        return;
      }
      const allEmb = await getAllEmbeddings();
      // Filter to this entry's embeddings only
      const recEmb = allEmb.filter(e => e.contentId === entry.id);
      const topChunks = await semanticSearch(q, recEmb, apiKey, provider, 5, aiConfig);

      if (!topChunks.length) {
        resultDiv.innerHTML = '<div class="text-muted">No relevant content found for this query.</div>';
        return;
      }

      const answer = await generateAnswer(q, topChunks, [entry], apiKey, provider, aiConfig);
      resultDiv.innerHTML = renderMarkdown(answer);
    } catch (e) {
      resultDiv.innerHTML = `<div class="text-danger">Error: ${esc(e.message)}</div>`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Ask';
    }
  }

  submitBtn?.addEventListener('click', doAsk);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAsk(); });
}

/** Bind Ask handlers for inline combined brief mode */
function _bindAskHandlers(input, submitBtn, resultDiv, entry) {
  async function doAsk() {
    const q = input?.value?.trim();
    if (!q) return;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<div class="spinner spinner-sm"></div>`;
    recordSignal('SEARCH_CLICKED', { contentId: entry.id, queryLength: q.length }).catch(() => {});
    resultDiv.innerHTML = '<div class="text-muted">Thinking…</div>';
    try {
      const aiConfig = getEffectiveAIConfig();
      const apiKey = aiConfig.apiKey;
      const provider = aiConfig.provider;
      if (!apiKey && !aiConfig.useProxy) {
        resultDiv.innerHTML = '<div class="text-danger">No API key configured. Add one in Settings or join a workspace.</div>';
        return;
      }
      const allEmb = await getAllEmbeddings();
      const recEmb = allEmb.filter(e => e.contentId === entry.id);
      const topChunks = await semanticSearch(q, recEmb, apiKey, provider, 5, aiConfig);
      if (!topChunks.length) {
        resultDiv.innerHTML = '<div class="text-muted">No relevant content found for this query.</div>';
        return;
      }
      const answer = await generateAnswer(q, topChunks, [entry], apiKey, provider, aiConfig);
      resultDiv.innerHTML = renderMarkdown(answer);
    } catch (e) {
      resultDiv.innerHTML = `<div class="text-danger">Error: ${esc(e.message)}</div>`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Ask';
    }
  }
  submitBtn?.addEventListener('click', doAsk);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAsk(); });
}

async function _renderSummaryTab(container, entry, chapters, tldw) {
  if (!entry.aiSummary) {
    container.innerHTML = `
      <div class="rd-empty-state">
        ${icons.edit(24)}
        <p class="mt-2">No summary available yet.</p>
        <p class="ins-muted-label">Summary is generated after AI processing completes.</p>
      </div>`;
    return;
  }

  const chaptersHtml = chapters.length ? `
    <div class="mb-3">
      <div class="hist-related-label mb-2" >Chapters</div>
      <div class="rd-flex-wrap">
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
  // Classify insights from this entry's summary (async, non-blocking)
  let knowledgePillsHtml = '';
  let chainHtml = '';
  try {
    const { classifySummaryInsights, computeAssumptionRisk, buildReasoningChain } = await import('../lib/knowledge-framework.js');
    const insights = classifySummaryInsights(entry.aiSummary, entry.id);
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
        <div class="rd-flex-wrap" style="gap:6px;margin-bottom:var(--space-3);font-size:10px;">
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
                    <span>⚠</span> No supporting evidence found
                  </div>`}
              </div>
            `).join('')}
          </details>`;
      }
    }
  } catch { /* non-critical */ }

  container.innerHTML = `
    <div class="rd-pad">
      ${tldwHtml}
      ${chaptersHtml}
      ${knowledgePillsHtml}
      ${chainHtml}
      <div class="rd-summary-body">${renderMarkdown(entry.aiSummary)}</div>
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

function _renderTranscriptTab(container, entry, vttSegments) {
  if (!vttSegments.length && !entry.textContent) {
    container.innerHTML = `
      <div class="rd-empty-state">
        ${icons.mic(24)}
        <p class="mt-2">No transcript available.</p>
      </div>`;
    return;
  }

  // Fallback: plain-text transcript (no timestamps, e.g. Gemini path)
  if (!vttSegments.length && entry.textContent) {
    container.innerHTML = `
      <div class="rd-pad">
        <div style="font-size:var(--font-sm);color:var(--color-text-secondary);line-height:1.8;white-space:pre-wrap;">${esc(entry.textContent)}</div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div style="padding:var(--space-2) var(--space-3);">
      <input type="text" class="input" id="rd-transcript-search" aria-label="Search transcript" placeholder="Search transcript…" autocomplete="off" style="font-size:var(--font-xs);margin-bottom:var(--space-2);" />
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
    // Remove previous timeupdate handler to prevent listener stacking
    if (video._takusTimeupdateHandler) {
      video.removeEventListener('timeupdate', video._takusTimeupdateHandler);
    }
    const timeupdateHandler = () => {
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
    };
    video._takusTimeupdateHandler = timeupdateHandler;
    video.addEventListener('timeupdate', timeupdateHandler);
  }
}

/**
 * Populate the "Connections" section from the knowledge graph edge store.
 * Groups edges by type and renders them as compact badge rows.
 */
async function _populateConnections(container, entry) {
  const edges = await getEdgesFromNode('entry', entry.id).catch(() => []);
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
    const extra = items.length > 4 ? `<span class="text-10-disabled">+${items.length - 4}</span>` : '';
    return `
      <div class="flex-center" style="gap:6px;padding:4px 0;">
        <span>${cfg.icon}</span>
        <span style="font-size:var(--font-xs);color:${cfg.cssVar};font-weight:var(--weight-semi);min-width:65px;">${cfg.label}</span>
        <div style="display:flex;flex-wrap:wrap;gap:3px;flex:1;">${preview}${extra}</div>
      </div>`;
  }).join('');

  slot.style.display = '';
  list.innerHTML = html;
}

/**
 * Populate the "🎯 Linked Goals" section from CONTRIBUTES_TO edges.
 * Shows goals detected in this entry's transcript.
 */
async function _populateGoals(container, entry) {
  const edges = await getEdgesFromNode('entry', entry.id).catch(() => []);
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
      <div class="flex-center" style="gap:6px;padding:4px 0;">
        <span>${icon}</span>
        <span style="font-size:var(--font-xs);color:var(--color-text-secondary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(title)}">${esc(title)}</span>
        <span style="font-size:10px;color:var(--color-text-disabled);text-transform:capitalize;">${esc(state)}</span>
      </div>`;
  }).join('');
}
