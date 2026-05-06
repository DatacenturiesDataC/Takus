// Takus — Consent Notice + Footer
import { icons } from '../lib/icons.js';

export function renderConsentNotice(container) {
  container.innerHTML = `
    <div class="consent-banner">
      ${icons.alertTriangle(16)}
      <span><strong>Recording notice:</strong> Always inform other participants before recording. Recording consent laws vary by jurisdiction.</span>
    </div>
    <div style="display:flex; justify-content:center; align-items:center; gap:var(--space-4); padding:var(--space-6) 0 var(--space-2); flex-wrap:wrap;">
      <a href="/privacy" style="color:var(--color-text-muted); font-size:var(--font-xs); text-decoration:none; transition:color 0.2s;" onmouseover="this.style.color='var(--color-primary-light)'" onmouseout="this.style.color='var(--color-text-muted)'">${icons.shield(12)} Privacy Policy</a>
      <span style="color:var(--color-text-disabled); font-size:var(--font-xs);">·</span>
      <a href="/terms" style="color:var(--color-text-muted); font-size:var(--font-xs); text-decoration:none; transition:color 0.2s;" onmouseover="this.style.color='var(--color-primary-light)'" onmouseout="this.style.color='var(--color-text-muted)'">${icons.info(12)} Terms of Service</a>
      <span style="color:var(--color-text-disabled); font-size:var(--font-xs);">·</span>
      <a href="https://github.com/DatacenturiesDataC/Takus" target="_blank" rel="noopener" style="color:var(--color-text-muted); font-size:var(--font-xs); text-decoration:none; transition:color 0.2s;" onmouseover="this.style.color='var(--color-primary-light)'" onmouseout="this.style.color='var(--color-text-muted)'">${icons.externalLink(12)} GitHub</a>
    </div>
    <div style="text-align:center; padding-bottom:var(--space-4);">
      <span style="color:var(--color-text-disabled); font-size:var(--font-xs);">© 2026 Takus. All rights reserved.</span>
    </div>
  `;
}
