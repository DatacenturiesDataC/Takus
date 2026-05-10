import { icons } from '../lib/icons.js';
import { trimVideo, convertToGIF } from '../lib/ffmpeg-engine.js';
import { formatSize, formatDuration } from '../lib/recorder.js';
import { toast } from './toast.js';
import { typeLabel, typeAccent } from './type-picker.js';

export function renderReviewPanel(container, blob, { onApprove, onDiscard, pendingTitle = '', recordingType = null, hasProvider = false }) {
  const url = URL.createObjectURL(blob);
  let isProcessing = false;

  container.innerHTML = `
    <div class="card animate-in" style="width:100%; max-width:800px; margin:0 auto; padding:var(--space-4);">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:var(--space-4); gap:var(--space-3);">
        <div style="flex:1; min-width:0;">
          <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-2);">
            <h2 style="font-size:var(--font-lg); font-weight:var(--weight-bold);">Review Recording</h2>
            ${recordingType ? `<span style="font-size:11px;font-weight:600;color:${typeAccent(recordingType)};background:${typeAccent(recordingType)}22;padding:2px 8px;border-radius:10px;">${typeLabel(recordingType)}</span>` : ''}
          </div>
          <input type="text" id="review-title" class="input" value="${esc(pendingTitle)}" placeholder="Recording title…"
            style="font-size:var(--font-sm);" autocomplete="off" maxlength="200" />
          <div id="review-meta" style="font-size:var(--font-xs);color:var(--color-text-muted);margin-top:4px;">${formatSize(blob.size)}</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="btn-discard" style="color:var(--color-danger);flex-shrink:0;" title="Discard (Esc)">${icons.trash(16)} Discard</button>
      </div>

      <div style="border-radius:var(--radius-lg); overflow:hidden; background:#000; margin-bottom:var(--space-4); box-shadow:var(--shadow-md);">
        <video id="review-video" src="${url}" controls preload="metadata" aria-label="Recording preview" style="width:100%; max-height:450px; display:block;"></video>
      </div>

      <div style="display:flex; gap:var(--space-4); margin-bottom:var(--space-4); background:rgba(255,255,255,0.02); padding:var(--space-3); border-radius:var(--radius-md); border:1px solid rgba(255,255,255,0.05);">
        <div style="flex:1;">
          <label style="display:block; font-size:var(--font-sm); color:var(--color-text-secondary); margin-bottom:var(--space-1);">Trim Start (seconds)</label>
          <div style="display:flex; gap:var(--space-2); align-items:center;">
            <input type="number" id="trim-start" class="input" value="0" min="0" step="0.1" style="flex:1;">
            <button class="btn btn-ghost btn-sm" id="btn-set-trim-start" title="Set to current video position" style="white-space:nowrap; font-size:var(--font-xs);">${icons.clock(12)} Now</button>
          </div>
        </div>
        <div style="flex:1;">
          <label style="display:block; font-size:var(--font-sm); color:var(--color-text-secondary); margin-bottom:var(--space-1);">Trim End (seconds)</label>
          <div style="display:flex; gap:var(--space-2); align-items:center;">
            <input type="number" id="trim-end" class="input" placeholder="e.g. 15.5" min="0" step="0.1" style="flex:1;">
            <button class="btn btn-ghost btn-sm" id="btn-set-trim-end" title="Set to current video position" style="white-space:nowrap; font-size:var(--font-xs);">${icons.clock(12)} Now</button>
          </div>
          <div style="font-size:var(--font-xs); color:var(--color-text-muted); margin-top:4px;">Leave empty to keep till end.</div>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-3);">
        <span style="font-size:var(--font-xs);color:var(--color-text-muted);margin-right:var(--space-1);">Speed:</span>
        ${[0.5, 1, 1.5, 2].map(s => `<button class="btn btn-ghost btn-sm speed-btn" data-speed="${s}" style="min-width:38px;padding:2px 8px;${s===1?'border-color:rgba(124,58,237,0.4);color:var(--color-primary-light);':''}">${s}×</button>`).join('')}
        <div style="width:1px;height:16px;background:rgba(255,255,255,0.1);margin:0 var(--space-1);"></div>
        <button class="btn btn-ghost btn-sm" id="btn-loop">${icons.refresh(14)} Loop</button>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <button class="btn btn-ghost btn-sm" id="btn-gif">${icons.download(16)} Save as GIF</button>
          <span id="gif-size-note" style="display:none;font-size:10px;color:var(--color-text-muted);">Long video — GIF may be large</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
          <button class="btn btn-success" id="btn-approve" title="Approve (Enter)">
            ${icons.check(18)} ${hasProvider ? 'Approve &amp; Upload' : 'Save Locally'}
          </button>
          ${!hasProvider ? `<span style="font-size:var(--font-xs);color:var(--color-text-muted);">Connect a cloud provider in Settings to upload</span>` : ''}
        </div>
      </div>
      <div style="margin-top:var(--space-2);text-align:center;font-size:10px;color:var(--color-text-disabled);">
        <kbd style="background:var(--color-bg-elevated);padding:1px 5px;border-radius:3px;">Enter</kbd> approve &nbsp;·&nbsp;
        <kbd style="background:var(--color-bg-elevated);padding:1px 5px;border-radius:3px;">Esc</kbd> discard
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

  // Playback speed
  container.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (video) video.playbackRate = parseFloat(btn.dataset.speed);
      container.querySelectorAll('.speed-btn').forEach(b => {
        b.style.borderColor = '';
        b.style.color = '';
      });
      btn.style.borderColor = 'rgba(124,58,237,0.4)';
      btn.style.color = 'var(--color-primary-light)';
    });
  });

  // Loop toggle
  container.querySelector('#btn-loop')?.addEventListener('click', (e) => {
    if (!video) return;
    video.loop = !video.loop;
    e.currentTarget.style.borderColor = video.loop ? 'rgba(124,58,237,0.4)' : '';
    e.currentTarget.style.color = video.loop ? 'var(--color-primary-light)' : '';
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
    gifBtn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div> Generating…`;

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
      const gifUrl = URL.createObjectURL(gifBlob);
      const a = document.createElement('a');
      a.href = gifUrl;
      a.download = 'takus-clip.gif';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(gifUrl), 60000);
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

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
