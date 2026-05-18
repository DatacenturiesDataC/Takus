
// Manages crash-recovery: checks IndexedDB for orphaned entry chunks
// and offers Resume / Download / Discard to the user.
//
// Extracted from AppShell to keep the shell thin and focused on layout.

import { getRecoveryData, clearRecoveryData } from '../lib/storage.js';
import { formatSize } from '../lib/recorder.js';
import { toast } from './toast.js';
import { MS_PER_DAY } from '../lib/utils.js';

/**
 * Check IndexedDB for crash-recovery data and offer to restore.
 *
 * The previous version auto-downloaded immediately on page load — that's
 * a privacy hazard on shared devices, since whoever opens the page next
 * receives the prior user's entry. We now require an explicit click.
 *
 * @param {object} deps - { sm, States, onResumeBlob }
 *   - sm: StateMachine instance
 *   - States: State enum
 *   - onResumeBlob(blob, title): called when user clicks Resume
 */
export async function checkRecovery(deps) {
  try {
    const recovery = await getRecoveryData('active_capture');
    if (!recovery || !recovery.chunks || recovery.chunks.length === 0) return;

    // Only offer recovery if data is less than 24 hours old
    if (Date.now() - recovery.updatedAt > MS_PER_DAY) {
      await clearRecoveryData('active_capture');
      return;
    }

    const size = recovery.chunks.reduce((s, c) => s + c.size, 0);
    if (size < 1024) {
      await clearRecoveryData('active_capture');
      return;
    }

    _renderRecoveryBanner(recovery, size, deps);
  } catch (e) {
    console.warn('[Recovery] Check failed:', e.message);
  }
}

/**
 * Render the recovery banner UI.
 * @private
 */
function _renderRecoveryBanner(recovery, size, deps) {
  const existing = document.getElementById('recovery-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'recovery-banner';
  banner.className = 'recovery-banner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Recovered entry');
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:var(--space-3);flex:1;min-width:0;">
      <strong>Recovered entry available.</strong>
      <span style="color:var(--color-text-secondary);">${formatSize(size)} from a previous session.</span>
    </div>
    <div style="display:flex;gap:var(--space-2);">
      <button class="btn btn-primary btn-sm" id="recovery-resume" type="button">Resume</button>
      <button class="btn btn-ghost btn-sm" id="recovery-download" type="button">Download</button>
      <button class="btn btn-ghost btn-sm" id="recovery-discard" type="button">Discard</button>
    </div>
  `;
  document.body.appendChild(banner);

  const cleanup = () => banner.remove();
  const _buildBlob = () => new Blob(recovery.chunks, { type: 'video/webm' });
  const _lockButtons = () => {
    banner.querySelectorAll('button').forEach(b => { b.disabled = true; });
  };

  banner.querySelector('#recovery-resume').addEventListener('click', () => {
    _lockButtons();
    try {
      const blob = _buildBlob();
      const title = `Recovered entry — ${new Date(recovery.updatedAt).toLocaleDateString()}`;
      clearRecoveryData('active_capture').catch(() => {});
      cleanup();
      deps.onResumeBlob(blob, title);
    } catch (e) {
      console.warn('[Recovery] Resume failed:', e);
      toast.error('Recovery failed', e?.message || 'Could not reconstruct the entry');
      cleanup();
    }
  });

  banner.querySelector('#recovery-download').addEventListener('click', () => {
    _lockButtons();
    try {
      const blob = _buildBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recovered-entry-${new Date(recovery.updatedAt).toISOString().slice(0, 10)}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      console.warn('[Recovery] Download failed:', e);
      toast.error('Recovery failed', e?.message || 'Could not reconstruct the entry');
    }
    clearRecoveryData('active_capture').catch(() => {});
    cleanup();
  });

  banner.querySelector('#recovery-discard').addEventListener('click', () => {
    _lockButtons();
    clearRecoveryData('active_capture').catch(() => {});
    cleanup();
  });
}
