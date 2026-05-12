// Takus — History Panel
import { icons } from '../lib/icons.js';
import { esc, renderMarkdown, parseVTT } from '../lib/utils.js';
import { getRecordings, saveRecording, deleteRecording, clearAllRecordings, getRecordingBlob, deleteRecordingBlob, deleteEmbeddings, getAllEmbeddings } from '../lib/storage.js';
import { togglePin } from '../lib/archive-engine.js';
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
  let activeTagFilter = '';
  let _sortMode = 'newest';
  let _selectMode = false;
  const _selectedIds = new Set();

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

  const allTagsSet = new Set();
  for (const r of recordings) for (const t of (r.tags || [])) allTagsSet.add(t);
  const uniqueTags = [...allTagsSet].sort();

  function filteredRecordings(searchQ) {
    let list = activeTypeFilter
      ? recordings.filter(r => (r.type || 'screen') === activeTypeFilter)
      : recordings;
    if (_activeDateFilter) list = _filterByDate(list, _activeDateFilter);
    if (activeTagFilter) list = list.filter(r => (r.tags || []).includes(activeTagFilter));
    if (searchQ) {
      const q = searchQ.toLowerCase();
      list = list.filter(r =>
        (r.title || '').toLowerCase().includes(q) ||
        typeLabel(r.type || 'screen').toLowerCase().includes(q) ||
        (r.aiSummary || '').toLowerCase().includes(q) ||
        (r.aiTranscript || '').toLowerCase().includes(q) ||
        (r.tags || []).some(t => t.includes(q))
      );
    }
    const sorted = [...list].sort(_sortFn(_sortMode));
    sorted.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    return sorted;
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
              <input type="checkbox" class="batch-cb" data-id="${r.id}" style="display:${_selectMode ? 'block' : 'none'};accent-color:var(--color-primary);width:16px;height:16px;cursor:pointer;flex-shrink:0;" ${_selectedIds.has(r.id) ? 'checked' : ''} />
              <div class="history-icon">${icons.video(16)}</div>
              <div class="history-info" style="min-width:0;" title="Click to open · Double-click to rename">
                <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;">
                  <div class="history-title">${highlight(r.title || 'Untitled', searchQ)}</div>
                  ${_typeBadge(r.type)}
                </div>
                <div class="history-meta">${ago} · ${formatDuration(r.duration)} · ${formatSize(r.size)}${_archiveBadge(r)}</div>
                ${_metaTags(r)}
              </div>
            </div>
            <div class="history-actions" style="flex-shrink:0;">
              ${r.aiSummary ? `<button class="btn btn-ghost btn-icon btn-sm history-summary-toggle" title="View AI Summary" aria-label="View AI Summary" data-target="${r.id}">${icons.zap(14)}</button>` : ''}
              ${r.aiSummary ? `<button class="btn btn-ghost btn-icon btn-sm history-share-link" title="Copy shareable summary link" aria-label="Copy shareable link" data-id="${r.id}">${icons.send(14)}</button>` : ''}
              ${r.aiSummary ? `<button class="btn btn-ghost btn-icon btn-sm history-qr-link" title="Show QR code" aria-label="Show QR code for shareable link" data-id="${r.id}">${icons.qrCode(14)}</button>` : ''}
              <button class="btn btn-ghost btn-icon btn-sm history-watch" title="Watch recording" aria-label="Watch recording" data-id="${r.id}">${icons.play(14)}</button>
              <button class="btn btn-ghost btn-icon btn-sm history-note-btn ${r.notes ? 'has-note' : ''}" title="${r.notes ? 'Edit notes' : 'Add notes'}" aria-label="${r.notes ? 'Edit notes' : 'Add notes'}" data-id="${r.id}">${icons.edit(14)}</button>
              ${(r.participants?.length) ? `<button class="btn btn-ghost btn-icon btn-sm history-share" title="Share with participants" aria-label="Share with participants" data-id="${r.id}">${icons.users(14)}</button>` : ''}
              ${(r.aiDocLink && r.aiDocLink.startsWith('https://')) ? `<a href="${esc(r.aiDocLink)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-icon btn-sm" title="Open meeting notes" aria-label="Open meeting notes">${icons.info(14)}</a>` : ''}
              ${(r.driveLink && r.driveLink.startsWith('https://')) ? `
                <button class="btn btn-ghost btn-icon btn-sm history-copy-link" title="Copy cloud link" aria-label="Copy cloud link" data-link="${esc(r.driveLink)}">${icons.link(14)}</button>
                <a href="${esc(r.driveLink)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-icon btn-sm" title="Open in cloud" aria-label="Open in cloud">${icons.externalLink(14)}</a>
              ` : ''}
              <button class="btn btn-ghost btn-icon btn-sm history-tag-btn ${r.tags?.length ? 'has-tags' : ''}" title="Edit tags" aria-label="Edit tags" data-id="${r.id}">${icons.tag(14)}</button>
              <button class="btn btn-ghost btn-icon btn-sm history-pin ${r.pinned ? 'pinned' : ''}" title="${r.pinned ? 'Unpin recording' : 'Pin to top'}" aria-label="${r.pinned ? 'Unpin recording' : 'Pin recording to top'}" data-id="${r.id}">${icons.star(14)}</button>
              <button class="btn btn-ghost btn-icon btn-sm history-delete" title="Delete" aria-label="Delete recording" data-id="${r.id}">${icons.trash(14)}</button>
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
            ${r.aiVtt || r.aiTranscript ? `<div class="ai-tab-content hidden" data-tab="transcript" data-id="${r.id}">${r.aiVtt ? renderTranscriptViewer(parseVTT(r.aiVtt), r.id) : `<p style="font-size:var(--font-xs);color:var(--color-text-secondary);white-space:pre-wrap;line-height:1.6;">${esc(r.aiTranscript)}</p>`}</div>` : ''}
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
          <select id="history-sort" title="Sort recordings" aria-label="Sort recordings" style="font-size:var(--font-xs);background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:var(--radius-sm);color:var(--color-text-secondary);padding:2px 6px;cursor:pointer;">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="duration">Longest</option>
            <option value="quality">Best quality</option>
            <option value="size">Largest</option>
          </select>
          <button class="btn btn-ghost btn-sm" id="history-select-toggle" title="Select multiple" aria-label="Select multiple recordings" style="font-size:var(--font-xs);color:var(--color-text-muted);">${icons.checkSquare(12)} Select</button>
          <button class="btn btn-ghost btn-icon btn-sm" id="history-export" title="Export library as JSON" aria-label="Export library as JSON">${icons.download(13)}</button>
          <button class="btn btn-ghost btn-icon btn-sm" id="history-zip-export" title="Full backup with videos (ZIP)" aria-label="Full backup with videos">${icons.package(13)}</button>
          <label class="btn btn-ghost btn-icon btn-sm" for="history-import-input" title="Import library from JSON" aria-label="Import library from JSON" style="cursor:pointer;">${icons.upload(13)}</label>
          <input type="file" id="history-import-input" accept=".json" style="display:none;" aria-label="Import recordings file" />
          <span class="badge badge-neutral">${recordings.length}</span>
          <button class="btn btn-ghost btn-sm" id="history-clear-all" style="font-size:var(--font-xs);color:var(--color-text-muted);" title="Clear all recordings" aria-label="Clear all recordings">${icons.trash(12)}</button>
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
      ${uniqueTags.length ? `
        <div id="tag-filter-row" style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;padding:0 var(--space-3) var(--space-2);">
          <span style="font-size:9px;color:var(--color-text-disabled);flex-shrink:0;">${icons.tag(10)}</span>
          ${uniqueTags.map(t => `<button class="tag-filter-chip${activeTagFilter === t ? ' active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
          ${activeTagFilter ? `<button class="tag-filter-chip" data-tag="" style="opacity:0.6;font-size:10px;">× Clear</button>` : ''}
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
      <div id="batch-toolbar" style="display:${_selectMode ? 'flex' : 'none'};align-items:center;justify-content:space-between;padding:var(--space-2) var(--space-3);background:rgba(139,92,246,0.08);border-top:1px solid rgba(139,92,246,0.2);border-radius:0 0 var(--radius-lg) var(--radius-lg);">
        <div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-xs);color:var(--color-text-secondary);">
          <button class="btn btn-ghost btn-sm" id="batch-select-all" style="font-size:11px;">Select All</button>
          <button class="btn btn-ghost btn-sm" id="batch-select-none" style="font-size:11px;">None</button>
          <span id="batch-count" style="color:var(--color-primary-light);font-weight:var(--weight-semi);">0 selected</span>
        </div>
        <div style="display:flex;gap:var(--space-2);">
          <button class="btn btn-ghost btn-sm" id="batch-export" style="font-size:11px;" title="Export selected as JSON">${icons.download(12)} Export</button>
          <button class="btn btn-sm" id="batch-delete" style="font-size:11px;background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.2);" title="Delete selected">${icons.trash(12)} Delete</button>
        </div>
      </div>
    </div>`;

  function bindHandlers(scope) {
    scope.querySelectorAll('.history-pin').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const rec = recordings.find(r => r.id === id);
        if (!rec) return;
        await togglePin(rec);
        const q = searchInput?.value?.trim() || '';
        _applyFilters(q);
      });
    });

    scope.querySelectorAll('.history-tag-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const item = e.currentTarget.closest('.history-item');
        const editor = item?.querySelector(`.history-tag-editor[data-id="${id}"]`);
        editor?.classList.toggle('hidden');
        if (!editor?.classList.contains('hidden')) {
          editor?.querySelector('.history-tag-input')?.focus();
        }
      });
    });

    scope.querySelectorAll('.history-tag-input').forEach(input => {
      const doSave = async () => {
        const id = input.dataset.id;
        const rec = recordings.find(r => r.id === id);
        if (!rec) return;
        const tags = input.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        const changed = JSON.stringify(tags) !== JSON.stringify(rec.tags || []);
        if (!changed) return;
        rec.tags = tags;
        await saveRecording(rec).catch(() => {});
        const q = searchInput?.value?.trim() || '';
        _applyFilters(q);
      };
      input.addEventListener('blur', doSave);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doSave(); input.closest('.history-tag-editor')?.classList.add('hidden'); }
        if (e.key === 'Escape') { input.closest('.history-tag-editor')?.classList.add('hidden'); }
      });
    });

    scope.querySelectorAll('.history-tag-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const tag = chip.dataset.tag;
        activeTagFilter = activeTagFilter === tag ? '' : tag;
        const q = searchInput?.value?.trim() || '';
        _applyFilters(q);
        _syncTagFilterChips();
      });
    });

    scope.querySelectorAll('.history-note-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const item = e.currentTarget.closest('.history-item');
        const area  = item?.querySelector(`.history-note-area[data-id="${id}"]`);
        if (!area) return;
        const preview  = area.querySelector('.history-note-preview');
        const textarea = area.querySelector('.history-note-textarea');
        preview?.classList.add('hidden');
        textarea?.classList.remove('hidden');
        textarea?.focus();
        textarea?.select();
      });
    });

    scope.querySelectorAll('.history-note-textarea').forEach(ta => {
      const doSave = async () => {
        const id  = ta.dataset.id;
        const rec = recordings.find(r => r.id === id);
        if (!rec) return;
        const notes = ta.value.trim();
        if (notes === (rec.notes || '').trim()) {
          // No change — just swap back to preview
          const area = ta.closest('.history-note-area');
          if (notes) { area?.querySelector('.history-note-preview')?.classList.remove('hidden'); }
          ta.classList.add('hidden');
          return;
        }
        rec.notes = notes;
        await saveRecording(rec).catch(() => {});
        ta.classList.add('hidden');
        const area = ta.closest('.history-note-area');
        if (notes) {
          let preview = area?.querySelector('.history-note-preview');
          if (!preview && area) {
            preview = document.createElement('div');
            preview.className = 'history-note-preview';
            preview.dataset.id = id;
            area.insertBefore(preview, ta);
          }
          if (preview) { preview.innerHTML = renderMarkdown(notes); preview.classList.remove('hidden'); }
        } else {
          area?.querySelector('.history-note-preview')?.remove();
        }
        const noteBtn = scope.querySelector(`.history-note-btn[data-id="${id}"]`);
        if (noteBtn) {
          noteBtn.classList.toggle('has-note', !!notes);
          noteBtn.title = notes ? 'Edit notes' : 'Add notes';
        }
      };
      ta.addEventListener('blur', doSave);
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { doSave(); }
      });
    });

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
        _showWatchModal(blob, rec?.title || 'Recording', chapters, null, rec?.aiVtt || null);
      });
    });

    // Click on recording row → open the detail view
    scope.querySelectorAll('.history-info').forEach(info => {
      info.addEventListener('click', (e) => {
        // Don't trigger if the user is double-clicking to rename
        if (e.detail >= 2) return;
        const item = info.closest('.history-item');
        if (!item) return;
        const id = item.dataset.id;
        const rec = recordings.find(r => r.id === id);
        if (rec) {
          document.dispatchEvent(new CustomEvent('takus:open-recording', { detail: { recording: rec } }));
        }
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

    // Inline transcript timestamp click → open watch modal at that timestamp
    scope.querySelectorAll('.inline-ts-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const recordingId = btn.dataset.recordingId;
        const startSec = Number(btn.dataset.startSec);
        const rec = recordings.find(r => r.id === recordingId);
        if (!rec) return;
        const blob = await getRecordingBlob(recordingId).catch(() => null);
        if (!blob) {
          toast.info('Not available locally', 'Video blob not stored. Open from cloud storage instead.');
          return;
        }
        const chapters = rec.aiSummary ? parseChapters(rec.aiSummary) : [];
        _showWatchModal(blob, rec.title || 'Recording', chapters, startSec, rec.aiVtt || null);
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
        const b = e.currentTarget;
        const orig = b.innerHTML;
        b.innerHTML = `<div class="spinner" style="width:12px;height:12px;border-width:2px;"></div>`;

        let url;
        try {
          // Try short URL via Netlify Function
          const res = await fetch('/api/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: rec.title, date: rec.date, type: rec.type, aiSummary: rec.aiSummary }),
          });
          if (res.ok) {
            const result = await res.json();
            url = `${location.origin}${location.pathname}#s=${result.id}`;
          }
        } catch { /* serverless not available — fall through */ }

        // Fallback to inline base64 URL
        if (!url) {
          const payload = { title: rec.title, date: rec.date, type: rec.type, aiSummary: rec.aiSummary };
          const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
          url = `${location.origin}${location.pathname}#share=${encoded}`;
        }

        try {
          await navigator.clipboard.writeText(url);
          b.innerHTML = icons.check(14);
          setTimeout(() => { if (b) b.innerHTML = orig; }, 1800);
          toast.success('Link copied', url.includes('#s=') ? 'Short link created' : 'Share it with anyone');
        } catch {
          b.innerHTML = orig;
          toast.info('Share link', url.slice(0, 80) + '…');
        }
      });
    });

    scope.querySelectorAll('.history-qr-link').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const rec = recordings.find(r => r.id === id);
        if (!rec?.aiSummary) return;

        // Full share URL (for clipboard) includes aiSummary
        const fullPayload = { title: rec.title, date: rec.date, type: rec.type, aiSummary: rec.aiSummary };
        const fullUrl = `${location.origin}${location.pathname}#share=${btoa(encodeURIComponent(JSON.stringify(fullPayload)))}`;

        // Compact QR payload (title + date + type only) fits within QR capacity
        // The shared view renders gracefully with or without aiSummary
        const qrPayload = { title: rec.title, date: rec.date, type: rec.type };
        const qrUrl = `${location.origin}${location.pathname}#share=${btoa(encodeURIComponent(JSON.stringify(qrPayload)))}`;

        try {
          const { showQRModal } = await import('../lib/qr-code.js');
          showQRModal(qrUrl, rec.title || 'Untitled Recording', fullUrl);
        } catch (err) {
          console.warn('[QR]', err);
          toast.error('QR code failed', err.message || 'Could not generate QR code.');
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

  // ── Batch Operations ──────────────────────────────────────────────────
  const _updateBatchCount = () => {
    const countEl = container.querySelector('#batch-count');
    if (countEl) countEl.textContent = `${_selectedIds.size} selected`;
  };

  container.querySelector('#history-select-toggle')?.addEventListener('click', () => {
    _selectMode = !_selectMode;
    if (!_selectMode) _selectedIds.clear();
    const q = searchInput?.value?.trim() || '';
    _applyFilters(q);
  });

  container.querySelectorAll('.batch-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) _selectedIds.add(id);
      else _selectedIds.delete(id);
      _updateBatchCount();
    });
  });

  container.querySelector('#batch-select-all')?.addEventListener('click', () => {
    const q = searchInput?.value?.trim() || '';
    const visible = filteredRecordings(q);
    visible.forEach(r => _selectedIds.add(r.id));
    container.querySelectorAll('.batch-cb').forEach(cb => { cb.checked = true; });
    _updateBatchCount();
  });

  container.querySelector('#batch-select-none')?.addEventListener('click', () => {
    _selectedIds.clear();
    container.querySelectorAll('.batch-cb').forEach(cb => { cb.checked = false; });
    _updateBatchCount();
  });

  container.querySelector('#batch-delete')?.addEventListener('click', async () => {
    if (!_selectedIds.size) { toast.info('No recordings selected'); return; }
    if (!confirm(`Delete ${_selectedIds.size} recording(s)? This cannot be undone.`)) return;
    for (const id of _selectedIds) {
      await Promise.all([deleteRecording(id), deleteRecordingBlob(id), deleteEmbeddings(id)]);
    }
    toast.success('Batch delete', `${_selectedIds.size} recording(s) deleted`);
    _selectedIds.clear();
    _selectMode = false;
    renderHistoryPanel(container, shortcuts, _activeDateFilter);
  });

  container.querySelector('#batch-export')?.addEventListener('click', () => {
    if (!_selectedIds.size) { toast.info('No recordings selected'); return; }
    const selected = recordings.filter(r => _selectedIds.has(r.id));
    const exportData = {
      version: 1,
      exportedAt: Date.now(),
      recordings: selected.map(({ observerLog: _obs, ...r }) => r),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `takus-selected-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast.success('Exported', `${selected.length} recording(s) saved`);
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

  // Full ZIP backup — includes video blobs
  container.querySelector('#history-zip-export')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    const orig = btn.innerHTML;
    btn.innerHTML = `<div class="spinner" style="width:11px;height:11px;border-width:2px;"></div>`;
    try {
      const { exportZip } = await import('../lib/zip-export.js');
      await exportZip(btn);
    } catch (err) {
      console.warn('[ZIP]', err);
      toast.error('Backup failed', err.message || 'Could not create ZIP archive.');
    } finally {
      btn.innerHTML = orig;
      btn.disabled = false;
    }
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

  container.querySelector('#tag-filter-row')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.tag-filter-chip');
    if (!chip) return;
    activeTagFilter = chip.dataset.tag || '';
    _syncTagFilterChips();
    const q = searchInput?.value?.trim() || '';
    _applyFilters(q);
  });

  container.querySelector('#history-sort')?.addEventListener('change', (e) => {
    _sortMode = e.target.value;
    const q = searchInput?.value?.trim() || '';
    _applyFilters(q);
  });

  function _syncTagFilterChips() {
    container.querySelectorAll('.tag-filter-chip').forEach(c => {
      c.classList.toggle('active', !!activeTagFilter && c.dataset.tag === activeTagFilter);
    });
  }

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

function _archiveBadge(r) {
  const status = r.archiveStatus;
  if (!status || status === 'active') return '';
  const badges = {
    pending:  { label: 'Archiving…', color: '#f59e0b' },
    archived: { label: 'Archived',   color: '#8b5cf6' },
    cold:     { label: 'Cold Storage', color: '#6366f1' },
  };
  const b = badges[status];
  if (!b) return '';
  return ` · <span style="font-size:10px;font-weight:600;color:${b.color};white-space:nowrap;" title="Archive status: ${status}">${b.label}</span>`;
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


export function openWatchModal(blob, title, chapters = [], startTime = null, vttString = null) {
  _showWatchModal(blob, title, chapters, startTime, vttString);
}

function _showWatchModal(blob, title, chapters = [], startTime = null, vttString = null) {
  document.getElementById('watch-overlay')?.remove();

  const url = URL.createObjectURL(blob);
  const segments = vttString ? parseVTT(vttString) : [];
  const hasTranscript = segments.length > 0;
  const overlay = document.createElement('div');
  overlay.id = 'watch-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--space-4);';

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

  const transcriptPanelHtml = hasTranscript
    ? `<div class="watch-transcript-panel">
        <div class="watch-transcript-header">
          <span class="watch-transcript-title">Transcript</span>
          <input type="text" class="watch-transcript-search" placeholder="Search transcript…" autocomplete="off" />
        </div>
        <div class="watch-transcript-list" id="watch-tlist">
          ${segments.map((seg, i) => `
            <div class="transcript-row" data-idx="${i}" data-start="${seg.start}" data-end="${seg.end}">
              <span class="transcript-ts">${_fmtSeconds(Math.floor(seg.start))}</span>
              <span class="transcript-text">${esc(seg.text)}</span>
            </div>`).join('')}
        </div>
      </div>`
    : '';

  overlay.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--space-2);width:100%;max-width:${hasTranscript ? '1200px' : '960px'};">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);">
        <span style="font-weight:var(--weight-semi);color:#fff;font-size:var(--font-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(title)}</span>
        <button id="watch-close" style="flex-shrink:0;background:rgba(255,255,255,0.1);border:none;cursor:pointer;color:#fff;font-size:18px;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;" title="Close (Esc)">✕</button>
      </div>
      <div class="watch-layout">
        <div class="watch-video-col">
          <video id="watch-video" src="${url}" controls autoplay></video>
          ${chaptersHtml}
        </div>
        ${transcriptPanelHtml}
      </div>
      <p style="text-align:center;font-size:var(--font-xs);color:rgba(255,255,255,0.3);">Click outside or press <kbd style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:3px;">Esc</kbd> to close</p>
    </div>
  `;
  document.body.appendChild(overlay);

  const video = overlay.querySelector('#watch-video');

  // Jump to start time if provided
  if (startTime !== null && startTime > 0) {
    video.addEventListener('loadedmetadata', () => { video.currentTime = startTime; }, { once: true });
  }

  // Chapter buttons
  overlay.querySelectorAll('.watch-chapter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      video.currentTime = Number(btn.dataset.seconds);
      video.play();
      overlay.querySelectorAll('.watch-chapter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ── Synced Transcript ──────────────────────────────────────────────────
  if (hasTranscript) {
    const tList = overlay.querySelector('#watch-tlist');
    const searchInput = overlay.querySelector('.watch-transcript-search');
    const rows = overlay.querySelectorAll('.transcript-row');
    let activeIdx = -1;
    let searchQuery = '';

    // Click-to-seek
    rows.forEach(row => {
      row.addEventListener('click', () => {
        video.currentTime = Number(row.dataset.start);
        video.play();
      });
    });

    // Live highlight on timeupdate (debounced)
    let _rafId = null;
    video.addEventListener('timeupdate', () => {
      if (_rafId) return;
      _rafId = requestAnimationFrame(() => {
        _rafId = null;
        const t = video.currentTime;
        let newIdx = -1;
        for (let i = 0; i < segments.length; i++) {
          if (t >= segments[i].start && t < segments[i].end) { newIdx = i; break; }
        }
        // Fallback: find the last segment that started before current time
        if (newIdx === -1) {
          for (let i = segments.length - 1; i >= 0; i--) {
            if (t >= segments[i].start) { newIdx = i; break; }
          }
        }
        if (newIdx !== activeIdx) {
          if (activeIdx >= 0 && rows[activeIdx]) rows[activeIdx].classList.remove('transcript-active');
          activeIdx = newIdx;
          if (activeIdx >= 0 && rows[activeIdx]) {
            rows[activeIdx].classList.add('transcript-active');
            // Auto-scroll: keep active row near center of the panel
            if (!searchQuery) {
              rows[activeIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
          }
        }
      });
    });

    // Search within transcript
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      rows.forEach(row => {
        const textSpan = row.querySelector('.transcript-text');
        const segIdx = Number(row.dataset.idx);
        const originalText = segments[segIdx].text;

        if (!searchQuery) {
          row.style.display = '';
          row.classList.remove('transcript-match');
          textSpan.innerHTML = esc(originalText);
          return;
        }

        const lowerText = originalText.toLowerCase();
        if (lowerText.includes(searchQuery)) {
          row.style.display = '';
          row.classList.add('transcript-match');
          // Highlight matches
          const escaped = esc(originalText);
          const escapedQuery = esc(searchQuery).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          textSpan.innerHTML = escaped.replace(
            new RegExp(escapedQuery, 'gi'),
            m => `<mark>${m}</mark>`
          );
        } else {
          row.style.display = 'none';
          row.classList.remove('transcript-match');
        }
      });
    });

    // If startTime provided, scroll to that segment on open
    if (startTime !== null && startTime > 0) {
      requestAnimationFrame(() => {
        for (let i = 0; i < segments.length; i++) {
          if (startTime >= segments[i].start && startTime < segments[i].end) {
            rows[i]?.classList.add('transcript-active');
            rows[i]?.scrollIntoView({ block: 'center' });
            activeIdx = i;
            break;
          }
        }
      });
    }
  }

  // Cleanup
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

function renderTranscriptViewer(segments, recordingId) {
  if (!segments.length) return '<p style="color:var(--color-text-muted);font-size:var(--font-xs);">No transcript segments available.</p>';
  return `<div style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">` +
    segments.map(seg => `
      <div style="display:flex;gap:var(--space-2);font-size:var(--font-xs);line-height:1.5;">
        <button class="inline-ts-btn" data-recording-id="${esc(recordingId || '')}" data-start-sec="${seg.start}" style="flex-shrink:0;font-variant-numeric:tabular-nums;color:var(--color-primary-light);font-weight:var(--weight-semi);padding:0 2px;background:none;border:none;cursor:pointer;font-size:inherit;font-family:inherit;border-radius:3px;transition:background 0.15s;" title="Watch at ${_secToTimestamp(seg.start)}">${_secToTimestamp(seg.start)}</button>
        <span style="color:var(--color-text-secondary);">${esc(seg.text)}</span>
      </div>`).join('') +
    '</div>';
}

function _sortFn(mode) {
  if (mode === 'oldest')   return (a, b) => (a.date || 0) - (b.date || 0);
  if (mode === 'duration') return (a, b) => (b.duration || 0) - (a.duration || 0);
  if (mode === 'quality')  return (a, b) => (b.analytics?.score?.score || 0) - (a.analytics?.score?.score || 0);
  if (mode === 'size')     return (a, b) => (b.size || 0) - (a.size || 0);
  return (a, b) => (b.date || 0) - (a.date || 0);
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
