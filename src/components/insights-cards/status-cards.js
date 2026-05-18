// Takus — Insights: Status Cards (extracted from insights-panel.js)
// Health, Approval, Activity, and Wellbeing dashboard cards.

import { esc, timeAgo, MS_PER_HOUR } from '../../lib/utils.js';
import { icons } from '../../lib/icons.js';
import { formatSize } from '../../lib/recorder.js';
import { getArchiveStats } from '../../lib/archive-engine.js';
import { runHealthCheck } from '../../lib/health-check.js';
import { getActivitySummary, getTimeline } from '../../lib/activity-timeline.js';
import { getApprovalCount } from '../../lib/approval-center.js';
import { getSessionDuration, estimateFocusCapacity } from '../../lib/wellbeing.js';

// ── Archive Stats Card ─────────────────────────────────────────────────────

export async function archiveStatsCard() {
  try {
    const stats = await getArchiveStats();
    if (!stats.total) return '';

    const archivedPct = stats.total > 0 ? Math.round((stats.archived / stats.total) * 100) : 0;
    const savingsMb = Math.round(stats.potentialSavings / 1024 / 1024);

    return `
      <div class="card card-compact">
        <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);margin-bottom:var(--space-3);">${icons.archive(12)} Archive Intelligence</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-2);text-align:center;margin-bottom:var(--space-3);">
          <div>
            <div style="font-size:var(--font-md);font-weight:var(--weight-bold);color:var(--color-text-primary);">${stats.active}</div>
            <div style="font-size:10px;color:var(--color-text-disabled);">Active</div>
          </div>
          <div>
            <div style="font-size:var(--font-md);font-weight:var(--weight-bold);color:#8b5cf6;">${stats.archived}</div>
            <div style="font-size:10px;color:var(--color-text-disabled);">Archived</div>
          </div>
          <div>
            <div style="font-size:var(--font-md);font-weight:var(--weight-bold);color:#f59e0b;">${stats.pinned}</div>
            <div style="font-size:10px;color:var(--color-text-disabled);">Pinned</div>
          </div>
        </div>
        ${stats.eligible > 0 ? `
          <div style="padding:var(--space-2) var(--space-3);background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);border-radius:var(--radius-md);margin-bottom:var(--space-2);">
            <div style="font-size:var(--font-xs);color:var(--color-text-secondary);">
              ${icons.zap(10)} <strong>${stats.eligible}</strong> entry${stats.eligible !== 1 ? 's' : ''} eligible for archival
              ${savingsMb > 0 ? `— potential savings: <strong style="color:#8b5cf6;">${savingsMb > 1024 ? (savingsMb/1024).toFixed(1) + ' GB' : savingsMb + ' MB'}</strong>` : ''}
            </div>
          </div>` : `
          <div style="font-size:var(--font-xs);color:var(--color-text-disabled);">No entries eligible for archival yet.</div>`}
        ${stats.archived > 0 ? `
          <div style="height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
            <div style="width:${archivedPct}%;height:100%;background:linear-gradient(90deg,#8b5cf6,#6366f1);border-radius:2px;transition:width 0.4s;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:9px;color:var(--color-text-disabled);">
            <span>${archivedPct}% archived</span>
            <span>${formatSize(stats.totalSize)} total</span>
          </div>` : ''}
      </div>`;
  } catch {
    return '';
  }
}

// ── Platform Health Card ────────────────────────────────────────

export async function healthCard() {
  try {
    const report = await runHealthCheck();
    const statusColor = report.status === 'healthy' ? 'var(--color-success)'
      : report.status === 'healthy_with_warnings' ? 'var(--color-warning)'
      : 'var(--color-danger)';
    const statusLabel = report.status === 'healthy' ? 'All systems healthy'
      : report.status === 'healthy_with_warnings' ? 'Healthy with warnings'
      : 'Issues detected';

    const checksHtml = report.checks.map(c => {
      const icon = c.status === 'ok' ? `<span style="color:var(--color-success);">✓</span>` : `<span style="color:var(--color-danger);">✗</span>`;
      return `<div style="display:flex;align-items:center;gap:6px;font-size:10px;padding:2px 0;">
        ${icon} <span style="color:var(--color-text-secondary);">${esc(c.name)}</span>
        <span style="color:var(--color-text-disabled);margin-left:auto;">${esc(c.detail)}</span>
      </div>`;
    }).join('');

    const warningsHtml = report.warnings.length > 0
      ? `<div style="margin-top:var(--space-2);padding:var(--space-2) var(--space-3);background:rgba(245,158,11,0.06);border-radius:var(--radius-sm);border:1px solid rgba(245,158,11,0.15);">
          ${report.warnings.map(w => `<div style="font-size:10px;color:var(--color-warning);padding:1px 0;">⚠ ${esc(w)}</div>`).join('')}
        </div>`
      : '';

    return `
      <div class="card card-compact">
        <div class="flex-between" style="margin-bottom:var(--space-2);">
          <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);">${icons.shield(12)} Platform Health</span>
          <span style="font-size:10px;color:${statusColor};font-weight:var(--weight-semi);">● ${statusLabel}</span>
        </div>
        ${checksHtml}
        ${warningsHtml}
      </div>`;
  } catch {
    return '';
  }
}

// ── Approval Queue Card ─────────────────────────────────────────

export async function approvalCard() {
  try {
    const count = await getApprovalCount();
    if (count === 0) return '';

    return `
      <div class="card card-compact">
        <div class="flex-between" style="margin-bottom:var(--space-1);">
          <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);">🔐 Approval Center</span>
          <span style="font-size:10px;font-weight:600;padding:1px 7px;border-radius:8px;background:var(--color-warning);color:#000;">${count}</span>
        </div>
        <p style="font-size:10px;color:var(--color-text-muted);margin:0;">
          ${count} action${count !== 1 ? 's' : ''} awaiting your approval before Takus can proceed.
        </p>
      </div>`;
  } catch {
    return '';
  }
}

// ── Activity Timeline Card ──────────────────────────────────────

export async function activityCard() {
  try {
    const summary = await getActivitySummary(7);
    const total = summary.entries + summary.tasksCreated + summary.tasksDone + summary.decisions;
    if (total === 0) return '';

    const recent = await getTimeline({ limit: 5 });

    return `
      <div class="card card-compact">
        <div class="flex-between" style="margin-bottom:var(--space-2);">
          <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);">📊 Activity (7 days)</span>
          <span style="font-size:10px;color:var(--color-text-disabled);">${total} events</span>
        </div>
        <div style="display:flex;gap:var(--space-3);font-size:10px;color:var(--color-text-muted);margin-bottom:var(--space-2);">
          ${summary.entries > 0 ? `<span>📥 ${summary.entries} entries</span>` : ''}
          ${summary.tasksCreated > 0 ? `<span>📌 ${summary.tasksCreated} tasks</span>` : ''}
          ${summary.tasksDone > 0 ? `<span>✅ ${summary.tasksDone} done</span>` : ''}
          ${summary.decisions > 0 ? `<span>⚖️ ${summary.decisions} decisions</span>` : ''}
        </div>
        ${recent.length > 0 ? `
        <div style="border-top:1px solid rgba(255,255,255,0.04);padding-top:var(--space-2);">
          ${recent.map(e => `
            <div style="display:flex;align-items:center;gap:6px;font-size:10px;padding:2px 0;">
              <span>${e.icon}</span>
              <span style="color:var(--color-text-secondary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(e.title)}</span>
              <span style="color:var(--color-text-disabled);flex-shrink:0;">${timeAgo(new Date(e.timestamp))}</span>
            </div>
          `).join('')}
        </div>` : ''}
      </div>`;
  } catch {
    return '';
  }
}

// ── Wellbeing Dashboard Card ────────────────────────────────────

export async function wellbeingCard(entries, allTasks = []) {
  try {
    const pendingTasks = allTasks.filter(t => (t.status || 'pending') === 'pending').length;
    const meetingEntries = entries.filter(r => r.type === 'meeting');
    const recentMeetings = meetingEntries.filter(r => {
      const ts = typeof r.date === 'number' ? r.date : new Date(r.date).getTime();
      return Date.now() - ts < 4 * MS_PER_HOUR;
    }).length;

    const focus = estimateFocusCapacity({
      sessionDuration: getSessionDuration(),
      meetingCount: recentMeetings,
      pendingTasks,
    });

    const sessionMin = Math.floor(getSessionDuration() / 60000);
    const gaugeColor = focus.level === 'high' ? '#22c55e' :
                       focus.level === 'medium' ? '#f59e0b' : '#ef4444';
    const gaugeWidth = focus.focusScore;

    const suggestions = [];
    if (pendingTasks > 15) suggestions.push('📋 High task load — consider triaging');
    if (recentMeetings >= 3) suggestions.push('🧘 Meeting fatigue — block focus time');
    if (sessionMin > 120) suggestions.push('🌿 Long session — consider a short break');
    if (focus.level === 'low') suggestions.push('💤 Low focus capacity — lighter tasks recommended');

    return `
      <div class="card card-compact animate-in">
        <div class="card-header">
          <h3>🧘 Wellbeing</h3>
          <span style="font-size:10px;color:var(--color-text-muted);">Focus & balance</span>
        </div>
        <div style="padding:var(--space-3);display:flex;flex-direction:column;gap:var(--space-3);">

          <!-- Focus gauge -->
          <div style="display:flex;align-items:center;gap:var(--space-3);">
            <div style="flex:1;">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span style="font-size:11px;color:var(--color-text-secondary);">Focus Capacity</span>
                <span style="font-size:11px;font-weight:600;color:${gaugeColor};">${focus.focusScore}%</span>
              </div>
              <div style="height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
                <div style="height:100%;width:${gaugeWidth}%;background:${gaugeColor};border-radius:3px;transition:width 0.5s ease;"></div>
              </div>
            </div>
          </div>

          <!-- Stats row -->
          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;">
            <div style="flex:1;min-width:80px;background:rgba(255,255,255,0.03);border-radius:var(--radius-sm);padding:var(--space-2);text-align:center;">
              <div style="font-size:16px;font-weight:700;color:var(--color-text-primary);">${sessionMin}m</div>
              <div style="font-size:9px;color:var(--color-text-disabled);">Session</div>
            </div>
            <div style="flex:1;min-width:80px;background:rgba(255,255,255,0.03);border-radius:var(--radius-sm);padding:var(--space-2);text-align:center;">
              <div style="font-size:16px;font-weight:700;color:${pendingTasks > 15 ? '#f59e0b' : 'var(--color-text-primary)'};">${pendingTasks}</div>
              <div style="font-size:9px;color:var(--color-text-disabled);">Pending Tasks</div>
            </div>
            <div style="flex:1;min-width:80px;background:rgba(255,255,255,0.03);border-radius:var(--radius-sm);padding:var(--space-2);text-align:center;">
              <div style="font-size:16px;font-weight:700;color:${recentMeetings >= 3 ? '#f59e0b' : 'var(--color-text-primary)'};">${recentMeetings}</div>
              <div style="font-size:9px;color:var(--color-text-disabled);">Recent Meetings</div>
            </div>
          </div>

          <!-- Suggestion -->
          ${suggestions.length ? `
            <div style="font-size:11px;color:var(--color-text-secondary);line-height:1.6;padding:var(--space-2);background:rgba(139,92,246,0.06);border-radius:var(--radius-sm);border-left:2px solid var(--color-primary);">
              ${suggestions.slice(0, 2).join('<br>')}
            </div>
          ` : `
            <div style="font-size:11px;color:var(--color-text-muted);text-align:center;padding:var(--space-1);">
              ✨ You're in good shape. Keep it up!
            </div>
          `}

        </div>
      </div>`;
  } catch {
    return '';
  }
}
