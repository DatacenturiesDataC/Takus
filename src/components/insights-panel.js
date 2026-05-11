// Takus — Insights Panel (Phase 5: CORTEX — Cross-Recording Intelligence)
// Pure browser computation on existing IndexedDB data. Zero network cost.

import { getRecordings } from '../lib/storage.js';
import { icons } from '../lib/icons.js';
import { formatDuration } from '../lib/recorder.js';
import { typeLabel, typeAccent } from './type-picker.js';

const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/**
 * Render the Insights dashboard into `container`.
 * Async — reads all recordings from IndexedDB before painting.
 */
export async function renderInsightsPanel(container) {
  const recordings = await getRecordings().catch(() => []);

  if (!recordings.length) {
    container.innerHTML = `
      <div class="card card-compact animate-in" style="text-align:center;padding:var(--space-8) var(--space-4);">
        ${icons.barChart(28)}
        <p style="margin-top:var(--space-3);color:var(--color-text-muted);font-size:var(--font-sm);">No recordings yet — insights appear after your first session.</p>
      </div>`;
    return;
  }

  // ── Aggregate stats ───────────────────────────────────────────────────────
  const totalDuration  = recordings.reduce((s, r) => s + (r.duration || 0), 0);
  const withAI         = recordings.filter(r => r.aiSummary).length;
  const withTasks      = recordings.filter(r =>
    (r.tasks?.takusTasks?.length || 0) + (r.tasks?.meTasks?.length || 0) > 0
  ).length;

  const typeCounts = {};
  for (const r of recordings) {
    const t = r.type || 'screen';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];

  // ── Quality trend (last 10 scored recordings, chronological) ─────────────
  const scored = recordings
    .filter(r => r.analytics?.score?.score != null)
    .slice(0, 10)
    .reverse();

  // ── Filler word aggregate ─────────────────────────────────────────────────
  const fillerTotals = {};
  for (const r of recordings) {
    for (const f of r.analytics?.fillerWords?.breakdown || []) {
      fillerTotals[f.label] = (fillerTotals[f.label] || 0) + f.count;
    }
  }
  const topFillers = Object.entries(fillerTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const avgQuality = scored.length
    ? Math.round(scored.reduce((s, r) => s + r.analytics.score.score, 0) / scored.length)
    : null;

  // ── Decision ledger ───────────────────────────────────────────────────────
  const decisions = [];
  for (const r of recordings) {
    for (const t of r.tasks?.takusTasks || []) {
      if (t.action === 'LOG_DECISION') {
        decisions.push({ task: t, recording: r });
      }
    }
  }
  decisions.sort((a, b) => new Date(b.recording.date) - new Date(a.recording.date));

  // ── Render ────────────────────────────────────────────────────────────────
  container.innerHTML = `
    <div class="animate-in" style="display:flex;flex-direction:column;gap:var(--space-4);">

      <!-- Stats strip -->
      <div class="card card-compact">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-3);text-align:center;">
          ${_statCell(icons.video(16), recordings.length, 'Recordings')}
          ${_statCell(icons.clock(16), formatDuration(totalDuration), 'Recorded')}
          ${_statCell(icons.zap(16), withAI, 'AI Processed')}
          ${_statCell(icons.checkSquare(16), withTasks, 'With Tasks')}
        </div>
      </div>

      <!-- Quality trend + top type -->
      <div style="display:grid;grid-template-columns:1fr auto;gap:var(--space-4);align-items:start;">

        <!-- Sparkline -->
        ${scored.length >= 2 ? `
          <div class="card card-compact">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3);">
              <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);">${icons.trendingUp(12)} Quality Trend${avgQuality != null ? ` — avg <strong style="color:${_qualColor(avgQuality)}">${avgQuality}</strong>` : ''}</span>
              <span style="font-size:10px;color:var(--color-text-disabled);">last ${scored.length}</span>
            </div>
            ${_sparkline(scored.map(r => r.analytics.score.score))}
            <div style="display:flex;justify-content:space-between;margin-top:4px;">
              ${scored.map(r => `<span style="font-size:9px;color:var(--color-text-disabled);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:48px;" title="${esc(r.title || '')}">${esc(_shortDate(r.date))}</span>`).join('')}
            </div>
          </div>` : `<div></div>`}

        <!-- Top type + filler badge -->
        <div style="display:flex;flex-direction:column;gap:var(--space-3);">
          ${topType ? `
            <div class="card card-compact" style="text-align:center;min-width:110px;">
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-bottom:4px;">Top type</div>
              <div style="font-weight:var(--weight-semi);color:${typeAccent(topType[0])};font-size:var(--font-sm);">${typeLabel(topType[0])}</div>
              <div style="font-size:10px;color:var(--color-text-disabled);">${topType[1]} of ${recordings.length}</div>
            </div>` : ''}
          ${avgQuality != null ? `
            <div class="card card-compact" style="text-align:center;">
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-bottom:4px;">${icons.shield(12)} Avg quality</div>
              <div style="font-weight:var(--weight-bold);font-size:20px;color:${_qualColor(avgQuality)};">${avgQuality}</div>
            </div>` : ''}
        </div>
      </div>

      <!-- Filler word leaderboard -->
      ${topFillers.length ? `
        <div class="card card-compact">
          <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);margin-bottom:var(--space-3);">${icons.alertTriangle(12)} Filler Words (all recordings)</div>
          <div style="display:flex;flex-direction:column;gap:var(--space-2);">
            ${topFillers.map(([label, count], i) => _fillerBar(label, count, topFillers[0][1], i)).join('')}
          </div>
        </div>` : ''}

      <!-- Decision ledger -->
      ${decisions.length ? `
        <div class="card card-compact">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3);">
            <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);">${icons.bookOpen(12)} Decision Ledger</span>
            <span class="badge badge-neutral">${decisions.length}</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:var(--space-2);max-height:320px;overflow-y:auto;">
            ${decisions.slice(0, 20).map(({ task, recording }) => _decisionRow(task, recording)).join('')}
          </div>
          ${decisions.length > 20 ? `<p style="font-size:var(--font-xs);color:var(--color-text-disabled);margin-top:var(--space-2);text-align:center;">+ ${decisions.length - 20} more decisions</p>` : ''}
        </div>` : `
        <div class="card card-compact" style="text-align:center;padding:var(--space-6);">
          <p style="font-size:var(--font-xs);color:var(--color-text-disabled);">No logged decisions yet. Ask AI to extract decisions during meeting recordings.</p>
        </div>`}

    </div>`;
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _statCell(icon, value, label) {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:var(--space-2) 0;">
      <span style="color:var(--color-text-muted);">${icon}</span>
      <span style="font-size:var(--font-md);font-weight:var(--weight-bold);color:var(--color-text-primary);">${esc(String(value))}</span>
      <span style="font-size:10px;color:var(--color-text-disabled);">${label}</span>
    </div>`;
}

function _sparkline(scores) {
  const W = 320, H = 56, pad = 4;
  const n = scores.length;
  if (n < 2) return '';
  const xStep = (W - pad * 2) / (n - 1);
  const yScale = (H - pad * 2) / 100;

  const pts = scores.map((v, i) => [pad + i * xStep, H - pad - v * yScale]);

  // Gradient area path
  const areaPath = `M${pts[0][0]},${H - pad} ` +
    pts.map(p => `L${p[0]},${p[1]}`).join(' ') +
    ` L${pts[n-1][0]},${H - pad} Z`;

  const linePath = `M${pts.map(p => `${p[0]},${p[1]}`).join(' L')}`;

  const dots = pts.map((p, i) => {
    const color = _qualColor(scores[i]);
    return `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${color}" stroke="var(--color-surface)" stroke-width="1.5"/>`;
  }).join('');

  return `
    <svg width="100%" viewBox="0 0 ${W} ${H}" fill="none" preserveAspectRatio="none" style="display:block;overflow:visible;">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--color-primary-light)" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="var(--color-primary-light)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#spark-grad)"/>
      <path d="${linePath}" stroke="var(--color-primary-light)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
    </svg>`;
}

function _fillerBar(label, count, max, rank) {
  const pct = Math.max(4, Math.round((count / max) * 100));
  const colors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22d3ee'];
  const color = colors[rank] || '#6b7280';
  return `
    <div style="display:flex;align-items:center;gap:var(--space-2);">
      <span style="font-size:var(--font-xs);color:var(--color-text-secondary);min-width:56px;text-align:right;">${esc(label)}</span>
      <div style="flex:1;height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div>
      </div>
      <span style="font-size:var(--font-xs);color:var(--color-text-muted);min-width:28px;">${count}×</span>
    </div>`;
}

function _decisionRow(task, recording) {
  const p = task.payload || {};
  const decision = p.decision || task.title;
  const owner = p.owner ? ` · ${esc(p.owner)}` : '';
  const dateStr = _shortDate(recording.date);
  return `
    <div style="display:flex;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <span style="color:var(--color-primary-light);flex-shrink:0;margin-top:1px;">${icons.flag(12)}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:var(--font-xs);color:var(--color-text-primary);line-height:1.4;">${esc(decision)}</div>
        <div style="font-size:10px;color:var(--color-text-disabled);margin-top:2px;">
          ${esc(recording.title || 'Untitled')}${owner} · ${esc(dateStr)}
        </div>
      </div>
    </div>`;
}

function _qualColor(score) {
  if (score >= 85) return 'var(--color-success)';
  if (score >= 70) return '#10b981';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

function _shortDate(dateVal) {
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
