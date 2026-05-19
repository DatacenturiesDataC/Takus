
// Renders a read-only overlay when the URL hash contains a #share= payload.
// Self-contained: no IndexedDB access, no app-shell dependency.

import { icons } from '../lib/icons.js';
import { esc, renderMarkdown, longDate } from '../lib/utils.js';
import { typeLabel, typeAccent } from '../lib/content-types.js';
import { isStepDone } from '../lib/task-helpers.js';




/**
 * Check the URL hash for a #share= payload and render a read-only overlay if found.
 * Safe to call unconditionally on page load — no-ops when hash is absent or malformed.
 */
export async function renderSharedView() {
  const hash = location.hash;

  let data;

  // Short URL format: #s=<shortId>
  if (hash.startsWith('#s=')) {
    const shortId = hash.slice(3).trim();
    if (!shortId || !/^[a-z0-9]{4,16}$/.test(shortId)) return;
    try {
      const res = await fetch(`/api/share?id=${shortId}`);
      if (!res.ok) return;
      data = await res.json();
    } catch {
      return; // function not available (local dev) — ignore
    }
  }
  // Legacy base64 format: #share=<base64>
  else if (hash.startsWith('#share=')) {
    try {
      data = JSON.parse(decodeURIComponent(atob(hash.slice(7))));
    } catch {
      return;
    }
  }
  else {
    return;
  }

  if (!data?.aiSummary) return;

  const { title, date, type, aiSummary } = data;
  const accent = typeAccent(type || 'screen');
  const allTasks = []; // Tasks live in graph nodes — shared payloads don't include them

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
        <div class="set-flex-row">
          <button id="shared-download" class="btn btn-ghost btn-sm text-xs" >${icons.download(13)} Download .md</button>
          <button id="shared-dismiss" class="btn btn-primary btn-sm text-xs" >${icons.x(13)} Close</button>
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
          ${date ? `<p style="font-size:var(--font-xs);color:var(--color-text-muted);margin:0;">${longDate(date)}</p>` : ''}
        </div>

        <!-- Divider -->
        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:0 0 var(--space-4);">

        <!-- Summary content -->
        <div style="font-size:var(--font-sm);color:var(--color-text-secondary);line-height:1.65;">
          ${aiSummary
            ? renderMarkdown(aiSummary)
            : `<p style="color:var(--color-text-muted);font-style:italic;">Open the full link for the complete AI summary.</p>`
          }
        </div>

      </div>

      ${allTasks.length ? `
      <!-- Tasks card -->
      <div class="card" style="padding:var(--space-4);">
        <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);margin-bottom:var(--space-3);display:flex;align-items:center;gap:var(--space-2);">
          ${icons.checkSquare(12)} Action Items
          <span style="font-size:9px;color:var(--color-text-disabled);font-weight:400;">${allTasks.length} task${allTasks.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="rd-col-stack">
          ${allTasks.map(t => {
            const icon = (t.status || 'pending') === 'done' ? '✅' : (t.status || 'pending') === 'ignored' ? '🚫' : '⏳';
            const tTitle = esc(t.title || t.note || 'Task');
            const stepsHtml = t.steps?.length ? `<div class="mt-4">${t.steps.map(s => {
              const text = typeof s === 'string' ? s : s.text;
              return `<div style="font-size:10px;color:var(--color-text-disabled);display:flex;align-items:center;gap:4px;padding:1px 0;">
                <span style="opacity:0.6;">${isStepDone(s) ? '☑' : '☐'}</span>
                <span style="${isStepDone(s) ? 'text-decoration:line-through;' : ''}">${esc(text)}</span>
              </div>`;
            }).join('')}</div>` : '';
            return `
              <div style="border-left:2px solid ${(t.status || 'pending') === 'done' ? 'var(--color-success)' : (t.status || 'pending') === 'ignored' ? 'var(--color-warning)' : 'rgba(255,255,255,0.1)'};padding-left:var(--space-2);${(t.status || 'pending') !== 'pending' ? 'opacity:0.6;' : ''}">
                <div class="text-xs text-secondary" >${icon} ${tTitle}</div>
                ${t.objective ? `<div style="font-size:9px;color:var(--color-primary-light);margin-top:2px;">→ ${esc(t.objective)}</div>` : ''}
                ${stepsHtml}
                ${t.output ? `<div style="font-size:10px;color:var(--color-success);margin-top:2px;">${icons.check(9)} ${esc(t.output)}</div>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      <!-- Footer -->
      <p class="text-center text-xs text-disabled">
        Summary shared via <strong class="text-primary">Takus</strong> — adaptive AI Knowledge OS
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
      date ? `_${longDate(date)} · ${typeLabel(type || 'screen')}_` : '',
      '',
      aiSummary,
    ].filter(l => l !== undefined);

    // Append tasks if present
    if (allTasks.length) {
      lines.push('', '---', '', '## Action Items', '');
      for (const t of allTasks) {
        const icon = (t.status || 'pending') === 'done' ? '✅' : (t.status || 'pending') === 'ignored' ? '🚫' : '⏳';
        lines.push(`### ${icon} ${t.title || t.note || 'Task'}`);
        if (t.objective) lines.push(`> → ${t.objective}`);
        if (t.steps?.length) {
          for (const s of t.steps) {
            const text = typeof s === 'string' ? s : s.text;
            lines.push(`- [${isStepDone(s) ? 'x' : ' '}] ${text}`);
          }
        }
        if (t.output) lines.push(`**Output:** ${t.output}`);
        lines.push('');
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || 'entry').replace(/[^a-z0-9]+/gi, '-')}-summary.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
}
