
// Renders a read-only overlay when the URL hash contains a #share= payload.
// Self-contained: no IndexedDB access, no app-shell dependency.

import { icons } from '../lib/icons.js';
import { esc, renderMarkdown, longDate, downloadBlob } from '../lib/utils.js';
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
    } catch { /* non-critical */
      return; // function not available (local dev) — ignore
    }
  }
  // Legacy base64 format: #share=<base64>
  else if (hash.startsWith('#share=')) {
    try {
      data = JSON.parse(decodeURIComponent(atob(hash.slice(7))));
    } catch { /* non-critical */
      return;
    }
  }
  else {
    return;
  }

  if (!data?.aiSummary) return;

  const { title, date, type, aiSummary } = data;
  const accent = typeAccent(type || 'screen');
  const allTasks = Array.isArray(data.tasks) ? data.tasks : [];

  const overlay = document.createElement('div');
  overlay.id = 'shared-view-overlay';
  overlay.className = 'shared-overlay';

  overlay.innerHTML = `
    <div class="shared-container">

      <!-- Header -->
      <div class="shared-header">
        <div class="shared-brand">
          ${icons.video(14)}
          <span class="shared-brand-name">Takus</span>
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
        <div class="shared-title-area">
          <div class="shared-title-row">
            <h1 class="shared-title">${esc(title || 'Untitled')}</h1>
            <span class="shared-type-badge" style="color:${accent};background:${accent}22;">${typeLabel(type || 'screen')}</span>
          </div>
          ${date ? `<p class="shared-date">${longDate(date)}</p>` : ''}
        </div>

        <!-- Divider -->
        <hr class="shared-divider">

        <!-- Summary content (aiSummary is external input — sanitise before rendering) -->
        <div class="shared-body">
          ${aiSummary
            ? renderMarkdown(aiSummary.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
            : `<p class="shared-body--empty">Open the full link for the complete AI summary.</p>`
          }
        </div>

      </div>

      ${allTasks.length ? `
      <!-- Tasks card -->
      <div class="card" style="padding:var(--space-4);">
        <div class="shared-tasks-header">
          ${icons.checkSquare(12)} Action Items
          <span class="shared-tasks-count">${allTasks.length} task${allTasks.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="rd-col-stack">
          ${allTasks.map(t => {
            const icon = (t.status || 'pending') === 'done' ? '✅' : (t.status || 'pending') === 'ignored' ? '🚫' : '⏳';
            const tTitle = esc(t.title || t.note || 'Task');
            const isDone = (t.status || 'pending') !== 'pending';
            const borderColor = (t.status || 'pending') === 'done' ? 'var(--color-success)' : (t.status || 'pending') === 'ignored' ? 'var(--color-warning)' : 'rgba(255,255,255,0.1)';
            const stepsHtml = t.steps?.length ? `<div class="mt-4">${t.steps.map(s => {
              const text = typeof s === 'string' ? s : s.text;
              return `<div class="shared-task-step">
                <span style="opacity:0.6;">${isStepDone(s) ? '☑' : '☐'}</span>
                <span style="${isStepDone(s) ? 'text-decoration:line-through;' : ''}">${esc(text)}</span>
              </div>`;
            }).join('')}</div>` : '';
            return `
              <div class="shared-task-item${isDone ? ' shared-task-item--done' : ''}" style="border-left:2px solid ${borderColor};">
                <div class="text-xs text-secondary" >${icon} ${tTitle}</div>
                ${t.objective ? `<div class="shared-task-objective">→ ${esc(t.objective)}</div>` : ''}
                ${stepsHtml}
                ${t.output ? `<div class="shared-task-output">${icons.check(9)} ${esc(t.output)}</div>` : ''}
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
    downloadBlob(
      new Blob([lines.join('\n')], { type: 'text/markdown' }),
      `${(title || 'entry').replace(/[^a-z0-9]+/gi, '-')}-summary.md`
    );
  });
}
