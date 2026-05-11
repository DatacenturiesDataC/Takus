// Takus — History Panel
import { icons } from '../lib/icons.js';
import { getRecordings, saveRecording, deleteRecording, clearAllRecordings, getRecordingBlob, deleteRecordingBlob, deleteEmbeddings, getAllEmbeddings } from '../lib/storage.js';
import { formatDuration, formatSize } from '../lib/recorder.js';
import { toast } from './toast.js';
import { renderSharePanel } from './share-panel.js';
import { typeLabel, typeAccent } from './type-picker.js';
import { renderTasksPanel, tasksBadge } from './tasks-panel.js';
import { extractTLDW, parseChapters } from '../lib/analytics.js';
import { cosineSimilarity } from '../lib/embeddings.js';

const INITIAL_LIMIT = 20;

export async function renderHistoryPanel(container, shortcuts = {}, initialDateFilter = '') {
  // Render a skeleton immediately so the panel isn't blank while IndexedDB loads
  if (!container.querySelector('.card')) {
    const skRow = () => `
      <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3);">
        <div style="width:32px;height:32px;border-radius:var(--radius-md);flex-shrink:0;background:linear-gradient(90deg,rgba(255,255,255,0.05) 25%,rgba(255,255,255,0.1) 50%,rgba(255,255,255,0.05) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px;">
          <div style="height:13px;width:55%;border-radius:var(--radius-sm);background:linear-gradient(90deg,rgba(255,255,255,0.05) 25%,rgba(255,255,255,0.1) 50%,rgba(255,255,255,0.05) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;"></div>
          <div style="height:11px;width:35%;border-radius:var(--radius-sm);background:linear-gradient(90deg,rgba(255,255,255,0.05) 25%,rgba(255,255,255,0.1) 50%,rgba(255,255,255,0.05) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;"></div>
        </div>
      </div>`;
    container.innerHTML = `
      <div class="card card-compact">
        <div class="card-header"><h3>History</h3></div>
        <div style="display:flex;flex-direction:column;gap:var(--space-1);">
          ${skRow()}${skRow()}${skRow()}
        </div>
      </div>`;
  }

  const recordings = await getRecordings().catch(() => []);
  const recKey = (shortcuts.record || 'r').toUpperCase();

  if (recordings.length === 0) {
    container.innerHTML = `
      <div class="card card-compact animate-in">
        <div class="card-header"><h3>History</h3></div>
        <div class="empty-state" style="padding:var(--space-6) var(--space-4);">
          ${icons.video(32)}
          <p>No recordings yet</p>
          <p style="font-size:var(--font-xs);color:var(--color-text-disabled);margin-top:calc(-1 * var(--space-2));">Press <kbd style="background:var(--color-bg-elevated);padding:2px 6px;border-radius:4px;">${recKey}</kbd> or click the record button to start</p>
        </div>
      </div>`;
    return;
  }

  let showAll = recordings.length <= INITIAL_LIMIT;
  let activeTypeFilter = '';
  let _activeDateFilter = initialDateFilter;

  // Track per-item UI state so re-renders from search/filter don't collapse open
  // summary boxes or reset the active tab back to "Summary".
  const _expandedIds = new Set();
  const _activeTabMap = new Map();

  // Related recordings — loaded once in the background after first render.
  let _allEmbeddings = [];

  // Aggregate stats for header strip
  const totalDuration = recordings.reduce((s, r) => s + (r.duration || 0), 0);
  const totalSize = recordings.reduce((s, r) => s + (r.size || 0), 0);

  // Compute type counts for filter chips
  const typeCounts = {};
  for (const r of recordings) {
    const t = r.type || 'screen';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  const uniqueTypes = Object.keys(typeCounts);

  function filteredRecordings(searchQ) {
    let list = activeTypeFilter
      ? recordings.filter(r => (r.type || 'screen') === activeTypeFilter)
      : recordings;
    if (_activeDateFilter) list = _filterByDate(list, _activeDateFilter);
    if (searchQ) {
      const q = searchQ.toLowerCase();
      list = list.filter(r =>
        (r.title || '').toLowerCase().includes(q) ||
        typeLabel(r.type || 'screen').toLowerCase().includes(q) ||
        (r.aiSummary || '').toLowerCase().includes(q) ||
        (r.aiTranscript || '').toLowerCase().includes(q)
      );
    }
    return list;
  }

  function buildItems(list, searchQ = '') {
    if (!list.length) {
      return `<div style="padding:var(--space-4);text-align:center;font-size:var(--font-sm);color:var(--color-text-muted);">No recordings match your search.</div>`;
    }
    return list.map(r => {
      const date = new Date(r.date);
      const ago = timeAgo(date);
      return `
        <div class="history-item" data-id="${r.id}" style="display:flex; flex-direction:column; gap:var(--space-2);">
          <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
            <div style="display:flex; align-items:center; gap:var(--space-3); min-width:0;">
              <div class="history-icon">${icons.video(16)}</div>
              <div class="history-info" style="min-width:0;">
                <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;">
                  <div class="history-title" title="Double-click to rename">${highlight(r.title || 'Untitled', searchQ)}</div>
                  ${_typeBadge(r.type)}
                </div>
                <div class="history-meta">${ago} · ${formatDuration(r.duration)} · ${formatSize(r.size)}</div>
                ${_metaTags(r)}
              </div>
            </div>
            <div class="history-actions" style="flex-shrink:0;">
              ${r.aiSummary ? `<button class="btn btn-ghost btn-icon btn-sm history-summary-toggle" title="View AI Summary" data-target="${r.id}">${icons.zap(14)}</button>` : ''}
              ${r.aiSummary ? `<button class="btn btn-ghost btn-icon btn-sm history-share-link" title="Copy shareable summary link" data-id="${r.id}">${icons.send(14)}</button>` : ''}
              <button class="btn btn-ghost btn-icon btn-sm history-watch" title="Watch recording" data-id="${r.id}">${icons.play(14)}</button>
              ${(r.participants?.length) ? `<button class="btn btn-ghost btn-icon btn-sm history-share" title="Share with ${r.participants.length} participant${r.participants.length !== 1 ? 's' : ''}" data-id="${r.id}">${icons.users(14)}</button>` : ''}
              ${(r.aiDocLink && r.aiDocLink.startsWith('https://')) ? `<a href="${esc(r.aiDocLink)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-icon btn-sm" title="Open meeting notes">${icons.info(14)}</a>` : ''}
              ${(r.driveLink && r.driveLink.startsWith('https://')) ? `
                <button class="btn btn-ghost btn-icon btn-sm history-copy-link" title="Copy cloud link" data-link="${esc(r.driveLink)}">${icons.link(14)}</button>
                <a href="${esc(r.driveLink)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-icon btn-sm" title="Open in cloud">${icons.externalLink(14)}</a>
              ` : ''}
              <button class="btn btn-ghost btn-icon btn-sm history-delete" title="Delete" data-id="${r.id}">${icons.trash(14)}</button>
            </div>
          </div>
          ${_tldwStrip(r)}
          ${r.aiSummary ? `
          <div class="ai-summary-box hidden" data-id="${r.id}" style="background:rgba(255,255,255,0.03); border-radius:var(--radius-md); padding:var(--space-3); margin-top:var(--space-2); font-size:var(--font-sm); color:var(--color-text-secondary); border:1px solid rgba(255,255,255,0.05);">
            <!-- Tab bar -->
            <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-2);margin-bottom:var(--space-2);">
              <div style="display:flex;gap:2px;">
                <button class="ai-tab active" data-tab="summary" data-id="${r.id}" style="font-size:var(--font-xs);padding:3px 10px;border-radius:6px 6px 0 0;border:none;cursor:pointer;background:rgba(255,255,255,0.08);color:var(--color-primary-light);font-weight:var(--weight-semi);">${icons.zap(12)} Summary</button>
                ${r.aiVtt || r.aiTranscript ? `<button class="ai-tab" data-tab="transcript" data-id="${r.id}" style="font-size:var(--font-xs);padding:3px 10px;border-radius:6px 6px 0 0;border:none;cursor:pointer;background:transparent;color:var(--color-text-muted);font-weight:var(--weight-semi);">${icons.info(12)} Transcript</button>` : ''}
                ${r.tasks ? `<button class="ai-tab" data-tab="tasks" data-id="${r.id}" style="font-size:var(--font-xs);padding:3px 10px;border-radius:6px 6px 0 0;border:none;cursor:pointer;background:transparent;color:var(--color-text-muted);font-weight:var(--weight-semi);">${icons.checkSquare(12)} Tasks${tasksBadge(r) ? ` <span style="background:var(--color-primary);color:#fff;border-radius:8px;padding:0 4px;font-size:9px;margin-left:2px;">${tasksBadge(r)}</span>` : ''}</button>` : ''}
              </div>
              <div style="display:flex;gap:var(--space-1);">
                <button class="btn btn-ghost btn-sm history-copy-summary" data-id="${r.id}" title="Copy summary">${icons.link(14)} Copy</button>
                ${r.aiTranscript ? `<button class="btn btn-ghost btn-sm history-download-md" data-id="${r.id}" title="Download as Markdown">${icons.download(14)} .md</button>` : ''}
                ${r.aiVtt ? `<button class="btn btn-ghost btn-sm history-download-vtt" data-id="${r.id}" title="Download subtitles (.vtt)">${icons.download(14)} .vtt</button>` : ''}
              </div>
            </div>
            <!-- Tab content -->
            <div class="ai-tab-content" data-tab="summary" data-id="${r.id}" style="line-height:1.6;">${renderMarkdown(r.aiSummary)}</div>
            ${r.aiVtt || r.aiTranscript ? `<div class="ai-tab-content hidden" data-tab="transcript" data-id="${r.id}">${r.aiVtt ? renderTranscriptViewer(parseVTT(r.aiVtt)) : `<p style="font-size:var(--font-xs);color:var(--color-text-secondary);white-space:pre-wrap;line-height:1.6;">${esc(r.aiTranscript)}</p>`}</div>` : ''}
            ${r.tasks ? `<div class="ai-tab-content hidden" data-tab="tasks" data-id="${r.id}"></div>` : ''}
            <div class="related-slot" data-id="${r.id}" style="display:none;margin-top:var(--space-2);padding-top:var(--space-2);border-top:1px solid rgba(255,255,255,0.05);"></div>
          </div>
          ` : ''}
        </div>`;
    }).join('');
  }

  const hasMore = recordings.length > INITIAL_LIMIT;

  // Load embeddings in the background — available for related-recording lookups.
  getAllEmbeddings().then(embs => { _allEmbeddings = embs; }).catch(() => {});

  container.innerHTML = `
    <div class="card card-compact animate-in">
      <div class="card-header">
        <h3>History</h3>
        <div style="display:flex;align-items:center;gap:var(--space-2);">
          ${(totalDuration > 0 || totalSize > 0) ? `<span style="font-size:var(--font-xs);color:var(--color-text-muted);">${formatDuration(totalDuration)} · ${formatSize(totalSize)}</span>` : ''}
          <button class="btn btn-ghost btn-icon btn-sm" id="history-export" title="Export library as JSON">${icons.download(13)}</button>
          <label class="btn btn-ghost btn-icon btn-sm" for="history-import-input" title="Import library from JSON" style="cursor:pointer;">${icons.upload(13)}</label>
          <input type="file" id="history-import-input" accept=".json" style="display:none;" />
          <span class="badge badge-neutral">${recordings.length}</span>
          <button class="btn btn-ghost btn-sm" id="history-clear-all" style="font-size:var(--font-xs);color:var(--color-text-muted);" title="Clear all recordings">${icons.trash(12)}</button>
        </div>
      </div>
      ${recordings.length > 4 ? `
        <div style="padding:0 var(--space-3) var(--space-2);">
          <div style="display:flex;align-items:center;gap:var(--space-2);background:rgba(255,255,255,0.04);border-radius:var(--radius-md);padding:6px var(--space-3);border:1px solid rgba(255,255,255,0.08);">
            <span style="color:var(--color-text-muted);flex-shrink:0;">${icons.search(14)}</span>
            <input type="search" id="history-search" placeholder="Search recordings…" style="background:none;border:none;outline:none;color:inherit;font-size:var(--font-sm);flex:1;min-width:0;" autocomplete="off" />
          </div>
        </div>
      ` : ''}
      ${uniqueTypes.length > 1 ? `
        <div id="type-filter-row" style="display:flex;gap:var(--space-2);flex-wrap:wrap;padding:0 var(--space-3) var(--space-2);">
          <button class="type-chip active" data-type="">All <span style="opacity:0.7;">${recordings.length}</span></button>
          ${uniqueTypes.map(t => `
            <button class="type-chip" data-type="${t}" style="--chip-accent:${typeAccent(t)}">
              ${typeLabel(t)} <span style="opacity:0.7;">${typeCounts[t]}</span>
            </button>
          `).join('')}
        </div>
      ` : ''}
      ${recordings.length > 4 ? `
        <div id="date-filter-row" style="display:flex;gap:var(--space-2);flex-wrap:wrap;padding:0 var(--space-3) ${uniqueTypes.length > 1 ? '0' : 'var(--space-2)'};">
          ${['today','week','month'].map(k => `
            <button class="date-chip ${_activeDateFilter === k ? 'active' : ''}" data-date="${k}">
              ${k === 'today' ? 'Today' : k === 'week' ? 'This week' : 'This month'}
            </button>`).join('')}
          ${_activeDateFilter && !['today','week','month'].includes(_activeDateFilter) ? `<button class="date-chip active" data-date="${esc(_activeDateFilter)}">${esc(_activeDateFilter)} ×</button>` : ''}
          ${_activeDateFilter ? `<button class="date-chip" data-date="" style="opacity:0.6;font-size:10px;">× Clear</button>` : ''}
        </div>
      ` : ''}
      <div id="history-list" style="display:flex;flex-direction:column;gap:var(--space-2);max-height:clamp(240px, 40vh, 520px);overflow-y:auto;">
        ${buildItems(recordings.slice(0, INITIAL_LIMIT), '')}
      </div>
      ${hasMore ? `
        <div style="padding:var(--space-2) var(--space-3);text-align:center;">
          <button class="btn btn-ghost btn-sm" id="history-show-more" style="font-size:var(--font-xs);color:var(--color-text-muted);">
            Show ${recordings.length - INITIAL_LIMIT} more…
          </button>
        </div>
      ` : ''}
    </div>`;

  function bindHandlers(scope) {
    scope.querySelectorAll('.history-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        if (!confirm('Delete this recording from history? This cannot be undone.')) return;
        await Promise.all([deleteRecording(id), deleteRecordingBlob(id), deleteEmbeddings(id)]);
        toast.info('Recording deleted');
        renderHistoryPanel(container, shortcuts, _activeDateFilter);
      });
    });

    scope.querySelectorAll('.history-watch').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const rec = recordings.find(r => r.id === id);
        const blob = await getRecordingBlob(id).catch(() => null);
        if (!blob) {
          const msg = rec?.driveLink
            ? 'Video not stored locally — open from cloud storage instead.'
            : 'Video not stored locally. It may have been recorded before this feature was added.';
          toast.info('Not available locally', msg);
          return;
        }
        const chapters = rec?.aiSummary ? parseChapters(rec.aiSummary) : [];
        _showWatchModal(blob, rec?.title || 'Recording', chapters);
      });
    });

    scope.querySelectorAll('.history-summary-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.history-item');
        const id = item?.dataset.id;
        const summaryBox = item?.querySelector('.ai-summary-box');
        if (summaryBox) {
          summaryBox.classList.toggle('hidden');
          if (id) {
            if (summaryBox.classList.contains('hidden')) {
              _expandedIds.delete(id);
            } else {
              _expandedIds.add(id);
              _renderRelated(summaryBox, id, _allEmbeddings, recordings);
            }
          }
        }
      });
    });

    // Tab switching inside AI summary box
    scope.querySelectorAll('.ai-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabName = e.currentTarget.dataset.tab;
        const id = e.currentTarget.dataset.id;
        const box = e.currentTarget.closest('.ai-summary-box');
        if (!box) return;
        if (id) _activeTabMap.set(id, tabName);
        box.querySelectorAll('.ai-tab').forEach(t => {
          const isActive = t.dataset.tab === tabName;
          t.classList.toggle('active', isActive);
          t.style.background = isActive ? 'rgba(255,255,255,0.08)' : 'transparent';
          t.style.color = isActive ? 'var(--color-primary-light)' : 'var(--color-text-muted)';
        });
        box.querySelectorAll('.ai-tab-content').forEach(c => {
          c.classList.toggle('hidden', c.dataset.tab !== tabName);
        });
        // Lazily render the Tasks panel the first time its tab is activated
        if (tabName === 'tasks' && id) {
          const tasksPane = box.querySelector(`.ai-tab-content[data-tab="tasks"][data-id="${id}"]`);
          if (tasksPane && !tasksPane.dataset.rendered) {
            tasksPane.dataset.rendered = '1';
            const rec = recordings.find(r => r.id === id);
            if (rec) {
              renderTasksPanel(tasksPane, rec, (updated) => {
                // Patch the in-memory recording so badge counts stay current without a full re-render
                const idx = recordings.findIndex(r => r.id === updated.id);
                if (idx >= 0) recordings[idx] = updated;
              });
            }
          }
        }
      });
    });

    scope.querySelectorAll('.history-download-md').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const rec = recordings.find(r => r.id === id);
        if (!rec) return;
        const date = new Date(rec.date).toLocaleString();
        const lines = [
          `# ${rec.title || 'Untitled'}`,
          `_${date} · ${formatDuration(rec.duration)} · ${rec.type || 'recording'}_`,
          '',
          '## Summary',
          rec.aiSummary || '',
        ];
        if (rec.aiTranscript) {
          lines.push('', '## Transcript', rec.aiTranscript);
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(rec.title || 'recording').replace(/[^a-z0-9]+/gi, '-')}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      });
    });

    scope.querySelectorAll('.history-download-vtt').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const rec = recordings.find(r => r.id === id);
        if (rec && rec.aiVtt) {
          const blob = new Blob([rec.aiVtt], { type: 'text/vtt' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${rec.title || 'recording'}.vtt`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
      });
    });

    scope.querySelectorAll('.history-copy-link').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const link = e.currentTarget.dataset.link;
        try {
          await navigator.clipboard.writeText(link);
          const b = e.currentTarget;
          const orig = b.innerHTML;
          b.innerHTML = icons.check(14);
          setTimeout(() => { if (b) b.innerHTML = orig; }, 1500);
        } catch {
          toast.info('Cloud link', link);
        }
      });
    });

    scope.querySelectorAll('.history-copy-summary').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const rec = recordings.find(r => r.id === id);
        if (!rec?.aiSummary) return;
        try {
          await navigator.clipboard.writeText(rec.aiSummary);
          const b = e.currentTarget;
          const orig = b.innerHTML;
          b.innerHTML = `${icons.check(14)} Copied!`;
          setTimeout(() => { if (b) b.innerHTML = orig; }, 1500);
        } catch {
          toast.info('Summary', rec.aiSummary.slice(0, 200));
        }
      });
    });

    scope.querySelectorAll('.history-copy-transcript').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const rec = recordings.find(r => r.id === id);
        if (!rec?.aiTranscript) return;
        try {
          await navigator.clipboard.writeText(rec.aiTranscript);
          const b = e.currentTarget;
          const orig = b.innerHTML;
          b.innerHTML = `${icons.check(14)} Copied!`;
          setTimeout(() => { if (b) b.innerHTML = orig; }, 1500);
        } catch {
          toast.info('Transcript copied');
        }
      });
    });

    scope.querySelectorAll('.history-share').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const rec = recordings.find(r => r.id === id);
        if (!rec) return;
        renderSharePanel({
          participants: rec.participants || [],
          recordingTitle: rec.title || '',
          driveLink: rec.driveLink || '',
          aiSummary: rec.aiSummary || '',
        });
      });
    });

    scope.querySelectorAll('.history-share-link').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const rec = recordings.find(r => r.id === id);
        if (!rec?.aiSummary) return;
        const payload = { title: rec.title, date: rec.date, type: rec.type, aiSummary: rec.aiSummary };
        const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
        const url = `${location.origin}${location.pathname}#share=${encoded}`;
        const b = e.currentTarget;
        const orig = b.innerHTML;
        try {
          await navigator.clipboard.writeText(url);
          b.innerHTML = icons.check(14);
          setTimeout(() => { if (b) b.innerHTML = orig; }, 1800);
          toast.success('Link copied', 'Share it with anyone — no Takus account needed');
        } catch {
          toast.info('Share link', url.slice(0, 80) + '…');
        }
      });
    });
  }

  container.querySelector('#history-clear-all')?.addEventListener('click', async () => {
    if (!confirm(`Delete all ${recordings.length} recordings from history? This cannot be undone.`)) return;
    await clearAllRecordings();
    toast.info('All recordings cleared');
    renderHistoryPanel(container);
  });

  // Library export — downloads all recording metadata (blobs excluded) as JSON
  container.querySelector('#history-export')?.addEventListener('click', async () => {
    const exportData = {
      version: 1,
      exportedAt: Date.now(),
      recordings: recordings.map(({ observerLog: _obs, ...r }) => r),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `takus-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast.success('Library exported', `${recordings.length} recording${recordings.length !== 1 ? 's' : ''} saved`);
  });

  // Library import — merges recordings from a JSON export file
  container.querySelector('#history-import-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data.recordings)) throw new Error('Not a valid Takus export file');
      const existingIds = new Set(recordings.map(r => r.id));
      let imported = 0, skipped = 0;
      for (const rec of data.recordings) {
        if (!rec.id || !rec.date) { skipped++; continue; }
        if (existingIds.has(rec.id)) { skipped++; continue; }
        await saveRecording(rec);
        imported++;
      }
      toast.success('Import complete', `${imported} recording${imported !== 1 ? 's' : ''} added${skipped ? `, ${skipped} skipped` : ''}`);
      renderHistoryPanel(container, shortcuts, _activeDateFilter);
    } catch (err) {
      toast.error('Import failed', err.message);
    }
  });

  container.querySelector('#history-show-more')?.addEventListener('click', () => {
    showAll = true;
    const q = searchInput?.value?.trim() || '';
    _applyFilters(q);
    container.querySelector('#history-show-more')?.parentElement?.remove();
  });

  const searchInput = container.querySelector('#history-search');
  const countBadge = container.querySelector('.badge-neutral');

  function _applyFilters(searchQ = '') {
    const list = document.getElementById('history-list');
    if (!list) return;
    const base = filteredRecordings(searchQ);
    const visible = showAll ? base : base.slice(0, INITIAL_LIMIT);
    if (countBadge) {
      countBadge.textContent = (searchQ || activeTypeFilter) ? `${base.length} / ${recordings.length}` : recordings.length;
    }
    list.innerHTML = buildItems(visible, searchQ);

    // Restore expanded summary boxes and active tabs from before the re-render
    for (const id of _expandedIds) {
      const box = list.querySelector(`.ai-summary-box[data-id="${id}"]`);
      if (box) {
        box.classList.remove('hidden');
        _renderRelated(box, id, _allEmbeddings, recordings);
      }
    }
    for (const [id, tabName] of _activeTabMap) {
      if (tabName === 'summary') continue;
      const box = list.querySelector(`.ai-summary-box[data-id="${id}"]`);
      if (!box) continue;
      box.querySelectorAll('.ai-tab').forEach(t => {
        const isActive = t.dataset.tab === tabName;
        t.classList.toggle('active', isActive);
        t.style.background = isActive ? 'rgba(255,255,255,0.08)' : 'transparent';
        t.style.color = isActive ? 'var(--color-primary-light)' : 'var(--color-text-muted)';
      });
      box.querySelectorAll('.ai-tab-content').forEach(c => {
        c.classList.toggle('hidden', c.dataset.tab !== tabName);
      });
      // Re-render tasks pane if it was the active tab
      if (tabName === 'tasks') {
        const tasksPane = box.querySelector(`.ai-tab-content[data-tab="tasks"][data-id="${id}"]`);
        if (tasksPane && !tasksPane.dataset.rendered) {
          tasksPane.dataset.rendered = '1';
          const rec = recordings.find(r => r.id === id);
          if (rec) {
            renderTasksPanel(tasksPane, rec, (updated) => {
              const idx = recordings.findIndex(r => r.id === updated.id);
              if (idx >= 0) recordings[idx] = updated;
            });
          }
        }
      }
    }

    bindHandlers(list);
    // Hide 'Show more' when all filtered results are already shown
    const showMoreWrapper = container.querySelector('#history-show-more')?.parentElement;
    if (showMoreWrapper) {
      showMoreWrapper.style.display = (!showAll && base.length > INITIAL_LIMIT) ? '' : 'none';
    }
  }

  if (searchInput) {
    let _searchTimer = null;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => _applyFilters(e.target.value.trim()), 200);
    });
  }

  // Type filter chip clicks
  container.querySelector('#type-filter-row')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.type-chip');
    if (!chip) return;
    activeTypeFilter = chip.dataset.type || '';
    container.querySelectorAll('.type-chip').forEach(c => {
      c.classList.toggle('active', c === chip);
    });
    const q = searchInput?.value?.trim() || '';
    _applyFilters(q);
  });

  container.querySelector('#date-filter-row')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.date-chip');
    if (!chip) return;
    _activeDateFilter = chip.dataset.date || '';
    container.querySelectorAll('.date-chip').forEach(c => {
      c.classList.toggle('active', !!_activeDateFilter && c.dataset.date === _activeDateFilter);
    });
    const q = searchInput?.value?.trim() || '';
    _applyFilters(q);
  });

  bindHandlers(container);

  // Inline title rename — registered once on container to avoid stacking on re-renders
  container.addEventListener('dblclick', (e) => {
    const titleEl = e.target.closest('.history-title');
    if (!titleEl || titleEl.querySelector('input')) return;
    const item = titleEl.closest('.history-item');
    const id = item?.dataset.id;
    const rec = recordings.find(r => r.id === id);
    if (!rec) return;

    const originalTitle = rec.title || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input';
    input.value = originalTitle;
    input.style.cssText = 'font-size:var(--font-sm);font-weight:var(--weight-semi);padding:2px 6px;height:auto;min-width:0;flex:1;';
    input.maxLength = 200;

    titleEl.textContent = '';
    titleEl.appendChild(input);
    input.focus();
    input.select();

    const restore = (newTitle) => {
      titleEl.textContent = newTitle;
      titleEl.title = 'Double-click to rename';
    };

    let _committed = false;
    const saveTitle = async () => {
      if (_committed) return;
      _committed = true;
      const newTitle = input.value.trim() || originalTitle;
      rec.title = newTitle;
      restore(newTitle);
      await saveRecording(rec).catch(() => {});
    };

    input.addEventListener('blur', saveTitle);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { _committed = true; restore(originalTitle); }
    });
  });
}

function _typeBadge(type) {
  if (!type) return '';
  const label = typeLabel(type);
  const color = typeAccent(type);
  return `<span style="font-size:10px;font-weight:600;color:${color};background:${color}22;padding:1px 6px;border-radius:10px;white-space:nowrap;" title="Recording type">${label}</span>`;
}

function _tldwStrip(r) {
  if (!r.aiSummary) return '';
  const bullets = extractTLDW(r.aiSummary);
  if (!bullets.length) return '';
  return `
    <div class="tldw-strip" data-id="${r.id}">
      ${bullets.map(b => `<span class="tldw-bullet">${icons.arrowRight(9)} ${esc(b)}</span>`).join('')}
    </div>`;
}

function _metaTags(r) {
  const tags = [];

  // Device tag
  if (r.device) {
    tags.push(`<span class="history-tag history-tag--device" title="Recorded on ${esc(r.device)}">${icons.cpu(10)} ${esc(r.device)}</span>`);
  }

  // Cloud tag
  const cloud = _cloudLabel(r.driveLink);
  if (cloud) {
    tags.push(`<span class="history-tag history-tag--cloud" title="Stored in ${cloud}">${icons.cloud(10)} ${cloud}</span>`);
  } else {
    tags.push(`<span class="history-tag" title="Saved locally">${icons.hardDrive(10)} Local</span>`);
  }

  // AI tag
  if (r.aiProvider || r.aiSummary) {
    const aiLabel = r.aiProvider === 'gemini' ? 'Gemini' : r.aiProvider === 'openai' ? 'OpenAI' : 'AI';
    tags.push(`<span class="history-tag history-tag--ai" title="Processed with ${aiLabel}">${icons.zap(10)} ${aiLabel}</span>`);
  }

  // Quality score badge (Phase 4)
  if (r.analytics?.score) {
    const { score, label, color } = r.analytics.score;
    tags.push(`<span class="history-tag" style="color:${color};background:${color}18;border-color:${color}33;" title="Recording quality: ${label} (${score}/100)">${icons.shield(10)} ${score}</span>`);
  }

  // Filler word rating badge (Phase 4)
  if (r.analytics?.fillerWords?.total > 0) {
    const fw = r.analytics.fillerWords;
    if (fw.rating === 'needs_work' || fw.rating === 'fair') {
      tags.push(`<span class="history-tag" style="color:#f59e0b;background:rgba(245,158,11,0.1);" title="${fw.total} filler words · ${fw.perMinute}/min">${icons.alertTriangle(10)} ${fw.perMinute}/min</span>`);
    }
  }

  if (!tags.length) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">${tags.join('')}</div>`;
}

function _cloudLabel(driveLink) {
  if (!driveLink || !driveLink.startsWith('https://')) return null;
  if (driveLink.includes('drive.google.com') || driveLink.includes('docs.google.com')) return 'Google Drive';
  if (driveLink.includes('onedrive') || driveLink.includes('sharepoint') || driveLink.includes('1drv')) return 'OneDrive';
  return 'Cloud';
}


function _showWatchModal(blob, title, chapters = []) {
  document.getElementById('watch-overlay')?.remove();

  const url = URL.createObjectURL(blob);
  const overlay = document.createElement('div');
  overlay.id = 'watch-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--space-4);';

  const chaptersHtml = chapters.length
    ? `<div class="watch-chapters">
        ${chapters.map((c, i) => `
          <button class="watch-chapter-btn" data-seconds="${c.seconds}" title="Jump to ${_fmtSeconds(c.seconds)}">
            <span class="watch-chapter-index">${i + 1}</span>
            <span class="watch-chapter-title">${esc(c.title)}</span>
            <span class="watch-chapter-time">${_fmtSeconds(c.seconds)}</span>
          </button>`).join('')}
      </div>`
    : '';

  overlay.innerHTML = `
    <div style="width:100%;max-width:960px;display:flex;flex-direction:column;gap:var(--space-3);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);">
        <span style="font-weight:var(--weight-semi);color:#fff;font-size:var(--font-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(title)}</span>
        <button id="watch-close" style="flex-shrink:0;background:rgba(255,255,255,0.1);border:none;cursor:pointer;color:#fff;font-size:18px;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;" title="Close (Esc)">✕</button>
      </div>
      <video id="watch-video" src="${url}" controls autoplay style="width:100%;border-radius:var(--radius-lg);background:#000;max-height:72vh;outline:none;"></video>
      ${chaptersHtml}
      <p style="text-align:center;font-size:var(--font-xs);color:rgba(255,255,255,0.3);">Click outside or press <kbd style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:3px;">Esc</kbd> to close</p>
    </div>
  `;
  document.body.appendChild(overlay);

  const video = overlay.querySelector('#watch-video');

  overlay.querySelectorAll('.watch-chapter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      video.currentTime = Number(btn.dataset.seconds);
      video.play();
      overlay.querySelectorAll('.watch-chapter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const onEsc = (e) => { if (e.key === 'Escape') cleanup(); };
  const cleanup = () => {
    overlay.remove();
    URL.revokeObjectURL(url);
    document.removeEventListener('keydown', onEsc);
  };
  overlay.querySelector('#watch-close').addEventListener('click', cleanup);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
  document.addEventListener('keydown', onEsc);
}

function _fmtSeconds(s) {
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, '0');
  return `${m}:${sec}`;
}

function highlight(text, query) {
  const escaped = esc(text);
  if (!query) return escaped;
  // Escape the query the same way (esc encodes &, <, >, ") then escape regex metacharacters
  const escapedQuery = esc(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(
    new RegExp(escapedQuery, 'gi'),
    m => `<mark style="background:rgba(253,224,71,0.28);color:inherit;border-radius:2px;padding:0 1px;">${m}</mark>`,
  );
}

function timeAgo(date) {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function renderMarkdown(text) {
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

// Parse a WebVTT string into [{start, end, text}] segments
function parseVTT(vtt) {
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

function _secToTimestamp(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ── Phase 6: Related recordings ───────────────────────────────────────────────

function _renderRelated(box, recordingId, allEmbeddings, recordings) {
  const slot = box.querySelector(`.related-slot[data-id="${recordingId}"]`);
  if (!slot || slot.dataset.rendered) return;
  slot.dataset.rendered = '1';

  const related = _computeRelated(recordingId, allEmbeddings, recordings);
  if (!related.length) return;

  slot.style.display = '';
  slot.innerHTML = `
    <div style="font-size:10px;color:var(--color-text-disabled);margin-bottom:6px;display:flex;align-items:center;gap:4px;">${icons.link(10)} Similar recordings</div>
    <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);">
      ${related.map(r => `
        <button class="related-chip" data-related-id="${esc(r.id)}" title="${esc(r.title || 'Untitled')} · ${Math.round(r.score * 100)}% match">
          ${icons.video(10)} <span>${esc(r.title || 'Untitled')}</span>
          <span style="opacity:0.5;font-size:9px;">${Math.round(r.score * 100)}%</span>
        </button>
      `).join('')}
    </div>`;

  slot.querySelectorAll('.related-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const relId = chip.dataset.relatedId;
      const relItem = document.querySelector(`.history-item[data-id="${relId}"]`);
      if (!relItem) return;
      relItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const relBox = relItem.querySelector('.ai-summary-box');
      const relToggle = relItem.querySelector('.history-summary-toggle');
      if (relBox?.classList.contains('hidden') && relToggle) relToggle.click();
    });
  });
}

function _computeRelated(recordingId, allEmbeddings, recordings, topN = 2) {
  const srcEntry = allEmbeddings.find(e => e.recordingId === recordingId);
  if (!srcEntry?.chunks?.length) return [];
  const srcMean = _meanEmb(srcEntry.chunks);
  if (!srcMean) return [];

  const scored = [];
  for (const entry of allEmbeddings) {
    if (entry.recordingId === recordingId || !entry.chunks?.length) continue;
    const mean = _meanEmb(entry.chunks);
    if (!mean) continue;
    const score = cosineSimilarity(srcMean, mean);
    if (score > 0.35) {
      const rec = recordings.find(r => r.id === entry.recordingId);
      if (rec) scored.push({ ...rec, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}

function _meanEmb(chunks) {
  const valid = chunks.filter(c => c.embedding?.length > 0);
  if (!valid.length) return null;
  const dim = valid[0].embedding.length;
  const sum = new Array(dim).fill(0);
  for (const c of valid) for (let i = 0; i < dim; i++) sum[i] += c.embedding[i];
  return sum.map(v => v / valid.length);
}

function renderTranscriptViewer(segments) {
  if (!segments.length) return '<p style="color:var(--color-text-muted);font-size:var(--font-xs);">No transcript segments available.</p>';
  return `<div style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">` +
    segments.map(seg => `
      <div style="display:flex;gap:var(--space-2);font-size:var(--font-xs);line-height:1.5;">
        <span style="flex-shrink:0;font-variant-numeric:tabular-nums;color:var(--color-primary-light);font-weight:var(--weight-semi);padding-top:1px;">${_secToTimestamp(seg.start)}</span>
        <span style="color:var(--color-text-secondary);">${esc(seg.text)}</span>
      </div>`).join('') +
    '</div>';
}

function _filterByDate(list, filter) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filter === 'today') {
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    return list.filter(r => r.date >= today.getTime() && r.date < tomorrow.getTime());
  }
  if (filter === 'week') {
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 6);
    return list.filter(r => r.date >= weekAgo.getTime());
  }
  if (filter === 'month') {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return list.filter(r => r.date >= monthStart.getTime());
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(filter)) {
    const [y, m, d] = filter.split('-').map(Number);
    const dayStart = new Date(y, m - 1, d);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    return list.filter(r => r.date >= dayStart.getTime() && r.date < dayEnd.getTime());
  }
  return list;
}
