// Takus — Consent Notice
import { icons } from '../lib/icons.js';

export function renderConsentNotice(container) {
  container.innerHTML = `
    <div class="consent-banner">
      ${icons.alertTriangle(16)}
      <span><strong>Recording notice:</strong> Always inform other participants before recording. Recording consent laws vary by jurisdiction.</span>
    </div>
  `;
}
