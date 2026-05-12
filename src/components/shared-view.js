// Takus — Shared Summary View (Phase 7: SHARE)
// Renders a read-only overlay when the URL hash contains a #share= payload.
// Self-contained: no IndexedDB access, no app-shell dependency.

import { icons } from '../lib/icons.js';
import { esc, renderMarkdown } from '../lib/utils.js';
import { typeLabel, typeAccent } from './type-picker.js';


function _shortDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Check the URL hash for a #share= payload and render a read-only overlay if found.
 * Safe to call unconditionally on page load — no-ops when hash is absent or malformed.
 */
export function renderSharedView() {
  const hash = location.hash;
  if (!hash.startsWith('#share=')) return;

  let data;
  try {
    data = JSON.parse(decodeURIComponent(atob(hash.slice(7))));
  } catch {
    return; // malformed hash — ignore silently
  }

  if (!data?.aiSummary) return;

  const { title, date, type, aiSummary } = data;
  const accent = typeAccent(type || 'screen');

  const overlay = document.createElement('div');
  overlay.id = 'shared-view-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:99999;',
    'background:var(--color-bg-base, #08081a);',
    'overflow-y:auto;padding:var(--space-6) var(--space-4);',
    'display:flex;flex-direction:column;align-items:center;',
  ].join('');

  overlay.innerHTML = `
    <div style="width:100%;max-width:700px;display:flex;flex-direction:column;gap:var(--space-4);">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);">
        <div style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--font-xs);color:var(--color-text-muted);">
          ${icons.video(14)}
          <span style="font-weight:600;color:var(--color-primary-light);">Takus</span>
          <span>· Shared Summary</span>
        </div>
        <div style="display:flex;gap:var(--space-2);">
          <button id="shared-download" class="btn btn-ghost btn-sm" style="font-size:var(--font-xs);">${icons.download(13)} Download .md</button>
          <button id="shared-dismiss" class="btn btn-primary btn-sm" style="font-size:var(--font-xs);">${icons.x(13)} Close</button>
        </div>
      </div>

      <!-- Summary card -->
      <div class="card" style="padding:var(--space-5);">

        <!-- Title + meta -->
        <div style="margin-bottom:var(--space-4);">
          <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-2);">
            <h1 style="font-size:var(--font-lg);font-weight:700;color:var(--color-text-primary);margin:0;">${esc(title || 'Untitled')}</h1>
            <span style="font-size:10px;font-weight:600;color:${accent};background:${accent}22;padding:2px 8px;border-radius:10px;">${typeLabel(type || 'screen')}</span>
          </div>
          ${date ? `<p style="font-size:var(--font-xs);color:var(--color-text-muted);margin:0;">${_shortDate(date)}</p>` : ''}
        </div>

        <!-- Divider -->
        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:0 0 var(--space-4);">

        <!-- Summary content -->
        <div style="font-size:var(--font-sm);color:var(--color-text-secondary);line-height:1.65;">
          ${renderMarkdown(aiSummary)}
        </div>

      </div>

      <!-- Footer -->
      <p style="text-align:center;font-size:var(--font-xs);color:var(--color-text-disabled);">
        Summary shared via <strong style="color:var(--color-primary-light);">Takus</strong> — free AI-powered screen recorder
      </p>

    </div>`;

  document.body.appendChild(overlay);

  overlay.querySelector('#shared-dismiss').addEventListener('click', () => {
    history.replaceState(null, '', location.pathname + location.search);
    overlay.remove();
  });

  overlay.querySelector('#shared-download').addEventListener('click', () => {
    const lines = [
      `# ${title || 'Untitled'}`,
      date ? `_${_shortDate(date)} · ${typeLabel(type || 'screen')}_` : '',
      '',
      aiSummary,
    ].filter(l => l !== undefined);
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || 'recording').replace(/[^a-z0-9]+/gi, '-')}-summary.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
}
