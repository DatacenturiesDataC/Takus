// Takus — Upload Progress
import { icons } from '../lib/icons.js';
import { formatSize } from '../lib/recorder.js';

export function renderUploadProgress(container, { loaded = 0, total = 0, status = 'uploading', link = '', error = '', onRetry, onDismiss, onDownload, onDownloadMP4, onDownloadGIF }) {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;

  if (status === 'uploading') {
    container.innerHTML = `
      <div class="card animate-in">
        <div class="upload-panel">
          <div style="display:flex;align-items:center;gap:var(--space-3);">
            <div class="spinner"></div>
            <span style="font-size:var(--font-sm);font-weight:var(--weight-semi);">Uploading to cloud…</span>
          </div>
          <div class="progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Upload progress"><div class="progress-fill" style="width:${pct}%"></div></div>
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
            <p style="font-size:var(--font-sm);color:var(--color-text-secondary);">Your recording is saved to the cloud</p>
          </div>
          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;justify-content:center;">
            ${(link && link.startsWith('https://drive.google.com/')) ? `<a href="${link}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">${icons.externalLink(14)} Open in Drive</a>` : (link && link.startsWith('https://')) ? `<a href="${link}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">${icons.externalLink(14)} Open</a>` : ''}
            ${(link && link.startsWith('https://')) ? `<button class="btn btn-ghost btn-sm" id="upload-copy-link">${icons.link(14)} Copy Link</button>` : ''}
            <button class="btn btn-ghost btn-sm" id="upload-mp4">${icons.download(14)} MP4</button>
            <button class="btn btn-ghost btn-sm" id="upload-gif">${icons.download(14)} GIF</button>
            <button class="btn btn-ghost btn-sm" id="upload-dismiss">${icons.video(14)} New Recording</button>
          </div>
        </div>
      </div>`;
    container.querySelector('#upload-copy-link')?.addEventListener('click', async (e) => {
      try {
        await navigator.clipboard.writeText(link);
        e.currentTarget.innerHTML = `${icons.check(14)} Copied!`;
        setTimeout(() => { if (e.currentTarget) e.currentTarget.innerHTML = `${icons.link(14)} Copy Link`; }, 2000);
      } catch { /* clipboard may not be available */ }
    });
    container.querySelector('#upload-mp4')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      btn.innerHTML = `<div class="spinner" style="width:12px;height:12px;border-width:2px;"></div> Converting…`;
      Promise.resolve(onDownloadMP4?.()).then(() => {
        btn.innerHTML = `${icons.check(14)} Downloaded`;
        setTimeout(() => { btn.disabled = false; btn.innerHTML = `${icons.download(14)} MP4`; }, 2000);
      }).catch(() => { btn.disabled = false; btn.innerHTML = `${icons.download(14)} MP4`; });
    });
    container.querySelector('#upload-gif')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      btn.innerHTML = `<div class="spinner" style="width:12px;height:12px;border-width:2px;"></div> Converting…`;
      Promise.resolve(onDownloadGIF?.()).then(() => {
        btn.innerHTML = `${icons.check(14)} Downloaded`;
        setTimeout(() => { btn.disabled = false; btn.innerHTML = `${icons.download(14)} GIF`; }, 2000);
      }).catch(() => { btn.disabled = false; btn.innerHTML = `${icons.download(14)} GIF`; });
    });
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
            <p id="upload-error-msg" style="font-size:var(--font-sm);color:var(--color-text-secondary);word-break:break-word;max-width:400px;"></p>
          </div>
          <div style="display:flex;gap:var(--space-3);">
            <button class="btn btn-primary btn-sm" id="upload-retry">${icons.refresh(14)} Retry</button>
            <button class="btn btn-ghost btn-sm" id="upload-download">${icons.download(14)} Save Locally</button>
          </div>
        </div>
      </div>`;
    // Set error message safely via textContent (prevents XSS)
    const errorEl = container.querySelector('#upload-error-msg');
    if (errorEl) errorEl.textContent = error || 'An error occurred during upload.';
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
