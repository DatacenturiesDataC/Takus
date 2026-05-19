// Takus — History Panel
import { showWatchModal } from './watch-modal.js';
import { openArchivePlayer } from './archive-player.js';
import { exportLibrary, exportSelected, importLibrary, exportZipBackup } from '../lib/library-io.js';
import { icons } from '../lib/icons.js';
import { esc, renderMarkdown, parseVTT } from '../lib/utils.js';
import { getEntries, saveEntry, deleteEntry, clearAllEntries, getMediaBlob, deleteMediaBlob, deleteEmbeddings, getAllEmbeddings, removeEdgesForNode, removeInteractionsForEntry, removeContentItemsForEntry, removeVaultSync } from '../lib/storage.js';
import { togglePin } from '../lib/archive-engine.js';
import { formatDuration, formatSize } from '../lib/recorder.js';
import { toast } from './toast.js';
import { confirmAsync } from '../lib/dialog-utils.js';
import { OPEN_ENTRY } from '../lib/events.js';
import { renderSharePanel } from './share-panel.js';
import { typeLabel, typeAccent } from '../lib/content-types.js';
import { getCategory } from '../lib/content-types.js';
import { renderTasksPanel, tasksBadge } from './tasks-panel.js';
import { parseChapters } from '../lib/analytics.js';
// cosineSimilarity, getKnowledgeLevelInfo — accessed via history-utils.js
// Extracted utilities (badges, text, sorting, filtering, transcript)
import {
  typeBadge as _typeBadge,
  archiveBadge as _archiveBadge,
  stateBadge as _stateBadge,
  tldwStrip as _tldwStrip,
  metaTags as _metaTags,
  highlight,
  timeAgo,
  sortFn as _sortFn,
  filterByDate as _filterByDate,
  computeRelated as _computeRelated,
  renderTranscriptViewer,
} from './history-utils.js';
// Extracted item template
import { buildHistoryItems } from './history-cards/item-template.js';

const INITIAL_LIMIT = 20;
const PAGE_SIZE = 20; // Incremental load batch size for infinite scroll

/**
 * Render related entries into the .related-slot within a summary box.
 * Uses embedding similarity via _computeRelated.
 * @param {HTMLElement} summaryBox - The .ai-summary-box element
 * @param {string} contentId - Source entry ID
 * @param {Array} allEmbeddings - All embedding entries
 * @param {Array} entries - All entry objects
 */
function _renderRelated(summaryBox, contentId, allEmbeddings, entries) {
  const slot = summaryBox.querySelector(`.related-slot[data-id="${contentId}"]`);
  if (!slot || slot.dataset.rendered) return;
  slot.dataset.rendered = '1';

  const related = _computeRelated(contentId, allEmbeddings, entries);
  if (!related.length) return;

  slot.style.display = '';
  slot.innerHTML = `
    <div style="font-size:10px;font-weight:var(--weight-semi);color:var(--color-text-disabled);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Related</div>
    ${related.map(r => `
      <div class="related-rec" data-id="${esc(r.id)}" style="display:flex;align-items:center;gap:var(--space-2);padding:3px 0;font-size:var(--font-xs);cursor:pointer;color:var(--color-text-secondary);" title="Similarity: ${Math.round(r.score * 100)}%">
        <span style="color:${typeAccent(r.type || 'screen')};flex-shrink:0;">●</span>
        <span class="truncate">${esc(r.title || 'Untitled')}</span>
        <span style="color:var(--color-text-disabled);font-size:10px;flex-shrink:0;margin-left:auto;">${Math.round(r.score * 100)}%</span>
      </div>
    `).join('')}
  `;

  // Click handler — open related entry
  slot.querySelectorAll('.related-rec').forEach(el => {
    el.addEventListener('click', () => {
      const entry = entries.find(r => r.id === el.dataset.id);
      if (entry) {
        document.dispatchEvent(new CustomEvent(OPEN_ENTRY, { detail: { entry: entry } }));
      }
    });
  });
}

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
        <div class="card-header"><h3>Library</h3></div>
        <div style="display:flex;flex-direction:column;gap:var(--space-1);">
          ${skRow()}${skRow()}${skRow()}
        </div>
      </div>`;
  }

  const entries = await getEntries().catch(() => []);
  const recKey = (shortcuts.record || 'r').toUpperCase();

  if (entries.length === 0) {
    container.innerHTML = `
      <div class="card card-compact animate-in">
        <div class="card-header"><h3>Library</h3></div>
        <div class="empty-state" style="padding:var(--space-6) var(--space-4);">
          ${icons.edit(32)}
          <p>No entries yet</p>
          <p style="font-size:var(--font-xs);color:var(--color-text-disabled);margin-top:calc(-1 * var(--space-2));">Capture a meeting, import a document, or drop a file to begin</p>
        </div>
      </div>`;
    return;
  }

  let showAll = entries.length <= INITIAL_LIMIT;
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

  // Related entries — loaded once in the background after first render.
  let _allEmbeddings = [];

  // Aggregate stats for header strip — only count duration from media entries
  const mediaEntries = entries.filter(r => getCategory(r.type) !== 'document');
  const docEntries = entries.filter(r => getCategory(r.type) === 'document');
  const totalDuration = mediaEntries.reduce((s, r) => s + (r.duration || 0), 0);
  const totalSize = mediaEntries.reduce((s, r) => s + (r.size || 0), 0);

  // Compute type counts for filter chips
  const typeCounts = {};
  for (const r of entries) {
    const t = r.type || 'screen';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  const uniqueTypes = Object.keys(typeCounts);

  const allTagsSet = new Set();
  for (const r of entries) for (const t of (r.tags || [])) allTagsSet.add(t);
  const uniqueTags = [...allTagsSet].sort();

  function filteredEntries(searchQ) {
    let list = activeTypeFilter
      ? entries.filter(r => (r.type || 'screen') === activeTypeFilter)
      : entries;
    if (_activeDateFilter) list = _filterByDate(list, _activeDateFilter);
    if (activeTagFilter) list = list.filter(r => (r.tags || []).includes(activeTagFilter));
    if (searchQ) {
      const q = searchQ.toLowerCase();
      list = list.filter(r =>
        (r.title || '').toLowerCase().includes(q) ||
        typeLabel(r.type || 'screen').toLowerCase().includes(q) ||
        (r.aiSummary || '').toLowerCase().includes(q) ||
        (r.textContent || '').toLowerCase().includes(q) ||
        (r.tags || []).some(t => t.includes(q))
      );
    }
    const sorted = [...list].sort(_sortFn(_sortMode));
    sorted.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    return sorted;
  }

  function buildItems(list, searchQ = '') {
    return buildHistoryItems(list, searchQ, _selectMode, _selectedIds, activeTagFilter);
  }

  const hasMore = entries.length > INITIAL_LIMIT;

  // Load embeddings in the background — available for related-entry lookups.
  getAllEmbeddings().then(embs => { _allEmbeddings = embs; }).catch(() => {});

  // Count inbox (raw) entries for header badge
  const inboxCount = entries.filter(r => r.state === 'raw').length;

  container.innerHTML = `
    <div class="card card-compact animate-in">
      <div class="card-header">
        <h3>History${inboxCount > 0 ? ` <span style="font-size:11px;font-weight:600;padding:1px 7px;border-radius:8px;background:var(--color-warning);color:#000;margin-left:6px;" title="${inboxCount} item${inboxCount > 1 ? 's' : ''} awaiting processing">${inboxCount} inbox</span>` : ''}</h3>
        <div class="flex-center gap-2">
          ${(totalDuration > 0 || totalSize > 0) ? `<span style="font-size:var(--font-xs);color:var(--color-text-muted);">${formatDuration(totalDuration)} · ${formatSize(totalSize)}</span>` : ''}${docEntries.length > 0 ? `<span style="font-size:var(--font-xs);color:var(--color-text-muted);">${docEntries.length} doc${docEntries.length > 1 ? 's' : ''}</span>` : ''}
          <select id="history-sort" title="Sort entries" aria-label="Sort entries" style="font-size:var(--font-xs);background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:var(--radius-sm);color:var(--color-text-secondary);padding:2px 6px;cursor:pointer;">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="duration">Longest</option>
            <option value="quality">Best quality</option>
            <option value="size">Largest</option>
          </select>
          <button class="btn btn-ghost btn-sm" id="history-select-toggle" title="Select multiple" aria-label="Select multiple entries" style="font-size:var(--font-xs);color:var(--color-text-muted);">${icons.checkSquare(12)} Select</button>
          <button class="btn btn-ghost btn-icon btn-sm" id="history-export" title="Export library as JSON" aria-label="Export library as JSON">${icons.download(13)}</button>
          <button class="btn btn-ghost btn-icon btn-sm" id="history-zip-export" title="Full backup with media (ZIP)" aria-label="Full backup with media">${icons.package(13)}</button>
          <label class="btn btn-ghost btn-icon btn-sm" for="history-import-input" title="Import library from JSON" aria-label="Import library from JSON" style="cursor:pointer;">${icons.upload(13)}</label>
          <input type="file" id="history-import-input" accept=".json" style="display:none;" aria-label="Import entries file" />
          <label class="btn btn-ghost btn-icon btn-sm" for="history-doc-import" title="Import document (text, markdown, PDF, DOCX)" aria-label="Import document" style="cursor:pointer;color:var(--color-primary-light);">${icons.plus(13)}</label>
          <input type="file" id="history-doc-import" accept=".txt,.md,.markdown,.json,.text,.pdf,.docx" multiple style="display:none;" aria-label="Import document files" />
          <span class="badge badge-neutral">${entries.length}</span>
          <button class="btn btn-ghost btn-sm" id="history-clear-all" style="font-size:var(--font-xs);color:var(--color-text-muted);" title="Clear all entries" aria-label="Clear all entries">${icons.trash(12)}</button>
        </div>
      </div>
      ${entries.length > 4 ? `
        <div style="padding:0 var(--space-3) var(--space-2);">
          <div style="display:flex;align-items:center;gap:var(--space-2);background:rgba(255,255,255,0.04);border-radius:var(--radius-md);padding:6px var(--space-3);border:1px solid rgba(255,255,255,0.08);">
            <span style="color:var(--color-text-muted);flex-shrink:0;">${icons.search(14)}</span>
            <input type="search" id="history-search" placeholder="Search entries…" aria-label="Search entries" style="background:none;border:none;outline:none;color:inherit;font-size:var(--font-sm);flex:1;min-width:0;" autocomplete="off" />
          </div>
        </div>
      ` : ''}
      ${uniqueTypes.length > 1 ? `
        <div id="type-filter-row" style="display:flex;gap:var(--space-2);flex-wrap:wrap;padding:0 var(--space-3) var(--space-2);">
          <button class="type-chip active" data-type="">All <span style="opacity:0.7;">${entries.length}</span></button>
          ${uniqueTypes.map(t => `
            <button class="type-chip" data-type="${t}" style="--chip-accent:${typeAccent(t)}">
              ${typeLabel(t)} <span style="opacity:0.7;">${typeCounts[t]}</span>
            </button>
          `).join('')}
        </div>
      ` : ''}
      ${entries.length > 4 ? `
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
        ${buildItems(entries.slice(0, INITIAL_LIMIT), '')}
      </div>
      ${hasMore ? `
        <div style="padding:var(--space-2) var(--space-3);text-align:center;">
          <button class="btn btn-ghost btn-sm" id="history-show-more" style="font-size:var(--font-xs);color:var(--color-text-muted);">
            Show ${entries.length - INITIAL_LIMIT} more…
          </button>
        </div>
      ` : ''}
      <div id="batch-toolbar" style="display:${_selectMode ? 'flex' : 'none'};align-items:center;justify-content:space-between;padding:var(--space-2) var(--space-3);background:rgba(139,92,246,0.08);border-top:1px solid rgba(139,92,246,0.2);border-radius:0 0 var(--radius-lg) var(--radius-lg);">
        <div class="flex-center gap-2 text-xs text-secondary">
          <button class="btn btn-ghost btn-sm" id="batch-select-all" style="font-size:11px;">Select All</button>
          <button class="btn btn-ghost btn-sm" id="batch-select-none" style="font-size:11px;">None</button>
          <span id="batch-count" style="color:var(--color-primary-light);font-weight:var(--weight-semi);">0 selected</span>
        </div>
        <div style="display:flex;gap:var(--space-2);">
          <button class="btn btn-ghost btn-sm" id="batch-export" style="font-size:11px;" title="Export selected as JSON">${icons.download(12)} Export</button>
          <button class="btn btn-sm" id="batch-delete" style="font-size:11px;background:var(--color-danger);color:#fff;border:none;" title="Delete selected">${icons.trash(12)} Delete</button>
        </div>
      </div>
    </div>`;

  function bindHandlers(scope) {
    scope.querySelectorAll('.history-pin').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const entry = entries.find(r => r.id === id);
        if (!entry) return;
        await togglePin(entry);
        const q = searchInput?.value?.trim() || '';
        _applyFilters(q);
      });
    });

    // Process button for raw/inbox entries (Read-to-Ingest)
    // Routes through the Inbox Service for lifecycle tracking + events.
    scope.querySelectorAll('.history-process-raw').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = e.currentTarget.dataset.id;
        const entry = entries.find(r => r.id === id);
        if (!entry || entry.state !== 'raw') return;
        btn.disabled = true;
        btn.textContent = 'Processing…';

        // Track lifecycle through Inbox Service
        let inboxItem = null;
        try {
          const { processInboxItem } = await import('../lib/inbox.js');
          inboxItem = processInboxItem({
            id: entry.id, appId: 'recorder', type: entry.type || 'entry',
            title: entry.title, state: 'inbox', createdAt: new Date(entry.date).getTime(),
          });
        } catch { /* Inbox Service not available — continue without lifecycle tracking */ }

        try {
          const { processRawEntry } = await import('../lib/content-pipeline.js');
          await processRawEntry(entry, {
            onComplete: async () => {
              if (inboxItem) {
                try {
                  const { completeInboxItem } = await import('../lib/inbox.js');
                  completeInboxItem(inboxItem);
                } catch { /* ok */ }
              }
              const q = searchInput?.value?.trim() || '';
              _applyFilters(q);
            },
          });
        } catch (err) {
          if (inboxItem) {
            try {
              const { failInboxItem } = await import('../lib/inbox.js');
              failInboxItem(inboxItem, err.message);
            } catch { /* ok */ }
          }
          toast.error('Processing failed', err.message);
          btn.disabled = false;
          btn.textContent = '⚡ Process';
        }
        // Re-render after processing
        const q = searchInput?.value?.trim() || '';
        _applyFilters(q);
      });
    });


    // Archive buttons — show/hide based on feature flag, handle click
    scope.querySelectorAll('.history-archive').forEach(btn => {
      // Feature-gated visibility
      import('../lib/feature-flags.js').then(async ({ isEnabled }) => {
        if (await isEnabled('archiveEngine')) btn.style.display = '';
      }).catch(() => {});

      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const entry = entries.find(r => r.id === id);
        if (!entry) return;
        if (entry.archiveStatus === 'archived') {
          openArchivePlayer(entry);
        } else {
          try {
            const { archiveEntry } = await import('../lib/archive-engine.js');
            btn.disabled = true;
            btn.textContent = '⏳';
            const videoBlob = await getMediaBlob(entry.id).catch(() => null);
            if (!videoBlob) {
              toast.warning('Cannot archive', 'Video blob not available locally.');
              btn.disabled = false;
              btn.textContent = '';
              return;
            }
            const result = await archiveEntry(entry, videoBlob, (stage, pct) => {
              btn.title = `${stage} ${Math.round(pct * 100)}%`;
            });
            if (result.success) {
              toast.success('Archived', 'Entry archived — media freed');
              const q = searchInput?.value?.trim() || '';
              _applyFilters(q);
            } else {
              toast.warning('Not eligible', result.reason || 'Entry cannot be archived yet');
            }
          } catch (err) {
            toast.error('Archive failed', err.message);
          }
          btn.disabled = false;
        }
      });
    });

    // Restore buttons — re-download archived entry from cloud
    scope.querySelectorAll('.history-restore').forEach(btn => {
      // Feature-gated visibility (same gate as archive)
      import('../lib/feature-flags.js').then(async ({ isEnabled }) => {
        if (await isEnabled('archiveEngine')) btn.style.display = '';
      }).catch(() => {});

      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const entry = entries.find(r => r.id === id);
        if (!entry) return;
        if (!(await confirmAsync(`Restore "${entry.title || 'Untitled'}" from cloud? This will re-download the content.`, { confirmLabel: 'Restore' }))) return;
        try {
          const { restoreEntry } = await import('../lib/archive-engine.js');
          btn.disabled = true;
          btn.innerHTML = '<div class="spinner" style="width:11px;height:11px;border-width:2px;"></div>';
          const result = await restoreEntry(entry, (stage, pct) => {
            btn.title = `${stage} ${Math.round(pct * 100)}%`;
          });
          if (result.success) {
            toast.success('Restored', 'Entry restored from cloud');
            const q = searchInput?.value?.trim() || '';
            _applyFilters(q);
          } else {
            toast.warning('Restore failed', result.reason || 'Could not restore entry');
          }
        } catch (err) {
          toast.error('Restore failed', err.message);
        }
        btn.disabled = false;
        btn.innerHTML = icons.refresh(14);
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
        const entry = entries.find(r => r.id === id);
        if (!entry) return;
        const tags = input.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        const changed = JSON.stringify(tags) !== JSON.stringify(entry.tags || []);
        if (!changed) return;
        entry.tags = tags;
        await saveEntry(entry).catch(() => {});
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
        const entry = entries.find(r => r.id === id);
        if (!entry) return;
        const notes = ta.value.trim();
        if (notes === (entry.notes || '').trim()) {
          // No change — just swap back to preview
          const area = ta.closest('.history-note-area');
          if (notes) { area?.querySelector('.history-note-preview')?.classList.remove('hidden'); }
          ta.classList.add('hidden');
          return;
        }
        entry.notes = notes;
        await saveEntry(entry).catch(() => {});
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
        if (!(await confirmAsync('Delete this entry from history? This cannot be undone.', { confirmLabel: 'Delete', destructive: true }))) return;
        try {
          await Promise.all([deleteEntry(id), deleteMediaBlob(id), deleteEmbeddings(id).catch(() => {}), removeEdgesForNode('entry', id).catch(() => {}), removeInteractionsForEntry(id).catch(() => {}), removeContentItemsForEntry(id).catch(() => {}), removeVaultSync(id).catch(() => {})]);
          toast.info('Entry deleted');
        } catch (e) {
          toast.error('Delete failed', e.message);
        }
        renderHistoryPanel(container, shortcuts, _activeDateFilter);
      });
    });

    scope.querySelectorAll('.history-watch').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const entry = entries.find(r => r.id === id);
        const blob = await getMediaBlob(id).catch(() => null);
        if (!blob) {
          // No local video blob — try archive player if transcript exists
          if ( entry?.aiVtt ||  entry?.textContent) {
            openArchivePlayer(entry);
            return;
          }
          const msg =  entry?.driveLink
            ? 'Video not stored locally — open from cloud storage instead.'
            : 'Video not stored locally. It may have been recorded before this feature was added.';
          toast.info('Not available locally', msg);
          return;
        }
        const chapters =  entry?.aiSummary ? parseChapters(entry.aiSummary) : [];
        showWatchModal(blob,  entry?.title || 'Untitled', chapters, null,  entry?.aiVtt || null);
      });
    });

    // Click on entry row → open the detail view
    scope.querySelectorAll('.history-info').forEach(info => {
      info.addEventListener('click', (e) => {
        // Don't trigger if the user is double-clicking to rename
        if (e.detail >= 2) return;
        const item = info.closest('.history-item');
        if (!item) return;
        const id = item.dataset.id;
        const entry = entries.find(r => r.id === id);
        if (entry) {
          document.dispatchEvent(new CustomEvent(OPEN_ENTRY, { detail: { entry: entry } }));
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
              _renderRelated(summaryBox, id, _allEmbeddings, entries);
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
            const entry = entries.find(r => r.id === id);
            if (entry) {
              renderTasksPanel(tasksPane, entry, (updated) => {
                // Patch the in-memory entry so badge counts stay current without a full re-render
                const idx = entries.findIndex(r => r.id === updated.id);
                if (idx >= 0) entries[idx] = updated;
              });
            }
          }
        }
      });
    });

    // Inline transcript timestamp click → open watch modal at that timestamp
    scope.querySelectorAll('.inline-ts-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const contentId = btn.dataset.contentId;
        const startSec = Number(btn.dataset.startSec);
        const entry = entries.find(r => r.id === contentId);
        if (!entry) return;
        const blob = await getMediaBlob(contentId).catch(() => null);
        if (!blob) {
          toast.info('Not available locally', 'Video blob not stored. Open from cloud storage instead.');
          return;
        }
        const chapters = entry.aiSummary ? parseChapters(entry.aiSummary) : [];
        showWatchModal(blob, entry.title || 'Untitled', chapters, startSec, entry.aiVtt || null);
      });
    });

    scope.querySelectorAll('.history-download-md').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const entry = entries.find(r => r.id === id);
        if (!entry) return;
        const date = new Date(entry.date).toLocaleString();
        const lines = [
          `# ${entry.title || 'Untitled'}`,
          `_${date} · ${formatDuration(entry.duration)} · ${entry.type || 'entry'}_`,
          '',
          '## Summary',
          entry.aiSummary || '',
        ];
        if (entry.textContent) {
          lines.push('', '## Transcript', entry.textContent);
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(entry.title || 'entry').replace(/[^a-z0-9]+/gi, '-')}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      });
    });

    scope.querySelectorAll('.history-download-vtt').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const entry = entries.find(r => r.id === id);
        if (entry && entry.aiVtt) {
          const blob = new Blob([entry.aiVtt], { type: 'text/vtt' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${entry.title || 'entry'}.vtt`;
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
        const entry = entries.find(r => r.id === id);
        if (! entry?.aiSummary) return;
        try {
          await navigator.clipboard.writeText(entry.aiSummary);
          const b = e.currentTarget;
          const orig = b.innerHTML;
          b.innerHTML = `${icons.check(14)} Copied!`;
          setTimeout(() => { if (b) b.innerHTML = orig; }, 1500);
        } catch {
          toast.info('Summary', entry.aiSummary.slice(0, 200));
        }
      });
    });

    scope.querySelectorAll('.history-copy-transcript').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const entry = entries.find(r => r.id === id);
        if (! entry?.textContent) return;
        try {
          await navigator.clipboard.writeText(entry.textContent);
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
        const entry = entries.find(r => r.id === id);
        if (!entry) return;
        renderSharePanel({
          participants: entry.participants || [],
          entryTitle: entry.title || '',
          driveLink: entry.driveLink || '',
          aiSummary: entry.aiSummary || '',
        });
      });
    });

    scope.querySelectorAll('.history-share-link').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const entry = entries.find(r => r.id === id);
        if (! entry?.aiSummary) return;
        const b = e.currentTarget;
        const orig = b.innerHTML;
        b.innerHTML = `<div class="spinner" style="width:12px;height:12px;border-width:2px;"></div>`;

        let url;
        try {
          // Try short URL via Netlify Function
          const res = await fetch('/api/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: entry.title, date: entry.date, type: entry.type, aiSummary: entry.aiSummary }),
          });
          if (res.ok) {
            const result = await res.json();
            url = `${location.origin}${location.pathname}#s=${result.id}`;
          }
        } catch { /* serverless not available — fall through */ }

        // Fallback to inline base64 URL
        if (!url) {
          const payload = { title: entry.title, date: entry.date, type: entry.type, aiSummary: entry.aiSummary };
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
        const entry = entries.find(r => r.id === id);
        if (! entry?.aiSummary) return;

        // Full share URL (for clipboard) includes aiSummary
        const fullPayload = { title: entry.title, date: entry.date, type: entry.type, aiSummary: entry.aiSummary };
        const fullUrl = `${location.origin}${location.pathname}#share=${btoa(encodeURIComponent(JSON.stringify(fullPayload)))}`;

        // Compact QR payload (title + date + type only) fits within QR capacity
        // The shared view renders gracefully with or without aiSummary
        const qrPayload = { title: entry.title, date: entry.date, type: entry.type };
        const qrUrl = `${location.origin}${location.pathname}#share=${btoa(encodeURIComponent(JSON.stringify(qrPayload)))}`;

        try {
          const { showQRModal } = await import('../lib/qr-code.js');
          showQRModal(qrUrl, entry.title || 'Untitled', fullUrl);
        } catch (err) {
          console.warn('[QR]', err);
          toast.error('QR code failed', err.message || 'Could not generate QR code.');
        }
      });
    });
  }

  container.querySelector('#history-clear-all')?.addEventListener('click', async () => {
    if (!(await confirmAsync(`Delete all ${entries.length} entries from history? This cannot be undone.`, { confirmLabel: 'Delete All', destructive: true }))) return;
    try {
      await clearAllEntries();
      toast.info('All entries cleared');
    } catch (e) {
      toast.error('Clear failed', e.message);
    }
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
    const visible = filteredEntries(q);
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
    if (!_selectedIds.size) { toast.info('No entries selected'); return; }
    if (!(await confirmAsync(`Delete ${_selectedIds.size} entry(ies)? This cannot be undone.`, { confirmLabel: 'Delete', destructive: true }))) return;
    for (const id of _selectedIds) {
      try {
        await Promise.all([deleteEntry(id), deleteMediaBlob(id), deleteEmbeddings(id).catch(() => {}), removeEdgesForNode('entry', id).catch(() => {}), removeInteractionsForEntry(id).catch(() => {}), removeContentItemsForEntry(id).catch(() => {}), removeVaultSync(id).catch(() => {})]);
      } catch (e) {
        toast.error('Delete failed', `Entry ${id}: ${e.message}`);
      }
    }
    toast.success('Batch delete', `${_selectedIds.size} entry(ies) deleted`);
    _selectedIds.clear();
    _selectMode = false;
    renderHistoryPanel(container, shortcuts, _activeDateFilter);
  });

  container.querySelector('#batch-export')?.addEventListener('click', () => exportSelected(entries, _selectedIds));

  // Library export — downloads all entry metadata (blobs excluded) as JSON
  container.querySelector('#history-export')?.addEventListener('click', () => exportLibrary(entries));

  // Full ZIP backup — includes video blobs
  container.querySelector('#history-zip-export')?.addEventListener('click', (e) => exportZipBackup(e.currentTarget));

  // Library import — merges entries from a JSON export file
  container.querySelector('#history-import-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      await importLibrary(file, entries);
      renderHistoryPanel(container, shortcuts, _activeDateFilter);
    } catch (err) {
      toast.error('Import failed', err.message);
    }
  });

  // Document import — ingest text/md/json files into the knowledge graph
  container.querySelector('#history-doc-import')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = '';
    try {
      const { extractTextFromFile, ingestDocument } = await import('../lib/document-adapter.js');
      let imported = 0;
      for (const file of files) {
        const doc = await extractTextFromFile(file);
        const result = await ingestDocument(doc);
        if (result.success) imported++;
      }
      if (imported > 0) {
        toast.success('Imported', `${imported} document${imported > 1 ? 's' : ''} added to knowledge graph`);
        renderHistoryPanel(container, shortcuts, _activeDateFilter);
      } else {
        toast.warning('No documents imported', 'Check file format (.txt, .md, .json, .pdf, .docx)');
      }
    } catch (err) {
      toast.error('Import failed', err.message);
    }
  });

  // Drag-and-drop document import on the history list
  const historyList = container.querySelector('#history-list');
  if (historyList) {
    historyList.addEventListener('dragover', (e) => {
      e.preventDefault();
      historyList.style.outline = '2px dashed var(--color-primary-light)';
      historyList.style.outlineOffset = '-2px';
    });
    historyList.addEventListener('dragleave', () => {
      historyList.style.outline = '';
      historyList.style.outlineOffset = '';
    });
    historyList.addEventListener('drop', async (e) => {
      e.preventDefault();
      historyList.style.outline = '';
      historyList.style.outlineOffset = '';
      const files = Array.from(e.dataTransfer?.files || []).filter(f =>
        /\.(txt|md|markdown|json|text)$/i.test(f.name)
      );
      if (!files.length) {
        toast.info('Unsupported', 'Drop .txt, .md, or .json files to import');
        return;
      }
      try {
        const { extractTextFromFile, ingestDocument } = await import('../lib/document-adapter.js');
        let imported = 0;
        for (const file of files) {
          const doc = await extractTextFromFile(file);
          const result = await ingestDocument(doc);
          if (result.success) imported++;
        }
        if (imported > 0) {
          toast.success('Imported', `${imported} document${imported > 1 ? 's' : ''} added`);
          renderHistoryPanel(container, shortcuts, _activeDateFilter);
        }
      } catch (err) {
        toast.error('Import failed', err.message);
      }
    });
  }

  // Infinite scroll: auto-load more entries when the sentinel enters viewport
  const showMoreBtn = container.querySelector('#history-show-more');
  const sentinel = showMoreBtn?.parentElement;
  if (sentinel && !showAll) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      // Load next page
      const q = searchInput?.value?.trim() || '';
      const base = filteredEntries(q);
      const list = document.getElementById('history-list');
      if (!list) return;
      const currentCount = list.querySelectorAll('.history-item').length;
      const nextBatch = base.slice(currentCount, currentCount + PAGE_SIZE);
      if (nextBatch.length === 0) {
        observer.disconnect();
        sentinel.style.display = 'none';
        showAll = true;
        return;
      }
      // Append new items directly (no full re-render)
      const fragment = document.createElement('div');
      fragment.innerHTML = buildItems(nextBatch, q);
      while (fragment.firstElementChild) list.appendChild(fragment.firstElementChild);
      bindHandlers(list);
      // Update button text
      const remaining = base.length - (currentCount + nextBatch.length);
      if (remaining <= 0) {
        observer.disconnect();
        sentinel.style.display = 'none';
        showAll = true;
      } else {
        showMoreBtn.textContent = `Show ${remaining} more…`;
      }
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
    // Keep manual click as fallback
    showMoreBtn.addEventListener('click', () => {
      showAll = true;
      const q = searchInput?.value?.trim() || '';
      _applyFilters(q);
      sentinel.style.display = 'none';
    });
  }

  const searchInput = container.querySelector('#history-search');
  const countBadge = container.querySelector('.badge-neutral');

  function _applyFilters(searchQ = '') {
    const list = document.getElementById('history-list');
    if (!list) return;
    const base = filteredEntries(searchQ);
    if (countBadge) {
      countBadge.textContent = (searchQ || activeTypeFilter) ? `${base.length} / ${entries.length}` : entries.length;
    }

    // For large lists, render in batches via requestAnimationFrame to prevent UI jank
    const BATCH_THRESHOLD = 30;
    const BATCH_SIZE = 15;
    const visible = showAll ? base : base.slice(0, INITIAL_LIMIT);

    if (visible.length > BATCH_THRESHOLD) {
      // Render first batch immediately, rest progressively
      const firstBatch = visible.slice(0, BATCH_SIZE);
      list.innerHTML = buildItems(firstBatch, searchQ);
      bindHandlers(list);

      let offset = BATCH_SIZE;
      const renderNextBatch = () => {
        if (offset >= visible.length) {
          _restoreExpandedState(list);
          return;
        }
        const batch = visible.slice(offset, offset + BATCH_SIZE);
        const fragment = document.createDocumentFragment();
        const temp = document.createElement('div');
        temp.innerHTML = buildItems(batch, searchQ);
        while (temp.firstElementChild) fragment.appendChild(temp.firstElementChild);
        list.appendChild(fragment);
        bindHandlers(list);
        offset += BATCH_SIZE;
        requestAnimationFrame(renderNextBatch);
      };
      requestAnimationFrame(renderNextBatch);
    } else {
      list.innerHTML = buildItems(visible, searchQ);
      _restoreExpandedState(list);
      bindHandlers(list);
    }

    // Hide 'Show more' when all filtered results are already shown
    const showMoreWrapper = container.querySelector('#history-show-more')?.parentElement;
    if (showMoreWrapper) {
      showMoreWrapper.style.display = (!showAll && base.length > INITIAL_LIMIT) ? '' : 'none';
    }
  }

  /**
   * Restore expanded summary boxes and active tabs after re-render.
   * Extracted to avoid duplication between batched and immediate paths.
   */
  function _restoreExpandedState(list) {
    for (const id of _expandedIds) {
      const box = list.querySelector(`.ai-summary-box[data-id="${id}"]`);
      if (box) {
        box.classList.remove('hidden');
        _renderRelated(box, id, _allEmbeddings, entries);
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
          const entry = entries.find(r => r.id === id);
          if (entry) {
            renderTasksPanel(tasksPane, entry, (updated) => {
              const idx = entries.findIndex(r => r.id === updated.id);
              if (idx >= 0) entries[idx] = updated;
            });
          }
        }
      }
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
    const entry = entries.find(r => r.id === id);
    if (!entry) return;

    const originalTitle = entry.title || '';
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
      entry.title = newTitle;
      restore(newTitle);
      await saveEntry(entry).catch(() => {});
    };

    input.addEventListener('blur', saveTitle);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { _committed = true; restore(originalTitle); }
    });
  });
}
