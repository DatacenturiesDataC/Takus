// Takus — History Panel
import { icons } from '../lib/icons.js';
import { getRecordings, deleteRecording } from '../lib/storage.js';
import { formatDuration, formatSize } from '../lib/recorder.js';
import { toast } from './toast.js';

export async function renderHistoryPanel(container) {
  const recordings = await getRecordings().catch(() => []);

  if (recordings.length === 0) {
    container.innerHTML = `
      <div class="card card-compact animate-in">
        <div class="card-header"><h3>History</h3></div>
        <div class="empty-state" style="padding:var(--space-4) 0;">
          ${icons.video(32)}
          <p>Your recordings will appear here</p>
        </div>
      </div>`;
    return;
  }

  const items = recordings.slice(0, 20).map(r => {
    const date = new Date(r.date);
    const ago = timeAgo(date);
    return `
      <div class="history-item" data-id="${r.id}">
        <div class="history-icon">${icons.video(16)}</div>
        <div class="history-info">
          <div class="history-title">${esc(r.title || 'Untitled')}</div>
          <div class="history-meta">${ago} · ${formatDuration(r.duration)} · ${formatSize(r.size)}</div>
        </div>
        <div class="history-actions">
          ${r.driveLink ? `<a href="${r.driveLink}" target="_blank" rel="noopener" class="btn btn-ghost btn-icon btn-sm" title="Open in Drive">${icons.externalLink(14)}</a>` : ''}
          <button class="btn btn-ghost btn-icon btn-sm history-delete" title="Delete" data-id="${r.id}">${icons.trash(14)}</button>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="card card-compact animate-in">
      <div class="card-header"><h3>History</h3><span class="badge badge-neutral">${recordings.length}</span></div>
      <div style="display:flex;flex-direction:column;gap:var(--space-2);max-height:360px;overflow-y:auto;">
        ${items}
      </div>
    </div>`;

  container.querySelectorAll('.history-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      await deleteRecording(id);
      toast.info('Recording deleted');
      renderHistoryPanel(container);
    });
  });
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
