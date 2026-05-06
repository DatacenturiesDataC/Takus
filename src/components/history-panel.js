// Takus — History Panel
import { icons } from '../lib/icons.js';
import { getRecordings, deleteRecording, clearAllRecordings } from '../lib/storage.js';
import { formatDuration, formatSize } from '../lib/recorder.js';
import { toast } from './toast.js';

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

  const items = recordings.slice(0, 20).map(r => {
    const date = new Date(r.date);
    const ago = timeAgo(date);
    return `
      <div class="history-item" data-id="${r.id}" style="display:flex; flex-direction:column; gap:var(--space-2);">
        <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
          <div style="display:flex; align-items:center; gap:var(--space-3);">
            <div class="history-icon">${icons.video(16)}</div>
            <div class="history-info">
              <div class="history-title">${esc(r.title || 'Untitled')}</div>
              <div class="history-meta">${ago} · ${formatDuration(r.duration)} · ${formatSize(r.size)}</div>
            </div>
          </div>
          <div class="history-actions">
            ${r.aiSummary ? `<button class="btn btn-ghost btn-icon btn-sm history-summary-toggle" title="View AI Summary" data-target="${r.id}">${icons.zap(14)}</button>` : ''}
            ${(r.driveLink && r.driveLink.startsWith('https://')) ? `<a href="${r.driveLink}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-icon btn-sm" title="Open recording">${icons.externalLink(14)}</a>` : ''}
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

  container.innerHTML = `
    <div class="card card-compact animate-in">
      <div class="card-header">
        <h3>History</h3>
        <div style="display:flex;align-items:center;gap:var(--space-2);">
          <span class="badge badge-neutral">${recordings.length}</span>
          <button class="btn btn-ghost btn-sm" id="history-clear-all" style="font-size:var(--font-xs);color:var(--color-text-muted);" title="Clear all recordings">${icons.trash(12)}</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--space-2);max-height:360px;overflow-y:auto;">
        ${items}
      </div>
    </div>`;

  container.querySelector('#history-clear-all')?.addEventListener('click', async () => {
    if (!confirm(`Delete all ${recordings.length} recordings from history? This cannot be undone.`)) return;
    await clearAllRecordings();
    toast.info('All recordings cleared');
    renderHistoryPanel(container);
  });

  container.querySelectorAll('.history-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      // Confirm deletion to prevent accidental loss
      if (!confirm('Delete this recording from history? This cannot be undone.')) return;
      await deleteRecording(id);
      toast.info('Recording deleted');
      renderHistoryPanel(container);
    });
  });

  // AI summary toggle — proper event delegation instead of inline onclick
  container.querySelectorAll('.history-summary-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.history-item');
      const summaryBox = item?.querySelector('.ai-summary-box');
      if (summaryBox) summaryBox.classList.toggle('hidden');
    });
  });

  container.querySelectorAll('.history-download-vtt').forEach(btn => {
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
