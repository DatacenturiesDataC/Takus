// Takus — Hero Section (landing when idle)
import { icons } from '../lib/icons.js';

export function renderHeroSection(container) {
  container.innerHTML = `
    <div class="card animate-in" style="text-align:center;padding:var(--space-10) var(--space-8);">
      <div style="display:flex;flex-direction:column;align-items:center;gap:var(--space-5);">
        <div style="width:64px;height:64px;border-radius:var(--radius-xl);background:var(--color-accent-gradient);display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-glow);">
          ${icons.video(32)}
        </div>
        <div>
          <h2 style="font-size:var(--font-3xl);font-weight:var(--weight-heavy);letter-spacing:-0.03em;margin-bottom:var(--space-2);">
            Record. Vault. Share.
          </h2>
          <p style="font-size:var(--font-lg);color:var(--color-text-secondary);max-width:460px;margin:0 auto;line-height:1.6;">
            Record any screen or video call. Automatically save to your Google Drive. Free forever.
          </p>
        </div>
        <div style="display:flex;gap:var(--space-6);flex-wrap:wrap;justify-content:center;margin-top:var(--space-2);">
          <div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-sm);color:var(--color-text-muted);">
            ${icons.shield(16)} Privacy-first
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-sm);color:var(--color-text-muted);">
            ${icons.zap(16)} No install needed
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-sm);color:var(--color-text-muted);">
            ${icons.hardDrive(16)} Your Drive, your data
          </div>
        </div>
      </div>
    </div>
  `;
}
