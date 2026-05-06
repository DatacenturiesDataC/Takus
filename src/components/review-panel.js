import { icons } from '../lib/icons.js';
import { trimVideo, convertToGIF } from '../lib/ffmpeg-engine.js';
import { toast } from './toast.js';

export function renderReviewPanel(container, blob, { onApprove, onDiscard }) {
  const url = URL.createObjectURL(blob);
  let isProcessing = false;

  container.innerHTML = `
    <div class="card animate-in" style="width:100%; max-width:800px; margin:0 auto; padding:var(--space-4);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-4);">
        <h2 style="font-size:var(--font-lg); font-weight:var(--weight-bold);">Review Recording</h2>
        <button class="btn btn-ghost btn-sm" id="btn-discard" style="color:var(--color-danger);">${icons.trash(16)} Discard</button>
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

      <div style="display:flex; justify-content:space-between; align-items:center;">
        <button class="btn btn-ghost btn-sm" id="btn-gif">${icons.download(16)} Save as GIF</button>
        <button class="btn btn-success" id="btn-approve">${icons.check(18)} Approve & Upload</button>
      </div>
    </div>
  `;

  const video = container.querySelector('#review-video');
  const gifBtn = container.querySelector('#btn-gif');
  const approveBtn = container.querySelector('#btn-approve');
  const discardBtn = container.querySelector('#btn-discard');

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
    URL.revokeObjectURL(url);
    onDiscard();
  });

  approveBtn.addEventListener('click', async () => {
    if (isProcessing) return;
    isProcessing = true;
    approveBtn.disabled = true;
    approveBtn.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div> Processing…`;
    
    const startStr = container.querySelector('#trim-start').value;
    const endStr = container.querySelector('#trim-end').value;
    
    const start = parseFloat(startStr) || 0;
    const end = parseFloat(endStr) || 0;
    
    let finalBlob = blob;
    
    if (start > 0 || end > 0) {
      // Validate trim parameters
      if (start < 0) {
        toast.error('Invalid trim', 'Start time cannot be negative.');
        isProcessing = false;
        approveBtn.disabled = false;
        approveBtn.innerHTML = `${icons.check(18)} Approve & Upload`;
        return;
      }
      if (end > 0 && start >= end) {
        toast.error('Invalid trim', 'Start time must be before end time.');
        isProcessing = false;
        approveBtn.disabled = false;
        approveBtn.innerHTML = `${icons.check(18)} Approve & Upload`;
        return;
      }
      toast.info('Trimming video...', 'This may take a moment.');
      try {
        finalBlob = await trimVideo(blob, start, end);
        toast.success('Trim successful');
      } catch (e) {
        console.error('[Trim] Error:', e);
        toast.error('Trim failed', 'Clear trim values to upload original, or try again.');
        // Reset button so user can retry or clear trim values
        isProcessing = false;
        approveBtn.disabled = false;
        approveBtn.innerHTML = `${icons.check(18)} Approve & Upload`;
        return; // Don't silently proceed with the untrimmed blob
      }
    }
    
    URL.revokeObjectURL(url);
    onApprove(finalBlob);
  });

  gifBtn.addEventListener('click', async () => {
    if (isProcessing) return;
    isProcessing = true;
    gifBtn.disabled = true;
    const originalContent = gifBtn.innerHTML;
    gifBtn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px;"></div> Generating…`;
    
    try {
      const gifBlob = await convertToGIF(blob);
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
