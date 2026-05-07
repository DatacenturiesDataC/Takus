// Takus — Consent Notice (dismissible)
import { icons } from '../lib/icons.js';

export function renderConsentNotice(container) {
  container.innerHTML = `
    <div class="consent-banner" id="consent-banner">
      ${icons.alertTriangle(16)}
      <span style="flex:1;"><strong>Recording notice:</strong> Always inform other participants before recording. Recording consent laws vary by jurisdiction.</span>
      <button id="dismiss-consent" style="background:none;border:none;color:var(--color-warning);cursor:pointer;padding:var(--space-1);opacity:0.6;transition:opacity 0.2s;" title="Dismiss">${icons.x(14)}</button>
    </div>
  `;

  const banner = container.querySelector('#consent-banner');
  const dismissBtn = container.querySelector('#dismiss-consent');
  
  // Persist dismissal across sessions — once the user has acknowledged,
  // don't show the banner again on every page load.
  if (localStorage.getItem('takus_consent_dismissed')) {
    banner.style.display = 'none';
  }

  dismissBtn?.addEventListener('click', () => {
    banner.style.display = 'none';
    try { localStorage.setItem('takus_consent_dismissed', '1'); } catch {}
  });
}

/**
 * Renders the site footer with legal links.
 * Separated from consent notice so app-shell can place it at the absolute bottom.
 */
export function renderFooter(container) {
  container.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; gap:var(--space-4); padding:var(--space-6) 0 var(--space-2); flex-wrap:wrap;">
      <a href="./privacy.html" class="footer-link">${icons.shield(12)} Privacy Policy</a>
      <span style="color:var(--color-text-disabled); font-size:var(--font-xs);">·</span>
      <a href="./terms.html" class="footer-link">${icons.info(12)} Terms of Service</a>
      <span style="color:var(--color-text-disabled); font-size:var(--font-xs);">·</span>
      <a href="https://github.com/DatacenturiesDataC/Takus" target="_blank" rel="noopener noreferrer" class="footer-link">${icons.externalLink(12)} GitHub</a>
    </div>
    <div style="text-align:center; padding-bottom:var(--space-4);">
      <span style="color:var(--color-text-disabled); font-size:var(--font-xs);">© 2026 Takus. All rights reserved.</span>
    </div>
  `;
}
