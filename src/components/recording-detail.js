// Takus — Recording Detail View (Phase 14c: FOCUS)
// 70/30 split layout: left pane (Ask, Summary, Transcript, Tasks) · right pane (video, metadata, downloads)
import { icons } from '../lib/icons.js';
import { esc, renderMarkdown, parseVTT } from '../lib/utils.js';
import { getRecordingBlob, getAllEmbeddings, getRecordings, saveRecording, deleteRecording, deleteRecordingBlob, deleteEmbeddings } from '../lib/storage.js';
import { typeLabel, typeAccent } from './type-picker.js';
import { renderTasksPanel } from './tasks-panel.js';
import { formatDuration, formatSize } from '../lib/recorder.js';
import { extractTLDW, parseChapters } from '../lib/analytics.js';
import { semanticSearch, cosineSimilarity } from '../lib/embeddings.js';
import { generateAnswer } from '../lib/ai-engine.js';
import { getSettings } from './settings-panel.js';
import { toast } from './toast.js';

function _fmtTime(sec) {
  if (!sec || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Render a full recording detail view with 70/30 split layout.
 * @param {HTMLElement} container
 * @param {object} recording  Full recording object from IndexedDB
 * @param {Function} onBack   Called when user clicks "Back"
 * @param {Function} onUpdate Called with updated recording after changes
 */
export async function renderRecordingDetail(container, recording, onBack, onUpdate) {
  const rec = recording;
  const accent = typeAccent(rec.type || 'screen');
  const dateStr = new Date(rec.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = new Date(rec.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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
    hasEmbeddings = allEmb.some(e => e.recordingId === rec.id && e.chunks?.length > 0);
  } catch {}

  // Default active tab
  let activeTab = hasSummary ? 'summary' : (hasEmbeddings ? 'ask' : 'summary');

  container.innerHTML = `
    <div class="recording-detail animate-in">
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
            </div>
          </div>` : ''}

          <!-- Related Recordings (populated async) -->
          <div class="rd-section" id="rd-related-slot" style="display:none;">
            <div class="rd-section-label">${icons.arrowRight(11)} Related</div>
            <div id="rd-related-list" style="display:flex;flex-direction:column;gap:4px;"></div>
          </div>

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
            </div>
          </div>
        </div>
      </div>
    </div>`;

  // ── Event bindings ────────────────────────────────────────────────────────

  // Back button
  container.querySelector('#rd-back')?.addEventListener('click', onBack);

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
    const blob = await getRecordingBlob(rec.id);
    if (blob && videoSlot) {
      const url = URL.createObjectURL(blob);
      videoSlot.innerHTML = `<video id="rd-video" src="${url}" controls preload="metadata" style="width:100%;border-radius:var(--radius-md);background:#000;max-height:220px;"></video>`;

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
      const blob = await getRecordingBlob(rec.id);
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
    rec.pinned = !rec.pinned;
    await saveRecording(rec).catch(() => {});
    const pinBtn = container.querySelector('#rd-action-pin');
    if (pinBtn) {
      const label = pinBtn.querySelector('span');
      if (label) label.textContent = rec.pinned ? 'Unpin recording' : 'Pin to top';
    }
    toast.success(rec.pinned ? 'Pinned' : 'Unpinned', rec.pinned ? 'Recording pinned to top of history' : 'Recording unpinned');
    if (onUpdate) onUpdate(rec);
  });

  // Delete
  container.querySelector('#rd-action-delete')?.addEventListener('click', async () => {
    if (!confirm(`Delete "${rec.title || 'Untitled'}"? This cannot be undone.`)) return;
    await Promise.all([
      deleteRecording(rec.id),
      deleteRecordingBlob(rec.id),
      deleteEmbeddings(rec.id),
    ]);
    toast.info('Deleted', 'Recording removed');
    if (onUpdate) onUpdate(rec);
    if (onBack) onBack();
  });

  // Notes auto-save on blur
  const notesTA = container.querySelector('#rd-notes');
  if (notesTA) {
    notesTA.addEventListener('blur', async () => {
      const val = notesTA.value.trim();
      if (val !== (rec.notes || '').trim()) {
        rec.notes = val || '';
        await saveRecording(rec).catch(() => {});
        if (onUpdate) onUpdate(rec);
      }
    });
  }

  // Async: populate related recordings via cosine similarity
  _populateRelated(container, rec).catch(() => {});
}

async function _populateRelated(container, rec) {
  const allEmb = await getAllEmbeddings().catch(() => []);
  const allRecs = await getRecordings().catch(() => []);
  if (allEmb.length < 2 || allRecs.length < 2) return;

  const srcEntry = allEmb.find(e => e.recordingId === rec.id);
  if (!srcEntry?.chunks?.length) return;

  const srcMean = _meanEmbedding(srcEntry.chunks);
  if (!srcMean) return;

  const scored = [];
  for (const entry of allEmb) {
    if (entry.recordingId === rec.id || !entry.chunks?.length) continue;
    const mean = _meanEmbedding(entry.chunks);
    if (!mean) continue;
    const score = cosineSimilarity(srcMean, mean);
    if (score > 0.35) {
      const r = allRecs.find(x => x.id === entry.recordingId);
      if (r) scored.push({ ...r, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const related = scored.slice(0, 3);
  if (!related.length) return;

  const slot = container.querySelector('#rd-related-slot');
  const list = container.querySelector('#rd-related-list');
  if (!slot || !list) return;

  slot.style.display = '';
  list.innerHTML = related.map(r => {
    const pct = Math.round(r.score * 100);
    const accent = typeAccent(r.type || 'screen');
    return `<button class="btn btn-ghost btn-sm rd-dl-btn rd-related-btn" data-related-id="${esc(r.id)}" style="justify-content:flex-start;gap:8px;">
      <span style="width:6px;height:6px;border-radius:50%;background:${accent};flex-shrink:0;"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;">${esc(r.title || 'Untitled')}</span>
      <span style="font-size:10px;color:var(--color-text-disabled);flex-shrink:0;">${pct}%</span>
    </button>`;
  }).join('');

  // Click → navigate to that recording
  list.querySelectorAll('.rd-related-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const relId = btn.dataset.relatedId;
      const relRec = allRecs.find(r => r.id === relId);
      if (relRec) {
        document.dispatchEvent(new CustomEvent('takus:open-recording', { detail: { recording: relRec } }));
      }
    });
  });
}

function _meanEmbedding(chunks) {
  const valid = chunks.filter(c => c.embedding?.length > 0);
  if (!valid.length) return null;
  const dim = valid[0].embedding.length;
  const sum = new Array(dim).fill(0);
  for (const c of valid) for (let i = 0; i < dim; i++) sum[i] += c.embedding[i];
  return sum.map(v => v / valid.length);
}

// ── Tab Content Renderers ──────────────────────────────────────────────────

function _renderTabContent(container, tabId, rec, onUpdate, hasEmbeddings, vttSegments, chapters, tldw) {
  switch (tabId) {
    case 'ask':     _renderAskTab(container, rec, hasEmbeddings); break;
    case 'summary': _renderSummaryTab(container, rec, chapters, tldw); break;
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
    resultDiv.innerHTML = '<div style="color:var(--color-text-muted);">Thinking…</div>';

    try {
      const settings = getSettings();
      const apiKey = settings.aiProvider === 'gemini' ? settings.geminiKey : settings.openaiKey;
      const provider = settings.aiProvider || 'openai';
      const allEmb = await getAllEmbeddings();
      // Filter to this recording's embeddings only
      const recEmb = allEmb.filter(e => e.recordingId === rec.id);
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

function _renderSummaryTab(container, rec, chapters, tldw) {
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
            <span style="color:var(--color-primary-light);font-weight:600;">${i + 1}.</span> ${esc(c.title)} <span style="color:var(--color-text-disabled);font-family:monospace;">${_fmtTime(c.seconds)}</span>
          </button>
        `).join('')}
      </div>
    </div>` : '';

  const tldwHtml = tldw ? `
    <div style="background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.15);border-radius:var(--radius-md);padding:var(--space-3);margin-bottom:var(--space-3);">
      <div style="font-size:10px;font-weight:var(--weight-semi);color:var(--color-primary-light);margin-bottom:var(--space-1);">TL;DW</div>
      <div style="font-size:var(--font-sm);color:var(--color-text-secondary);line-height:1.6;">${esc(tldw)}</div>
    </div>` : '';

  container.innerHTML = `
    <div style="padding:var(--space-3);">
      ${tldwHtml}
      ${chaptersHtml}
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
            <span class="rd-ts">${_fmtTime(Math.floor(seg.start))}</span>
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
