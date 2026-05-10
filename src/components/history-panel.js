// Takus — History Panel
import { icons } from '../lib/icons.js';
import { getRecordings, deleteRecording, clearAllRecordings } from '../lib/storage.js';
import { formatDuration, formatSize } from '../lib/recorder.js';
import { toast } from './toast.js';
import { renderSharePanel } from './share-panel.js';
import { typeLabel, typeAccent } from './type-picker.js';

const INITIAL_LIMIT = 20;

export async function renderHistoryPanel(container) {
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
                <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;">
                  <div class="history-title">${esc(r.title || 'Untitled')}</div>
                  ${_typeBadge(r.type)}
                </div>
                <div class="history-meta">${ago} · ${formatDuration(r.duration)} · ${formatSize(r.size)}</div>
                ${_metaTags(r)}
              </div>
            </div>
            <div class="history-actions" style="flex-shrink:0;">
              ${r.aiSummary ? `<button class="btn btn-ghost btn-icon btn-sm history-summary-toggle" title="View AI Summary" data-target="${r.id}">${icons.zap(14)}</button>` : ''}
              ${(r.participants?.length) ? `<button class="btn btn-ghost btn-icon btn-sm history-share" title="Share with ${r.participants.length} participant${r.participants.length !== 1 ? 's' : ''}" data-id="${r.id}">${icons.users(14)}</button>` : ''}
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
              <div style="display:flex;gap:var(--space-1);">
                <button class="btn btn-ghost btn-sm history-copy-summary" data-id="${r.id}" title="Copy summary">${icons.link(14)} Copy Summary</button>
                ${r.aiTranscript ? `<button class="btn btn-ghost btn-sm history-copy-transcript" data-id="${r.id}" title="Copy full transcript">${icons.link(14)} Copy Transcript</button>` : ''}
                ${r.aiVtt ? `<button class="btn btn-ghost btn-sm history-download-vtt" data-id="${r.id}" title="Download Subtitles (.vtt)">${icons.download(14)} .VTT</button>` : ''}
              </div>
            </div>
            <div style="line-height:1.6;">${renderMarkdown(r.aiSummary)}</div>
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
      <div id="history-list" style="display:flex;flex-direction:column;gap:var(--space-2);max-height:clamp(240px, 40vh, 520px);overflow-y:auto;">
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
    const countBadge = container.querySelector('.badge-neutral');
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      const list = document.getElementById('history-list');
      if (!list) return;
      const source = showAll ? recordings : recordings.slice(0, INITIAL_LIMIT);
      const filtered = q
        ? recordings.filter(r =>
            (r.title || '').toLowerCase().includes(q) ||
            (r.aiSummary || '').toLowerCase().includes(q) ||
            (r.aiTranscript || '').toLowerCase().includes(q)
          )
        : source;
      if (countBadge) countBadge.textContent = q ? `${filtered.length} / ${recordings.length}` : recordings.length;
      list.innerHTML = buildItems(filtered);
      bindHandlers(list);
    });
  }

  bindHandlers(container);
}

function _typeBadge(type) {
  if (!type) return '';
  const label = typeLabel(type);
  const color = typeAccent(type);
  return `<span style="font-size:10px;font-weight:600;color:${color};background:${color}22;padding:1px 6px;border-radius:10px;white-space:nowrap;" title="Recording type">${label}</span>`;
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

  if (!tags.length) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">${tags.join('')}</div>`;
}

function _cloudLabel(driveLink) {
  if (!driveLink || !driveLink.startsWith('https://')) return null;
  if (driveLink.includes('drive.google.com') || driveLink.includes('docs.google.com')) return 'Google Drive';
  if (driveLink.includes('onedrive') || driveLink.includes('sharepoint') || driveLink.includes('1drv')) return 'OneDrive';
  return 'Cloud';
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

function renderMarkdown(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  let inList = false;
  for (const line of lines) {
    const e = esc(line);
    const b = e.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (/^#{1,3} /.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<p style="font-weight:var(--weight-semi);color:var(--color-text-primary);margin:var(--space-2) 0 var(--space-1);">${b.replace(/^#+\s/, '')}</p>`);
    } else if (/^[*-] /.test(line)) {
      if (!inList) { out.push('<ul style="margin:2px 0 2px var(--space-4);padding:0;list-style:disc;">'); inList = true; }
      out.push(`<li>${b.replace(/^[*-] /, '')}</li>`);
    } else if (/^-{3,}$/.test(line.trim())) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:var(--space-2) 0;">');
    } else if (line.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('<br>');
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(b + '<br>');
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}
