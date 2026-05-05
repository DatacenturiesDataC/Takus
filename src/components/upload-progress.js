// Takus — Upload Progress
import { icons } from '../lib/icons.js';
import { formatSize } from '../lib/recorder.js';

export function renderUploadProgress(container, { loaded = 0, total = 0, status = 'uploading', link = '', error = '', onRetry, onDismiss, onDownload, onDownloadMP4 }) {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;

  if (status === 'uploading') {
    container.innerHTML = `
      <div class="card animate-in">
        <div class="upload-panel">
          <div style="display:flex;align-items:center;gap:var(--space-3);">
            <div class="spinner"></div>
            <span style="font-size:var(--font-sm);font-weight:var(--weight-semi);">Uploading to Google Drive…</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="upload-stats">
            <span>${formatSize(loaded)} / ${formatSize(total)}</span>
            <span>${pct}%</span>
          </div>
        </div>
      </div>`;
  } else if (status === 'complete') {
    container.innerHTML = `
      <div class="card animate-in" style="border-color:rgba(16,185,129,0.3);">
        <div style="display:flex;flex-direction:column;align-items:center;gap:var(--space-4);text-align:center;">
          <div style="width:48px;height:48px;border-radius:50%;background:var(--color-success-dim);display:flex;align-items:center;justify-content:center;color:var(--color-success);">
            ${icons.check(24)}
          </div>
          <div>
            <p style="font-weight:var(--weight-semi);margin-bottom:var(--space-1);">Upload Complete</p>
            <p style="font-size:var(--font-sm);color:var(--color-text-secondary);">Your recording is saved to Google Drive</p>
          </div>
          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;justify-content:center;">
            ${link ? `<a href="${link}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">${icons.externalLink(14)} Open in Drive</a>` : ''}
            <button class="btn btn-ghost btn-sm" id="upload-mp4">${icons.download(14)} Download MP4</button>
            <button class="btn btn-ghost btn-sm" id="upload-dismiss">${icons.check(14)} Done</button>
          </div>
        </div>
      </div>`;
    container.querySelector('#upload-mp4')?.addEventListener('click', onDownloadMP4);
    container.querySelector('#upload-dismiss')?.addEventListener('click', onDismiss);
  } else if (status === 'failed') {
    container.innerHTML = `
      <div class="card animate-in" style="border-color:rgba(244,63,94,0.3);">
        <div style="display:flex;flex-direction:column;align-items:center;gap:var(--space-4);text-align:center;">
          <div style="width:48px;height:48px;border-radius:50%;background:var(--color-danger-dim);display:flex;align-items:center;justify-content:center;color:var(--color-danger);">
            ${icons.x(24)}
          </div>
          <div>
            <p style="font-weight:var(--weight-semi);margin-bottom:var(--space-1);">Upload Failed</p>
            <p style="font-size:var(--font-sm);color:var(--color-text-secondary);">${error || 'An error occurred during upload.'}</p>
          </div>
          <div style="display:flex;gap:var(--space-3);">
            <button class="btn btn-primary btn-sm" id="upload-retry">${icons.refresh(14)} Retry</button>
            <button class="btn btn-ghost btn-sm" id="upload-download">${icons.download(14)} Download Instead</button>
          </div>
        </div>
      </div>`;
    container.querySelector('#upload-retry')?.addEventListener('click', onRetry);
    container.querySelector('#upload-download')?.addEventListener('click', onDownload);
  } else if (status === 'processing') {
    container.innerHTML = `
      <div class="card animate-in">
        <div class="upload-panel">
          <div style="display:flex;align-items:center;gap:var(--space-3);">
            <div class="spinner"></div>
            <span style="font-size:var(--font-sm);font-weight:var(--weight-semi);">Processing recording…</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>
          <div class="upload-stats">
            <span>Preparing...</span>
            <span>0%</span>
          </div>
        </div>
      </div>`;
  }
}
