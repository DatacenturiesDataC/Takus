// Takus — Pipeline Progress Component (Knowledge OS)
//
// Reusable visual component that renders a pipeline run manifest
// as an animated step-by-step progress indicator.
//
// Used in: entry-detail (right pane), insights-panel (processing cards)
//
// Features:
//   - Animated step transitions (pending → running → done/failed/skipped)
//   - Per-step duration display
//   - Error detail expansion
//   - Retry button for failed pipelines
//   - Compact and expanded rendering modes

import { esc } from '../lib/utils.js';

// ── Step Icons ──────────────────────────────────────────────────────────────

const STEP_ICONS = {
  pending:  `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1" stroke-dasharray="3 2" opacity="0.4"/></svg>`,
  running:  `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="8 4" class="pipeline-spin"/></svg>`,
  done:     `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" fill="currentColor" opacity="0.15"/><path d="M4.5 7.2L6.2 8.8L9.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  failed:   `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" fill="currentColor" opacity="0.15"/><path d="M5 5L9 9M9 5L5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  skipped:  `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1" opacity="0.25"/><path d="M5.5 5L8.5 7L5.5 9" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity="0.4"/></svg>`,
};

const STATUS_COLORS = {
  pending:  'var(--color-text-disabled)',
  running:  'var(--color-warning)',
  done:     'var(--color-success)',
  failed:   'var(--color-danger)',
  skipped:  'var(--color-text-disabled)',
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Render a pipeline progress component.
 *
 * @param {object} pipelineRun - The pipeline run manifest from entry.pipelineRun
 * @param {object} [options]
 * @param {boolean} [options.compact=false] - Compact mode (inline progress bar only)
 * @param {boolean} [options.expanded=false] - Start expanded (vs collapsed <details>)
 * @param {string}  [options.entryId] - Entry ID for retry button
 * @returns {string} HTML string
 */
export function renderPipelineProgress(pipelineRun, options = {}) {
  if (!pipelineRun?.steps?.length) return '';

  const { compact = false, expanded = false, entryId } = options;

  if (compact) {
    return _renderCompact(pipelineRun);
  }

  return _renderFull(pipelineRun, expanded, entryId);
}

/**
 * Inject the required CSS for pipeline progress animations.
 * Call once during app initialization.
 */
export function injectPipelineStyles() {
  if (document.getElementById('pipeline-progress-styles')) return;

  const style = document.createElement('style');
  style.id = 'pipeline-progress-styles';
  style.textContent = `
    @keyframes pipeline-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .pipeline-spin {
      transform-origin: 7px 7px;
      animation: pipeline-spin 1.2s linear infinite;
    }
    @keyframes pipeline-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .pipeline-step-running {
      animation: pipeline-pulse 1.5s ease-in-out infinite;
    }
    .pipeline-progress-bar {
      transition: width 0.4s ease-out;
    }
    .pipeline-step {
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .pipeline-step:hover {
      background: rgba(255, 255, 255, 0.03);
    }
  `;
  document.head.appendChild(style);
}

// ── Compact Renderer ────────────────────────────────────────────────────────

/**
 * Render a compact inline progress bar for use in list views.
 * Shows: [====>    ] 5/7 steps · 12s
 */
function _renderCompact(run) {
  const total = run.steps.length;
  const completed = run.steps.filter(s => s.status === 'done' || s.status === 'skipped').length;
  const failed = run.steps.some(s => s.status === 'failed');
  const running = run.steps.some(s => s.status === 'running');
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const barColor = failed
    ? 'var(--color-danger)'
    : running
      ? 'var(--color-warning)'
      : 'var(--color-success)';

  const statusText = failed
    ? 'Failed'
    : running
      ? `${completed}/${total} steps`
      : run.status === 'done'
        ? `Done${run.durationMs ? ` · ${_fmtDuration(run.durationMs)}` : ''}`
        : `${completed}/${total}`;

  return `
    <div style="display:flex;align-items:center;gap:var(--space-2);font-size:10px;">
      <div style="flex:1;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
        <div class="pipeline-progress-bar" style="height:100%;width:${pct}%;background:${barColor};border-radius:2px;"></div>
      </div>
      <span style="color:${STATUS_COLORS[failed ? 'failed' : running ? 'running' : 'done']};white-space:nowrap;flex-shrink:0;">${statusText}</span>
    </div>
  `;
}

// ── Full Renderer ───────────────────────────────────────────────────────────

/**
 * Render the full pipeline progress with animated step indicators.
 */
function _renderFull(run, expanded, entryId) {
  const headerColor = STATUS_COLORS[run.status] || STATUS_COLORS.pending;
  const headerLabel = run.status === 'done'
    ? '✓ Complete'
    : run.status === 'failed'
      ? '✗ Failed'
      : '⏳ Processing';
  const durationLabel = run.durationMs ? ` · ${_fmtDuration(run.durationMs)}` : '';

  const stepsHtml = run.steps.map((step, i) => _renderStep(step, i, run.steps.length)).join('');

  const retryBtn = run.status === 'failed' && entryId
    ? `<button class="pipeline-retry-btn" data-pipeline-retry="${entryId}" style="
        margin-top:var(--space-2);font-size:11px;padding:4px 12px;
        background:rgba(245,158,11,0.15);color:var(--color-warning);
        border:1px solid rgba(245,158,11,0.3);border-radius:var(--radius-sm);
        font-weight:600;cursor:pointer;align-self:flex-start;
        transition:background 0.15s ease;
      ">↻ Retry Pipeline</button>`
    : '';

  const errorBlock = run.error
    ? `<div style="
        margin-top:var(--space-2);padding:var(--space-2);
        background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);
        border-radius:var(--radius-sm);font-size:10px;color:var(--color-danger);
        font-family:var(--font-mono);word-break:break-word;
      ">${esc(run.error)}</div>`
    : '';

  return `
    <div class="pipeline-progress mt-1" >
      <details ${expanded ? 'open' : ''}>
        <summary style="
          cursor:pointer;user-select:none;
          display:flex;align-items:center;gap:var(--space-2);
          font-size:var(--font-xs);font-weight:var(--weight-semi);
          color:var(--color-text-secondary);
          padding:var(--space-1) 0;
        ">
          <span style="color:${headerColor};">⚡ Pipeline</span>
          <span style="font-size:10px;font-weight:400;color:${headerColor};">${headerLabel}${durationLabel}</span>
        </summary>

        <div style="display:flex;flex-direction:column;gap:0;margin-top:var(--space-1);position:relative;">
          <!-- Vertical connector line -->
          <div style="
            position:absolute;left:6px;top:7px;bottom:7px;width:1px;
            background:linear-gradient(to bottom, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
          "></div>

          ${stepsHtml}
        </div>

        ${errorBlock}
        ${retryBtn}
      </details>
    </div>
  `;
}

/**
 * Render a single pipeline step with icon, label, duration, and connector.
 */
function _renderStep(step, index, total) {
  const status = step.status || 'pending';
  const color = STATUS_COLORS[status];
  const icon = STEP_ICONS[status];
  const isRunning = status === 'running';

  const dur = step.startedAt && step.completedAt
    ? _fmtDuration(step.completedAt - step.startedAt)
    : '';

  const errorHint = step.error
    ? `<span style="
        font-size:9px;color:var(--color-danger);
        background:rgba(239,68,68,0.1);padding:1px 5px;
        border-radius:3px;margin-left:var(--space-1);
      " title="${esc(step.error)}">error</span>`
    : '';

  return `
    <div class="pipeline-step ${isRunning ? 'pipeline-step-running' : ''}" style="
      display:flex;align-items:center;gap:var(--space-2);
      padding:3px var(--space-1);padding-left:0;
      font-size:11px;position:relative;
      border-radius:var(--radius-xs);
    ">
      <span style="color:${color};flex-shrink:0;z-index:1;background:var(--color-bg-card);">${icon}</span>
      <span style="color:${status === 'pending' || status === 'skipped' ? 'var(--color-text-disabled)' : 'var(--color-text-secondary)'};flex:1;">${esc(step.label)}</span>
      ${dur ? `<span style="font-size:9px;color:var(--color-text-disabled);font-family:var(--font-mono);">${dur}</span>` : ''}
      ${errorHint}
    </div>
  `;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format a duration in milliseconds to a human-readable string.
 * < 1s: "230ms", < 60s: "4.2s", >= 60s: "1m 23s"
 */
function _fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

/**
 * Bind retry button click handlers within a container.
 * Call after rendering pipeline progress HTML into the DOM.
 *
 * @param {HTMLElement} container - The container holding the pipeline progress
 */
export function bindPipelineRetry(container) {
  container.querySelectorAll('[data-pipeline-retry]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const entryId = btn.dataset.pipelineRetry;
      if (!entryId) return;

      btn.disabled = true;
      btn.textContent = 'Retrying…';

      try {
        const { retryFailedStep } = await import('../lib/content-pipeline.js');
        await retryFailedStep(entryId);
      } catch (err) {
        console.warn('[Pipeline] Retry failed:', err);
        btn.textContent = '↻ Retry Pipeline';
        btn.disabled = false;
      }
    });
  });
}
