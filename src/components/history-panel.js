// Takus — History Panel
import { icons } from '../lib/icons.js';
import { getRecordings, deleteRecording, clearAllRecordings } from '../lib/storage.js';
import { formatDuration, formatSize } from '../lib/recorder.js';
import { toast } from './toast.js';

const INITIAL_LIMIT = 20;

export async function renderHistoryPanel(container) {
  const recordings = await getRecordings().catch(() => []);

  if (recordings.length === 0) {
    container.innerHTML = `
      <div class="card card-compact animate-in">
        <div class="card-header"><h3>History</h3></div>
        <div class="empty-state" style="padding:var(--space-6) var(--space-4);">
          ${icons.video(32)}
          <p>No recordings yet</p>
          <p style="font-size:var(--font-xs);color:var(--color-text-disabled);margin-top:calc(-1 * var(--space-2));">Press <kbd style="background:var(--color-bg-elevated);padding:2px 6px;border-radius:4px;">R</kbd> or click the record button to start</p>
        </div>
      </div>`;
    return;
  }

  let showAll = recordings.length <= INITIAL_LIMIT;

  function buildItems(list) {
    if (!list.length) {
      return `<div style="padding:var(--space-4);text-align:center;font-size:var(--font-sm);color:var(--color-text-muted);">No recordings match your search.</div>`;
    }
    return list.map(r => {
      const date = new Date(r.date);
      const ago = timeAgo(date);
      const badge = _providerBadge(r.driveLink);
      return `
        <div class="history-item" data-id="${r.id}" style="display:flex; flex-direction:column; gap:var(--space-2);">
          <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
            <div style="display:flex; align-items:center; gap:var(--space-3); min-width:0;">
              <div class="history-icon">${icons.video(16)}</div>
              <div class="history-info" style="min-width:0;">
                <div class="history-title">${esc(r.title || 'Untitled')}</div>
                <div class="history-meta">${ago} · ${formatDuration(r.duration)} · ${formatSize(r.size)}${badge}</div>
              </div>
            </div>
            <div class="history-actions" style="flex-shrink:0;">
              ${r.aiSummary ? `<button class="btn btn-ghost btn-icon btn-sm history-summary-toggle" title="View AI Summary" data-target="${r.id}">${icons.zap(14)}</button>` : ''}
              ${(r.aiDocLink && r.aiDocLink.startsWith('https://')) ? `<a href="${esc(r.aiDocLink)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-icon btn-sm" title="Open meeting notes">${icons.info(14)}</a>` : ''}
              ${(r.driveLink && r.driveLink.startsWith('https://')) ? `
                <button class="btn btn-ghost btn-icon btn-sm history-copy-link" title="Copy cloud link" data-link="${esc(r.driveLink)}">${icons.link(14)}</button>
                <a href="${esc(r.driveLink)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-icon btn-sm" title="Open in cloud">${icons.externalLink(14)}</a>
              ` : ''}
              <button class="btn btn-ghost btn-icon btn-sm history-delete" title="Delete" data-id="${r.id}">${icons.trash(14)}</button>
            </div>
          </div>
          ${r.aiSummary ? `
          <div class="ai-summary-box hidden" style="background:rgba(255,255,255,0.03); border-radius:var(--radius-md); padding:var(--space-3); margin-top:var(--space-2); font-size:var(--font-sm); color:var(--color-text-secondary); border:1px solid rgba(255,255,255,0.05);">
            <div style="font-weight:var(--weight-semi); margin-bottom:var(--space-1); display:flex; align-items:center; justify-content:space-between; gap:var(--space-2); color:var(--color-primary-light);">
              <div style="display:flex; align-items:center; gap:var(--space-2);">${icons.zap(14)} AI Summary</div>
              ${r.aiVtt ? `<button class="btn btn-ghost btn-sm history-download-vtt" data-id="${r.id}" title="Download Subtitles (.vtt)">${icons.download(14)} .VTT</button>` : ''}
            </div>
            <div style="white-space:pre-wrap; line-height:1.5;">${esc(r.aiSummary)}</div>
          </div>
          ` : ''}
        </div>`;
    }).join('');
  }

  const hasMore = recordings.length > INITIAL_LIMIT;

  container.innerHTML = `
    <div class="card card-compact animate-in">
      <div class="card-header">
        <h3>History</h3>
        <div style="display:flex;align-items:center;gap:var(--space-2);">
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
      <div id="history-list" style="display:flex;flex-direction:column;gap:var(--space-2);max-height:360px;overflow-y:auto;">
        ${buildItems(recordings.slice(0, INITIAL_LIMIT))}
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
        await deleteRecording(id);
        toast.info('Recording deleted');
        renderHistoryPanel(container);
      });
    });

    scope.querySelectorAll('.history-summary-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.history-item');
        const summaryBox = item?.querySelector('.ai-summary-box');
        if (summaryBox) summaryBox.classList.toggle('hidden');
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
  }

  container.querySelector('#history-clear-all')?.addEventListener('click', async () => {
    if (!confirm(`Delete all ${recordings.length} recordings from history? This cannot be undone.`)) return;
    await clearAllRecordings();
    toast.info('All recordings cleared');
    renderHistoryPanel(container);
  });

  container.querySelector('#history-show-more')?.addEventListener('click', () => {
    showAll = true;
    const list = document.getElementById('history-list');
    if (list) {
      list.innerHTML = buildItems(recordings);
      bindHandlers(list);
    }
    container.querySelector('#history-show-more')?.parentElement?.remove();
  });

  const searchInput = container.querySelector('#history-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      const list = document.getElementById('history-list');
      if (!list) return;
      const source = showAll ? recordings : recordings.slice(0, INITIAL_LIMIT);
      const filtered = q
        ? recordings.filter(r =>
            (r.title || '').toLowerCase().includes(q) ||
            (r.aiSummary || '').toLowerCase().includes(q)
          )
        : source;
      list.innerHTML = buildItems(filtered);
      bindHandlers(list);
    });
  }

  bindHandlers(container);
}

function _providerBadge(driveLink) {
  if (!driveLink || !driveLink.startsWith('https://')) return '';
  if (driveLink.includes('drive.google.com') || driveLink.includes('docs.google.com')) {
    return ` · <span style="color:#4285F4;font-size:10px;font-weight:600;" title="Google Drive">G Drive</span>`;
  }
  if (driveLink.includes('onedrive') || driveLink.includes('sharepoint') || driveLink.includes('1drv')) {
    return ` · <span style="color:#00A4EF;font-size:10px;font-weight:600;" title="Microsoft OneDrive">OneDrive</span>`;
  }
  return '';
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
