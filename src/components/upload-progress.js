// Takus — Upload Progress
import { icons } from '../lib/icons.js';
import { formatSize } from '../lib/recorder.js';

export function renderUploadProgress(container, { loaded = 0, total = 0, status = 'uploading', entryTitle = '', link = '', error = '', participants = [], onRetry, onDismiss, onDownload, onDownloadMP4, onDownloadGIF, onShare }) {
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
            <p id="upload-recording-title" style="font-size:var(--font-sm);font-weight:var(--weight-semi);color:var(--color-primary-light);margin-bottom:var(--space-1);display:none;"></p>
            <p style="font-size:var(--font-sm);color:var(--color-text-secondary);">Saved to your cloud storage</p>
          </div>
          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;justify-content:center;">
            ${(link && link.startsWith('https://')) ? `<a href="${link}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">${icons.externalLink(14)} Open</a>` : ''}
            ${(link && link.startsWith('https://')) ? `<button class="btn btn-ghost btn-sm" id="upload-copy-link">${icons.link(14)} Copy Link</button>` : ''}
            <button class="btn btn-ghost btn-sm" id="upload-mp4">${icons.download(14)} MP4</button>
            <button class="btn btn-ghost btn-sm" id="upload-gif">${icons.download(14)} GIF</button>
            ${participants.length ? `<button class="btn btn-ghost btn-sm" id="upload-share">${icons.users(14)} Share with ${participants.length} Participant${participants.length !== 1 ? 's' : ''}</button>` : ''}
            <button class="btn btn-ghost btn-sm" id="upload-dismiss">${icons.video(14)} New Recording</button>
          </div>
        </div>
      </div>`;
    const titleEl = container.querySelector('#upload-recording-title');
    if (titleEl && entryTitle) { titleEl.textContent = `"${entryTitle}"`; titleEl.style.display = 'block'; }
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
    container.querySelector('#upload-share')?.addEventListener('click', () => onShare?.(participants));
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
          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;justify-content:center;">
            <button class="btn btn-primary btn-sm" id="upload-retry">${icons.refresh(14)} Retry Upload</button>
            <button class="btn btn-ghost btn-sm" id="upload-download">${icons.download(14)} Save Locally</button>
            <button class="btn btn-ghost btn-sm" id="upload-discard">${icons.video(14)} New Recording</button>
          </div>
        </div>
      </div>`;
    // Set error message safely via textContent (prevents XSS)
    const errorEl = container.querySelector('#upload-error-msg');
    if (errorEl) errorEl.textContent = error || 'An error occurred during upload.';
    container.querySelector('#upload-retry')?.addEventListener('click', onRetry);
    container.querySelector('#upload-download')?.addEventListener('click', onDownload);
    container.querySelector('#upload-discard')?.addEventListener('click', onDismiss);
  } else if (status === 'processing') {
    container.innerHTML = `
      <div class="card animate-in">
        <div class="upload-panel">
          <div style="display:flex;align-items:center;gap:var(--space-3);">
            <div class="spinner"></div>
            <span id="processing-label" style="font-size:var(--font-sm);font-weight:var(--weight-semi);">Processing recording…</span>
          </div>
          <div class="progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"><div id="processing-fill" class="progress-fill" style="width:0%;transition:width 0.4s ease;"></div></div>
          <div class="upload-stats">
            <span id="processing-sub">Hang tight…</span>
            <span id="processing-pct">—</span>
          </div>
        </div>
      </div>`;
  }
}

/**
 * Update the processing phase label and progress in-place (no full re-render).
 * Safe to call even if the processing card is not in the DOM.
 */
export function updateProcessingPhase(label, pct, sub) {
  const labelEl = document.getElementById('processing-label');
  const fillEl = document.getElementById('processing-fill');
  const subEl = document.getElementById('processing-sub');
  const pctEl = document.getElementById('processing-pct');
  if (labelEl && label != null) labelEl.textContent = label;
  if (fillEl && pct != null) { fillEl.style.width = `${pct}%`; fillEl.closest('[role="progressbar"]')?.setAttribute('aria-valuenow', pct); }
  if (subEl && sub != null) subEl.textContent = sub;
  if (pctEl && pct != null) pctEl.textContent = `${Math.round(pct)}%`;
}
