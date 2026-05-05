import { icons } from '../lib/icons.js';
import { trimVideo } from '../lib/ffmpeg-engine.js';
import { toast } from './toast.js';

export function renderReviewPanel(container, blob, { onApprove, onDiscard }) {
  const url = URL.createObjectURL(blob);

  container.innerHTML = `
    <div class="card animate-in" style="width:100%; max-width:800px; margin:0 auto; padding:var(--space-4);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-4);">
        <h2 style="font-size:var(--font-lg); font-weight:var(--weight-bold);">Review Recording</h2>
        <button class="btn btn-ghost btn-sm" id="btn-discard" style="color:var(--color-danger);">${icons.trash(16)} Discard</button>
      </div>

      <div style="border-radius:var(--radius-lg); overflow:hidden; background:#000; margin-bottom:var(--space-4); box-shadow:var(--shadow-md);">
        <video id="review-video" src="${url}" controls style="width:100%; max-height:450px; display:block;"></video>
      </div>

      <div style="display:flex; gap:var(--space-4); margin-bottom:var(--space-4); background:rgba(255,255,255,0.02); padding:var(--space-3); border-radius:var(--radius-md); border:1px solid rgba(255,255,255,0.05);">
        <div style="flex:1;">
          <label style="display:block; font-size:var(--font-sm); color:var(--color-text-secondary); margin-bottom:var(--space-1);">Trim Start (seconds)</label>
          <input type="number" id="trim-start" class="input" value="0" min="0" step="0.1" style="width:100%;">
        </div>
        <div style="flex:1;">
          <label style="display:block; font-size:var(--font-sm); color:var(--color-text-secondary); margin-bottom:var(--space-1);">Trim End (seconds)</label>
          <input type="number" id="trim-end" class="input" placeholder="e.g. 15.5" min="0" step="0.1" style="width:100%;">
          <div style="font-size:var(--font-xs); color:var(--color-text-muted); margin-top:4px;">Leave empty to keep till end.</div>
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:var(--space-3);">
        <button class="btn btn-success" id="btn-approve">${icons.check(18)} Approve & Upload</button>
      </div>
    </div>
  `;

  const video = container.querySelector('#review-video');

  container.querySelector('#btn-discard').addEventListener('click', () => {
    URL.revokeObjectURL(url);
    onDiscard();
  });

  container.querySelector('#btn-approve').addEventListener('click', async () => {
    const startStr = container.querySelector('#trim-start').value;
    const endStr = container.querySelector('#trim-end').value;
    
    const start = parseFloat(startStr) || 0;
    const end = parseFloat(endStr) || 0;
    
    let finalBlob = blob;
    
    if (start > 0 || end > 0) {
      toast.info('Trimming video...', 'This may take a moment.');
      try {
        finalBlob = await trimVideo(blob, start, end);
        toast.success('Trim successful');
      } catch (e) {
        console.error('[Trim] Error:', e);
        toast.error('Trim failed', 'Proceeding with original video.');
      }
    }
    
    URL.revokeObjectURL(url);
    onApprove(finalBlob);
  });
}
