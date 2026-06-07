import { icons } from '../lib/icons.js';
import { esc, downloadBlob } from '../lib/utils.js';
import { trimVideo, convertToGIF } from '../lib/ffmpeg-engine.js';
import { formatSize, formatDuration } from '../lib/recorder.js';
import { toast } from './toast.js';
import { typeLabel, typeAccent } from '../lib/content-types.js';

export function renderReviewPanel(container, blob, { onApprove, onDiscard, pendingTitle = '', contentType = null, hasProvider = false }) {
  const url = URL.createObjectURL(blob);
  let isProcessing = false;

  container.innerHTML = `
    <div class="card animate-in rev-card">
      <div class="flex-between rev-header">
        <div class="rev-header-left">
          <div class="flex-center gap-2 mb-2" >
            <h2 class="rd-title rev-header-title">Review Capture</h2>
            ${contentType ? `<span style="font-size:var(--text-2xs);font-weight:600;color:${typeAccent(contentType)};background:${typeAccent(contentType)}22;padding:2px 8px;border-radius:10px;">${typeLabel(contentType)}</span>` : ''}
          </div>
          <input type="text" id="review-title" class="input text-sm" value="${esc(pendingTitle)}" placeholder="AI will generate a title (or type your own)" aria-label="Entry title"
             autocomplete="off" maxlength="200" />
          <div id="review-meta" class="rd-text-sm rev-meta">${formatSize(blob.size)}</div>
        </div>
        <button class="btn btn-ghost btn-sm rev-discard" id="btn-discard" title="Discard (Esc)">${icons.trash(16)} Discard</button>
      </div>

      <div class="rev-video-wrap">
        <video id="review-video" src="${url}" controls preload="metadata" aria-label="Entry preview" class="rev-video"></video>
      </div>

      <div class="rev-trim-panel">
        <div class="flex-1">
          <label class="rev-label">Trim Start (seconds)</label>
          <div class="set-flex-row rev-trim-row">
            <input type="number" id="trim-start" class="input flex-1" value="0" min="0" step="0.1" >
            <button class="btn btn-ghost btn-sm text-xs nowrap" id="btn-set-trim-start" title="Set to current video position" >${icons.clock(12)} Now</button>
          </div>
        </div>
        <div class="flex-1">
          <label class="rev-label">Trim End (seconds)</label>
          <div class="set-flex-row rev-trim-row">
            <input type="number" id="trim-end" class="input flex-1" placeholder="e.g. 15.5" min="0" step="0.1" >
            <button class="btn btn-ghost btn-sm text-xs nowrap" id="btn-set-trim-end" title="Set to current video position" >${icons.clock(12)} Now</button>
          </div>
          <div class="rev-trim-hint">Leave empty to keep till end.</div>
        </div>
      </div>

      <div class="flex-center mb-3 rev-speed-bar">
        <span class="rev-speed-label">Speed:</span>
        ${[0.5, 1, 1.5, 2].map(s => `<button class="btn btn-ghost btn-sm speed-btn" data-speed="${s}" style="min-width:38px;padding:2px 8px;${s===1?'border-color:rgba(124,58,237,0.4);color:var(--accent-hover);':''}">${s}×</button>`).join('')}
        <div class="rev-speed-divider"></div>
        <button class="btn btn-ghost btn-sm" id="btn-loop">${icons.refresh(14)} Loop</button>
      </div>

      <div class="rev-action-bar">
        <div class="rev-action-left">
          <button class="btn btn-ghost btn-sm" id="btn-gif">${icons.download(16)} Save as GIF</button>
          <span id="gif-size-note" class="rev-gif-note">Long video — GIF may be large</span>
        </div>
        <div class="rev-action-right">
          <button class="btn btn-success" id="btn-approve" title="Approve (Enter)">
            ${icons.check(18)} ${hasProvider ? 'Approve &amp; Upload' : 'Save Locally'}
          </button>
          ${!hasProvider ? `<span class="text-xs-muted">Connect a cloud provider in Settings to upload</span>` : ''}
        </div>
      </div>
      <div class="rev-footer">
        <kbd class="code-badge-sm">Enter</kbd> approve &nbsp;·&nbsp;
        <kbd class="code-badge-sm">Esc</kbd> discard
      </div>
    </div>
  `;

  const video = container.querySelector('#review-video');
  const gifBtn = container.querySelector('#btn-gif');
  const approveBtn = container.querySelector('#btn-approve');
  const discardBtn = container.querySelector('#btn-discard');
  const titleInput = container.querySelector('#review-title');

  // Update meta row and trim-end max once video duration is known
  video?.addEventListener('loadedmetadata', () => {
    const meta = container.querySelector('#review-meta');
    if (meta && video.duration && isFinite(video.duration)) {
      meta.textContent = `${formatDuration(Math.round(video.duration * 1000))} · ${formatSize(blob.size)}`;
    }
    const trimEnd = container.querySelector('#trim-end');
    if (trimEnd && isFinite(video.duration)) {
      trimEnd.placeholder = `max ${(Math.round(video.duration * 10) / 10)}s`;
      trimEnd.max = video.duration;
    }
    // Warn users that GIF conversion for long videos produces very large files
    if (isFinite(video.duration) && video.duration > 15) {
      const note = container.querySelector('#gif-size-note');
      if (note) note.style.display = 'block';
    }
  });

  // Keyboard shortcuts: Enter = approve, Escape = discard
  const keyHandler = (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
    if (e.key === 'Enter' && !isProcessing) {
      e.preventDefault();
      approveBtn?.click();
    } else if (e.key === 'Escape' && !isProcessing) {
      e.preventDefault();
      discardBtn?.click();
    }
  };
  document.addEventListener('keydown', keyHandler);
  const cleanupKey = () => document.removeEventListener('keydown', keyHandler);

  // Auto-cleanup: detect when the review panel is removed from the DOM
  // (e.g. state reset without going through approve/discard buttons)
  const card = container.querySelector('.card');
  if (card) {
    const removalObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.removedNodes) {
          if (node === card || node.contains?.(card)) {
            cleanupKey();
            removalObserver.disconnect();
            return;
          }
        }
      }
    });
    removalObserver.observe(container, { childList: true, subtree: true });
  }

  // Playback speed
  container.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (video) video.playbackRate = parseFloat(btn.dataset.speed);
      container.querySelectorAll('.speed-btn').forEach(b => {
        b.style.borderColor = '';
        b.style.color = '';
      });
      btn.style.borderColor = 'rgba(124,58,237,0.4)';
      btn.style.color = 'var(--accent-hover)';
    });
  });

  // Loop toggle
  container.querySelector('#btn-loop')?.addEventListener('click', (e) => {
    if (!video) return;
    video.loop = !video.loop;
    e.currentTarget.style.borderColor = video.loop ? 'rgba(124,58,237,0.4)' : '';
    e.currentTarget.style.color = video.loop ? 'var(--accent-hover)' : '';
  });

  // "Now" buttons — set trim inputs from video's current playback position
  container.querySelector('#btn-set-trim-start')?.addEventListener('click', () => {
    const input = container.querySelector('#trim-start');
    if (input && video) input.value = Math.round(video.currentTime * 10) / 10;
  });
  container.querySelector('#btn-set-trim-end')?.addEventListener('click', () => {
    const input = container.querySelector('#trim-end');
    if (input && video) input.value = Math.round(video.currentTime * 10) / 10;
  });

  discardBtn.addEventListener('click', () => {
    cleanupKey();
    URL.revokeObjectURL(url);
    onDiscard();
  });

  approveBtn.addEventListener('click', async () => {
    if (isProcessing) return;
    isProcessing = true;
    cleanupKey();
    approveBtn.disabled = true;
    approveBtn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Processing…`;

    const startStr = container.querySelector('#trim-start').value;
    const endStr = container.querySelector('#trim-end').value;

    const start = parseFloat(startStr) || 0;
    const end = parseFloat(endStr) || 0;
    const videoDuration = video?.duration && isFinite(video.duration) ? video.duration : Infinity;

    let finalBlob = blob;

    if (start > 0 || end > 0) {
      const resetBtn = () => {
        isProcessing = false;
        approveBtn.disabled = false;
        approveBtn.innerHTML = `${icons.check(18)} ${hasProvider ? 'Approve &amp; Upload' : 'Save Locally'}`;
        document.addEventListener('keydown', keyHandler);
      };
      if (start < 0) {
        toast.error('Invalid trim', 'Start time cannot be negative.');
        resetBtn(); return;
      }
      if (end > 0 && start >= end) {
        toast.error('Invalid trim', 'Start time must be before end time.');
        resetBtn(); return;
      }
      if (start >= videoDuration) {
        toast.error('Invalid trim', `Start time exceeds video duration (${Math.round(videoDuration * 10) / 10}s).`);
        resetBtn(); return;
      }
      if (end > 0 && end > videoDuration) {
        toast.error('Invalid trim', `End time exceeds video duration (${Math.round(videoDuration * 10) / 10}s).`);
        resetBtn(); return;
      }
      toast.info('Trimming video...', 'This may take a moment.');
      try {
        finalBlob = await trimVideo(blob, start, end);
        toast.success('Trim successful');
      } catch (e) {
        console.error('[Trim] Error:', e);
        toast.error('Trim failed', 'Clear trim values to upload original, or try again.');
        resetBtn(); return;
      }
    }

    const title = titleInput?.value.trim() || '';
    URL.revokeObjectURL(url);
    onApprove(finalBlob, title);
  });

  gifBtn.addEventListener('click', async () => {
    if (isProcessing) return;
    isProcessing = true;
    gifBtn.disabled = true;
    const originalContent = gifBtn.innerHTML;
    gifBtn.innerHTML = `<div class="spinner spinner-14" ></div> Generating…`;

    try {
      const startStr = container.querySelector('#trim-start').value;
      const endStr = container.querySelector('#trim-end').value;
      const trimStart = parseFloat(startStr) || 0;
      const trimEnd = parseFloat(endStr) || 0;
      let sourceBlob = blob;
      if (trimStart > 0 || trimEnd > 0) {
        sourceBlob = await trimVideo(blob, trimStart, trimEnd);
      }
      const gifBlob = await convertToGIF(sourceBlob);
      downloadBlob(gifBlob, 'takus-clip.gif');
      toast.success('GIF Saved', 'Your animation is ready.');
    } catch (e) {
      console.error('[GIF] Error:', e);
      toast.error('GIF Failed', e.message || 'Could not generate GIF.');
    } finally {
      isProcessing = false;
      gifBtn.disabled = false;
      gifBtn.innerHTML = originalContent;
    }
  });
}


