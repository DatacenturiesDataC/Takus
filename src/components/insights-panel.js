
// Pure browser computation on existing IndexedDB data. Zero network cost.
// Decomposed: rendering helpers in ./insights-cards/ submodules.

import { getEntries, deleteMediaBlob, getEdgesForNode, getContacts } from '../lib/storage.js';
import { icons } from '../lib/icons.js';
import { esc, shortDate, MS_PER_DAY } from '../lib/utils.js';
import { OPEN_ENTRY, DATE_FILTER } from '../lib/events.js';
import { formatDuration } from '../lib/recorder.js';
import { typeLabel, typeAccent } from './type-picker.js';
import { toast } from './toast.js';
import { computeTaskMetrics } from '../lib/analytics.js';
import { generateDailyDigest } from '../lib/daily-digest.js';
import { getEdgeTypeConfig } from '../lib/edge-types.js';
import { detectBlindSpots } from '../lib/blind-spot-detector.js';
import { getSignals } from '../lib/preference-engine.js';
import { isEnabled } from '../lib/feature-flags.js';
import { getAllTasks } from '../lib/graph/task-store.js';
import { getLatestEvents } from '../lib/calendar-poller.js';

// Extracted card renderers
import { statCell, qualColor, sparkline, fillerBar, decisionRow, detectConflicts, typePieDonut, activityHeatmap, weeklyDigest } from './insights-cards/stats-helpers.js';
import { archiveStatsCard, healthCard, approvalCard, activityCard, wellbeingCard } from './insights-cards/status-cards.js';

/**
 * Render the Insights dashboard into `container`.
 * Async — reads all entries from IndexedDB before painting.
 */
export async function renderInsightsPanel(container) {
  const entries = await getEntries().catch(() => []);

  if (!entries.length) {
    container.innerHTML = `
      <div class="card card-compact animate-in" style="padding:var(--space-6) var(--space-4);">
        <div class="empty-state">
          ${icons.barChart(32)}
          <p style="margin-top:var(--space-2);">No insights yet</p>
          <p style="font-size:var(--font-xs);color:var(--color-text-disabled);max-width:280px;margin:0 auto;">
            Insights emerge after your first entry. You'll see quality trends, filler word analysis, weekly digests, and knowledge patterns.
          </p>
        </div>
      </div>`;
    return;
  }

  // ── Aggregate stats ───────────────────────────────────────────────────────
  const totalDuration  = entries.reduce((s, r) => s + (r.duration || 0), 0);
  const withAI         = entries.filter(r => r.aiSummary).length;
  const allTasks = await getAllTasks().catch(() => []);
  const withTasks = new Set(allTasks.map(t => t._contentId)).size;

  const typeCounts = {};
  for (const r of entries) {
    const t = r.type || 'screen';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];

  // ── Quality trend (last 10 scored entries, chronological) ─────────────
  const scored = entries
    .filter(r => r.analytics?.score?.score != null)
    .slice(0, 10)
    .reverse();

  // ── Filler word aggregate ─────────────────────────────────────────────────
  const fillerTotals = {};
  for (const r of entries) {
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
  const decisions = allTasks
    .filter(t => t.action === 'LOG_DECISION')
    .map(t => ({ task: t, entry: entries.find(r => r.id === t._contentId) || { date: t.createdAt, title: 'Untitled' } }))
    .sort((a, b) => new Date(b.entry.date) - new Date(a.entry.date));

  // ── Storage health ────────────────────────────────────────────────────────
  const storageEst = await navigator.storage?.estimate().catch(() => null);
  const OLD_THRESHOLD = 30 * 24 * 3600 * 1000;
  const oldEntries = entries.filter(r => Date.now() - new Date(r.date).getTime() > OLD_THRESHOLD);
  const oldBlobMb = Math.round(oldEntries.reduce((s, r) => s + (r.size || 0), 0) / 1024 / 1024);
  const usedMb  = storageEst ? Math.round(storageEst.usage  / 1024 / 1024) : null;
  const quotaGb = storageEst ? (storageEst.quota / 1024 / 1024 / 1024).toFixed(1) : null;
  const usedPct = storageEst ? Math.min(100, Math.round((storageEst.usage / storageEst.quota) * 100)) : 0;

  // ── Render ────────────────────────────────────────────────────────────────
  container.innerHTML = `
    <div class="animate-in" style="display:flex;flex-direction:column;gap:var(--space-4);">

      <!-- Today card (Knowledge OS) -->
      ${await _renderTodayCard(entries)}

      <!-- Weekly digest -->
      ${weeklyDigest(entries, {
        openTasks: allTasks.filter(t => (t.status || 'pending') === 'pending').length,
        decisionCount: decisions.length,
      })}

      <!-- Activity heatmap -->
      ${activityHeatmap(entries)}

      <!-- Stats strip -->
      <div class="card card-compact">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-3);text-align:center;">
          ${statCell(icons.video(16), entries.length, 'Entries')}
          ${statCell(icons.clock(16), formatDuration(totalDuration), 'Recorded')}
          ${statCell(icons.zap(16), withAI, 'AI Processed')}
          ${statCell(icons.checkSquare(16), withTasks, 'With Tasks')}
        </div>
      </div>

      <!-- Quality trend + top type -->
      <div style="display:grid;grid-template-columns:1fr auto;gap:var(--space-4);align-items:start;">

        <!-- Sparkline -->
        ${scored.length >= 2 ? `
          <div class="card card-compact">
            <div class="flex-between" style="margin-bottom:var(--space-3);">
              <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);">${icons.trendingUp(12)} Quality Trend${avgQuality != null ? ` — avg <strong style="color:${qualColor(avgQuality)}">${avgQuality}</strong>` : ''}</span>
              <span style="font-size:10px;color:var(--color-text-disabled);">last ${scored.length}</span>
            </div>
            ${sparkline(scored.map(r => r.analytics.score.score))}
            <div style="display:flex;justify-content:space-between;margin-top:4px;">
              ${scored.map(r => `<span style="font-size:9px;color:var(--color-text-disabled);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:48px;" title="${esc(r.title || '')}">${esc(shortDate(r.date))}</span>`).join('')}
            </div>
          </div>` : `<div></div>`}

        <!-- Top type + filler badge -->
        <div style="display:flex;flex-direction:column;gap:var(--space-3);">
          ${topType ? `
            <div class="card card-compact" style="text-align:center;min-width:110px;">
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-bottom:4px;">Top type</div>
              <div style="font-weight:var(--weight-semi);color:${typeAccent(topType[0])};font-size:var(--font-sm);">${typeLabel(topType[0])}</div>
              <div style="font-size:10px;color:var(--color-text-disabled);">${topType[1]} of ${entries.length}</div>
            </div>` : ''}
          ${avgQuality != null ? `
            <div class="card card-compact" style="text-align:center;">
              <div style="font-size:var(--font-xs);color:var(--color-text-muted);margin-bottom:4px;">${icons.shield(12)} Avg quality</div>
              <div style="font-weight:var(--weight-bold);font-size:20px;color:${qualColor(avgQuality)};">${avgQuality}</div>
            </div>` : ''}
        </div>
      </div>

      <!-- Type breakdown donut -->
      ${typePieDonut(typeCounts, entries.length)}

      <!-- Task completion -->
      ${_taskCompletionCard(allTasks)}

      <!-- Filler word leaderboard -->
      ${topFillers.length ? `
        <div class="card card-compact">
          <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);margin-bottom:var(--space-3);">${icons.alertTriangle(12)} Filler Words (all entries)</div>
          <div style="display:flex;flex-direction:column;gap:var(--space-2);">
            ${topFillers.map(([label, count], i) => fillerBar(label, count, topFillers[0][1], i)).join('')}
          </div>
        </div>` : ''}

      <!-- Decision ledger -->
      ${decisions.length ? (() => {
        const conflictSet = detectConflicts(decisions);
        const conflictCount = conflictSet.size;
        return `
        <div class="card card-compact">
          <div class="flex-between" style="margin-bottom:var(--space-3);">
            <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);">${icons.bookOpen(12)} Decision Ledger</span>
            <div style="display:flex;align-items:center;gap:var(--space-2);">
              ${conflictCount > 0 ? `<span class="conflict-badge" title="${conflictCount} decision${conflictCount !== 1 ? 's' : ''} may overlap with another — review for conflicts">${icons.alertCircle(10)} ${conflictCount} to review</span>` : ''}
              <span class="badge badge-neutral">${decisions.length}</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:var(--space-2);max-height:320px;overflow-y:auto;">
            ${decisions.slice(0, 20).map(({ task, entry }, idx) => decisionRow(task, entry, conflictSet.has(idx))).join('')}
          </div>
          ${decisions.length > 20 ? `<p style="font-size:var(--font-xs);color:var(--color-text-disabled);margin-top:var(--space-2);text-align:center;">+ ${decisions.length - 20} more decisions</p>` : ''}
        </div>`;
      })() : `
        <div class="card card-compact" style="text-align:center;padding:var(--space-6);">
          <p style="font-size:var(--font-xs);color:var(--color-text-disabled);">No logged decisions yet. Ask AI to extract decisions during meeting entries.</p>
        </div>`}

      <!-- Storage health -->
      <div class="card card-compact">
        <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);margin-bottom:var(--space-3);">${icons.hardDrive(12)} Storage Health</div>
        ${usedMb != null ? `
          <div style="margin-bottom:var(--space-3);">
            <div style="display:flex;justify-content:space-between;font-size:var(--font-xs);color:var(--color-text-muted);margin-bottom:6px;">
              <span>IndexedDB used</span>
              <span>${usedMb} MB${quotaGb ? ` / ${quotaGb} GB` : ''}</span>
            </div>
            <div style="height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
              <div style="width:${usedPct}%;height:100%;background:${usedPct > 80 ? 'var(--color-danger)' : 'var(--color-primary-light)'};border-radius:2px;transition:width 0.4s;"></div>
            </div>
          </div>` : ''}
        ${oldEntries.length ? `
          <div class="flex-between gap-2">
            <span style="font-size:var(--font-xs);color:var(--color-text-muted);">${oldEntries.length} video${oldEntries.length !== 1 ? 's' : ''} older than 30 days${oldBlobMb > 0 ? ` (~${oldBlobMb} MB)` : ''}</span>
            <button id="ins-cleanup-btn" class="btn btn-ghost btn-sm" style="font-size:var(--font-xs);flex-shrink:0;">${icons.trash(11)} Free space</button>
          </div>` : `
          <p style="font-size:var(--font-xs);color:var(--color-text-disabled);">No entries older than 30 days.</p>`}
      </div>

      <!-- Archive statistics -->
      ${await archiveStatsCard()}

      <!-- Platform Health -->
      ${await healthCard()}

      <!-- Approval Queue -->
      ${await approvalCard()}

      <!-- Activity Timeline -->
      ${await activityCard()}

      <!-- Wellbeing Dashboard -->
      ${await wellbeingCard(entries, allTasks)}

      <!-- Knowledge Graph -->
      ${await _knowledgeGraphCard(entries)}

    </div>`;

  // Heatmap drill-down — click a day cell to filter History to that date
  container.querySelector('.heatmap-svg')?.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-date]');
    if (!cell?.dataset?.date) return;
    document.dispatchEvent(new CustomEvent(DATE_FILTER, { detail: { date: cell.dataset.date } }));
  });

  // Weekly digest rows → open entry in detail view
  container.querySelectorAll('.ins-digest-row').forEach(row => {
    row.addEventListener('click', () => {
      const entry = entries.find(r => r.id === row.dataset.recId);
      if (entry) document.dispatchEvent(new CustomEvent(OPEN_ENTRY, { detail: { entry } }));
    });
  });

  // Storage cleanup button
  container.querySelector('#ins-cleanup-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner" style="width:10px;height:10px;border-width:2px;"></div> Cleaning…`;
    try {
      await Promise.all(oldEntries.map(r => deleteMediaBlob(r.id).catch(() => {})));
      toast.success('Storage freed', `Removed local videos for ${oldEntries.length} old entry${oldEntries.length !== 1 ? 's' : ''}`);
      renderInsightsPanel(container);
    } catch (err) {
      toast.error('Cleanup failed', err.message);
      btn.disabled = false;
    }
  });
}


// ── Task completion card ──────────────────────────────────────────

const ACTION_DISPLAY = {
  CREATE_BUG_REPORT:     'Bug Reports',
  LOG_DECISION:          'Decisions',
  DRAFT_SHARE_MESSAGE:   'Messages',
  UPDATE_TICKET:         'Tickets',
  DRAFT_SLACK_MESSAGE:   'Slack',
  CREATE_CALENDAR_EVENT: 'Calendar',
  DRAFT_EMAIL:           'Emails',
  UPLOAD_TO_DRIVE:       'Drive Uploads',
  TAKUS_TASK:            'Tasks',
  PERSONAL:              'Personal',
};

function _taskCompletionCard(allTasks) {
  const m = computeTaskMetrics(allTasks);
  if (m.total === 0) return '';

  const rateColor = m.completionRate >= 80 ? 'var(--color-success)' :
                    m.completionRate >= 50 ? '#f59e0b' : '#ef4444';

  // Action breakdown bars (top 4)
  const topActions = Object.entries(m.actionBreakdown)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 4);

  const actionBars = topActions.map(([action, counts]) => {
    const pct = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
    const label = ACTION_DISPLAY[action] || action;
    return `
      <div style="display:flex;align-items:center;gap:8px;font-size:10px;">
        <span style="width:70px;color:var(--color-text-muted);text-align:right;">${esc(label)}</span>
        <div style="flex:1;height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:var(--color-accent-gradient);border-radius:3px;"></div>
        </div>
        <span style="width:32px;color:var(--color-text-disabled);text-align:right;">${pct}%</span>
      </div>`;
  }).join('');

  return `
    <div class="card card-compact">
      <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);margin-bottom:var(--space-3);">${icons.checkSquare(12)} Task Completion</div>

      <div style="display:flex;gap:var(--space-4);align-items:center;margin-bottom:var(--space-3);flex-wrap:wrap;">
        <!-- Rate -->
        <div style="text-align:center;">
          <div style="font-size:var(--font-2xl);font-weight:var(--weight-bold);color:${rateColor};">${m.completionRate}%</div>
          <div style="font-size:10px;color:var(--color-text-disabled);">completion rate</div>
        </div>

        <!-- Counts -->
        <div style="display:flex;gap:var(--space-3);flex:1;justify-content:center;">
          <div style="text-align:center;">
            <div style="font-size:var(--font-lg);font-weight:var(--weight-semi);color:var(--color-text-primary);">${m.done}</div>
            <div style="font-size:9px;color:var(--color-success);">done</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:var(--font-lg);font-weight:var(--weight-semi);color:var(--color-text-primary);">${m.ignored}</div>
            <div style="font-size:9px;color:var(--color-warning);">ignored</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:var(--font-lg);font-weight:var(--weight-semi);color:var(--color-text-primary);">${m.pending}</div>
            <div style="font-size:9px;color:var(--color-text-muted);">pending</div>
          </div>
        </div>

        ${m.avgTimeToDone !== null ? `
        <div style="text-align:center;">
          <div style="font-size:var(--font-lg);font-weight:var(--weight-semi);color:var(--color-text-primary);">${m.avgTimeToDone}h</div>
          <div style="font-size:9px;color:var(--color-text-disabled);">avg resolve</div>
        </div>` : ''}
      </div>

      <!-- Progress -->
      <div class="task-progress-bar" style="margin-bottom:var(--space-3);">
        <div class="task-progress-fill" style="width:${m.completionRate}%;"></div>
      </div>

      ${topActions.length ? `
      <div style="font-size:9px;color:var(--color-text-disabled);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:var(--space-2);">By Action Type</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${actionBars}</div>` : ''}

      ${m.totalSteps > 0 ? `
      <div style="border-top:1px solid rgba(255,255,255,0.06);margin-top:var(--space-3);padding-top:var(--space-2);">
        <div style="display:flex;align-items:center;gap:var(--space-3);font-size:10px;">
          <span style="color:var(--color-text-disabled);">Step Progress</span>
          <div style="flex:1;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
            <div style="width:${m.stepRate}%;height:100%;background:var(--color-success);border-radius:2px;"></div>
          </div>
          <span style="color:var(--color-text-muted);">${m.doneSteps}/${m.totalSteps} (${m.stepRate}%)</span>
        </div>
        ${m.objectiveCount > 0 ? `
        <div style="display:flex;align-items:center;gap:var(--space-2);font-size:10px;margin-top:4px;">
          <span style="color:var(--color-primary-light);">⦿</span>
          <span style="color:var(--color-text-disabled);">${m.objectivesCompleted} of ${m.objectiveCount} objectives completed</span>
        </div>` : ''}
      </div>` : ''}
    </div>`;
}

// ── Today Card (Knowledge OS: Intelligence Layer) ─────────────────────────────

async function _renderTodayCard(entries) {
  try {
    const calendarEvents = getLatestEvents();
    const digest = await generateDailyDigest(calendarEvents, { entries });

    const parts = [];

    // ── Header ───────────────────────────────────────────────────────────────
    const streakHtml = digest.streak > 1
      ? `<span class="flex-center gap-1" style="font-size:10px;color:var(--color-warning);font-weight:var(--weight-semi);">🔥 ${digest.streak}-day streak</span>`
      : '';

    parts.push(`
      <div class="card card-compact" style="border-left:3px solid var(--color-primary);position:relative;overflow:visible;">
        <div class="flex-between" style="margin-bottom:var(--space-2);">
          <span class="flex-center gap-2" style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-primary-light);">
            ${icons.zap(12)} Right Now
          </span>
          <div class="flex-center gap-3">
            ${streakHtml}
            <span style="font-size:10px;color:var(--color-text-disabled);">${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          </div>
        </div>`);

    // ── Pending Actions ──────────────────────────────────────────────────────
    if (digest.overdueTasks.length > 0 || digest.todayTasks.length > 0) {
      const overdueCount = digest.overdueTasks.length;
      const todayCount = digest.todayTasks.length;
      const allActions = [...digest.overdueTasks, ...digest.todayTasks].slice(0, 4);

      parts.push(`
        <div style="background:rgba(239,68,68,0.06);border-radius:var(--radius-md);padding:var(--space-2) var(--space-3);margin-bottom:var(--space-2);">
          <div class="flex-center gap-1" style="font-size:10px;font-weight:var(--weight-semi);color:var(--color-danger);margin-bottom:4px;">
            ${icons.alertCircle(10)}
            ${overdueCount > 0 ? `${overdueCount} overdue` : ''}${overdueCount && todayCount ? ' · ' : ''}${todayCount > 0 ? `${todayCount} due today` : ''}
          </div>
          ${allActions.map(t => `
            <div class="flex-center gap-2" style="font-size:11px;color:var(--color-text-secondary);padding:2px 0;">
              <span style="color:${t.deadline < Date.now() ? 'var(--color-danger)' : 'var(--color-warning)'};font-size:9px;">●</span>
              <span class="truncate">${esc(t.text)}</span>
            </div>
          `).join('')}
        </div>`);
    }

    // ── Task Completion Rate ─────────────────────────────────────────────────
    if (digest.taskMetrics.total > 0) {
      const rate = digest.taskMetrics.completionRate;
      const rateColor = rate >= 70 ? 'var(--color-success)' : rate >= 40 ? 'var(--color-warning)' : 'var(--color-danger)';
      parts.push(`
        <div class="flex-center gap-2" style="font-size:10px;color:var(--color-text-disabled);margin-bottom:var(--space-1);">
          ${icons.checkSquare(10)}
          <span>Tasks: <strong style="color:${rateColor}">${rate}%</strong> completed (${digest.taskMetrics.done}/${digest.taskMetrics.total})</span>
        </div>`);
    }

    // ── Week Stats ───────────────────────────────────────────────────────────
    if (digest.weekStats.entries > 0) {
      parts.push(`
        <div class="flex-center gap-3" style="font-size:10px;color:var(--color-text-disabled);">
          <span>${digest.weekStats.entries} entry${digest.weekStats.entries !== 1 ? 's' : ''} this week</span>
          <span>${formatDuration(digest.weekStats.totalDuration)}</span>
          ${digest.weekStats.withAI > 0 ? `<span>${digest.weekStats.withAI} AI-processed</span>` : ''}
        </div>`);
    }

    parts.push('</div>'); // Close main card

    // ── Blind Spots Card ─────────────────────────────────────────────────────
    if (await isEnabled('blindSpots')) {
      try {
        const [signals, contacts] = await Promise.all([
          getSignals().catch(() => []),
          getContacts().catch(() => []),
        ]);
        const spots = detectBlindSpots(entries, signals, contacts);
        if (spots.length > 0) {
          const severityIcon = (s) => s === 'warning' ? icons.alertTriangle(10) : icons.info(10);
          const severityColor = (s) => s === 'warning' ? 'var(--color-warning)' : 'var(--color-info, var(--color-primary-light))';
          parts.push(`
            <div class="card card-compact" style="border-left:3px solid var(--color-warning);">
              <div class="flex-center gap-2" style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-warning);margin-bottom:var(--space-2);">
                ${icons.eye(12)} Blind Spots
              </div>
              ${spots.slice(0, 3).map(spot => `
                <div class="flex-center gap-2" style="font-size:11px;color:var(--color-text-secondary);padding:3px 0;">
                  <span style="color:${severityColor(spot.severity)};flex-shrink:0;">${severityIcon(spot.severity)}</span>
                  <span>${esc(spot.message)}</span>
                </div>
              `).join('')}
              <div style="font-size:9px;color:var(--color-text-disabled);margin-top:var(--space-1);">
                Based on your usage patterns · Disable in Settings → Labs
              </div>
            </div>`);
        }
      } catch { /* blind spot detection is non-critical */ }
    }

    // ── Proactive Meeting Prep Cards ─────────────────────────────────────────
    try {
      const upcomingEvents = getLatestEvents();
      if (upcomingEvents.length > 0) {
        const { shouldShowMeetingPrep, generateMeetingPrep } = await import('../lib/meeting-prep.js');
        const now = Date.now();
        // Show prep for meetings starting within the next 2 hours
        const upcoming = upcomingEvents
          .filter(ev => {
            const start = new Date(ev.start).getTime();
            return start > now && start - now < 2 * 60 * 60 * 1000 && !ev.isAllDay;
          })
          .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
          .slice(0, 2);

        for (const ev of upcoming) {
          if (!shouldShowMeetingPrep(ev)) continue;
          try {
            const prep = await generateMeetingPrep(ev);
            const startTime = new Date(ev.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
            const hasPrev = prep.previousMeetings.length > 0;
            const hasOpen = prep.openTasks.length > 0;
            const hasDecisions = prep.keyDecisions.length > 0;

            if (hasPrev || hasOpen || hasDecisions) {
              parts.push(`
                <div class="card card-compact" style="border-left:3px solid var(--color-success);">
                  <div class="flex-center gap-2" style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-success);margin-bottom:var(--space-2);">
                    ${icons.calendar(12)} Meeting Prep · ${esc(ev.title || 'Untitled')} at ${esc(startTime)}
                  </div>
                  ${hasPrev ? `<div style="font-size:11px;color:var(--color-text-secondary);padding:2px 0;">
                    ${icons.video(10)} ${prep.previousMeetings.length} previous meeting${prep.previousMeetings.length > 1 ? 's' : ''} with these participants
                  </div>` : ''}
                  ${hasOpen ? `<div style="font-size:11px;color:var(--color-text-secondary);padding:2px 0;">
                    ${icons.checkSquare(10)} ${prep.openTasks.length} open task${prep.openTasks.length > 1 ? 's' : ''} from past meetings
                  </div>` : ''}
                  ${hasDecisions ? `<div style="font-size:11px;color:var(--color-text-secondary);padding:2px 0;">
                    ${icons.zap(10)} ${prep.keyDecisions.length} key decision${prep.keyDecisions.length > 1 ? 's' : ''} to review
                  </div>` : ''}
                  <div style="font-size:9px;color:var(--color-text-disabled);margin-top:var(--space-1);">
                    Based on your entry history with ${ev.attendeeCount || ev.attendees?.length || 0} attendee${(ev.attendeeCount || ev.attendees?.length || 0) !== 1 ? 's' : ''}
                  </div>
                </div>`);
            }
          } catch { /* individual prep failure is non-critical */ }
        }
      }
    } catch { /* meeting prep is non-critical */ }

    // ── Knowledge Health Card ───────────────────────────────────────────────
    try {
      const { classifySummaryInsights, computeAssumptionRisk } = await import('../lib/knowledge-framework.js');
      const aiEntries = entries.filter(r => r.aiSummary);
      if (aiEntries.length > 0) {
        // Classify insights from the most recent summaries
        const allInsights = [];
        for (const r of aiEntries.slice(0, 5)) {
          allInsights.push(...classifySummaryInsights(r.aiSummary, r.id));
        }
        if (allInsights.length >= 3) {
          const risk = computeAssumptionRisk(allInsights);
          const facts = allInsights.filter(i => i.type === 'fact').length;
          const decisions = allInsights.filter(i => i.type === 'decision').length;
          const assumptions = allInsights.filter(i => i.type === 'assumption').length;
          const questions = allInsights.filter(i => i.type === 'open_question').length;

          const riskColor = risk.riskLevel === 'high' ? 'var(--color-danger)'
            : risk.riskLevel === 'medium' ? 'var(--color-warning)' : 'var(--color-success)';

          parts.push(`
            <div class="card card-compact" style="border-left:3px solid ${riskColor};">
              <div class="flex-center gap-2" style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:${riskColor};margin-bottom:var(--space-2);">
                ${icons.barChart(12)} Knowledge Health
              </div>
              <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-2);margin-bottom:var(--space-2);">
                <div style="text-align:center;">
                  <div style="font-size:16px;font-weight:var(--weight-bold);color:var(--color-success);">${facts}</div>
                  <div style="font-size:9px;color:var(--color-text-disabled);">Facts</div>
                </div>
                <div style="text-align:center;">
                  <div style="font-size:16px;font-weight:var(--weight-bold);color:var(--color-primary-light);">${decisions}</div>
                  <div style="font-size:9px;color:var(--color-text-disabled);">Decisions</div>
                </div>
                <div style="text-align:center;">
                  <div style="font-size:16px;font-weight:var(--weight-bold);color:var(--color-warning);">${assumptions}</div>
                  <div style="font-size:9px;color:var(--color-text-disabled);">Assumed</div>
                </div>
                <div style="text-align:center;">
                  <div style="font-size:16px;font-weight:var(--weight-bold);color:var(--color-text-muted);">${questions}</div>
                  <div style="font-size:9px;color:var(--color-text-disabled);">Open</div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:var(--space-2);">
                <div style="flex:1;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
                  <div style="height:100%;width:${Math.min(100, risk.score)}%;background:${riskColor};border-radius:2px;transition:width 0.3s;"></div>
                </div>
                <span style="font-size:10px;color:${riskColor};font-weight:var(--weight-semi);min-width:50px;text-align:right;">${risk.riskLevel} risk</span>
              </div>
              <div style="font-size:9px;color:var(--color-text-disabled);margin-top:var(--space-1);">
                From your last ${Math.min(aiEntries.length, 5)} AI-processed entry${aiEntries.length > 1 ? 's' : ''}
              </div>
            </div>`);
        }
      }
    } catch { /* knowledge framework is non-critical */ }

    const recentAI = entries.filter(r => r.aiSummary).slice(0, 3);
    if (recentAI.length > 0) {
      const insightItems = [];

      // Task completion trend
      const taskCount = allTasks.length;
      if (taskCount >= 3) {
        const completedCount = allTasks.filter(t => t.status === 'done').length;
        if (taskCount > 0) {
          const pct = Math.round((completedCount / taskCount) * 100);
          insightItems.push(`${pct}% task follow-through across ${taskCount} tasks`);
        }
      }

      // Most active content type
      const recentTypes = {};
      for (const r of entries.slice(0, 20)) {
        const t = r.type || 'screen';
        recentTypes[t] = (recentTypes[t] || 0) + 1;
      }
      const topRecent = Object.entries(recentTypes).sort((a, b) => b[1] - a[1])[0];
      if (topRecent && topRecent[1] >= 3) {
        insightItems.push(`${topRecent[1]} of your last 20 entries are ${typeLabel(topRecent[0]).toLowerCase()}s`);
      }

      if (insightItems.length > 0) {
        parts.push(`
          <div class="card card-compact" style="border-left:3px solid var(--color-info);">
            <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-info);margin-bottom:var(--space-2);">
              ${icons.trendingUp(11)} Patterns
            </div>
            ${insightItems.map(item => `
              <div style="font-size:11px;color:var(--color-text-secondary);padding:2px 0;display:flex;gap:6px;">
                <span style="color:var(--color-info);flex-shrink:0;">→</span>
                <span>${item}</span>
              </div>
            `).join('')}
          </div>`);
      }
    }

    // ── Connection Nudges ────────────────────────────────────────────────────
    try {
      const { getContacts, getAllInteractions } = await import('../lib/storage.js');
      const [contacts, interactions] = await Promise.all([getContacts(), getAllInteractions()]);
      const twoWeeksAgo = Date.now() - (14 * MS_PER_DAY);

      const staleContacts = contacts
        .filter(c => {
          if (!c.closenessScore || c.closenessScore < 30) return false; // Only nudge for close contacts
          const contactInteractions = interactions.filter(i => i.contactId === c.id);
          const lastInteraction = contactInteractions.length > 0
            ? Math.max(...contactInteractions.map(i => i.timestamp || 0))
            : 0;
          return lastInteraction > 0 && lastInteraction < twoWeeksAgo;
        })
        .sort((a, b) => (b.closenessScore || 0) - (a.closenessScore || 0))
        .slice(0, 3);

      if (staleContacts.length > 0) {
        parts.push(`
          <div class="card card-compact" style="border-left:3px solid var(--color-warning);">
            <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-warning);margin-bottom:var(--space-2);">
              ${icons.users(11)} Reconnect
            </div>
            ${staleContacts.map(c => {
              const name = c.name || c.email || 'Unknown';
              const daysSince = Math.round((Date.now() - (c.lastInteractionDate || 0)) / MS_PER_DAY);
              return `
                <div style="font-size:11px;color:var(--color-text-secondary);padding:3px 0;display:flex;align-items:center;gap:6px;">
                  <span style="width:20px;height:20px;border-radius:50%;background:rgba(245,158,11,0.15);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:var(--weight-bold);color:var(--color-warning);flex-shrink:0;">${name.charAt(0).toUpperCase()}</span>
                  <span class="truncate">${esc(name)}</span>
                  <span style="color:var(--color-text-disabled);font-size:10px;flex-shrink:0;margin-left:auto;">${daysSince > 0 ? `${daysSince}d ago` : ''}</span>
                </div>`;
            }).join('')}
          </div>`);
      }
    } catch { /* contacts unavailable — skip nudges */ }

    // ── Autonomy Status ──────────────────────────────────────────────────────
    try {
      const { isAutonomyRunning, getAutonomyStats } = await import('../lib/autonomy-engine.js');
      if (isAutonomyRunning()) {
        const stats = getAutonomyStats();
        const hasWork = stats.embeddings > 0 || stats.similarity > 0 || stats.closeness > 0 || stats.knowledgeLevels > 0;
        if (hasWork) {
          const statusParts = [];
          if (stats.embeddings > 0) statusParts.push(`${stats.embeddings} embedded`);
          if (stats.similarity > 0) statusParts.push(`${stats.similarity} similarity edges`);
          if (stats.closeness > 0) statusParts.push(`${stats.closeness} scores recomputed`);
          if (stats.knowledgeLevels > 0) statusParts.push(`${stats.knowledgeLevels} levels updated`);
          parts.push(`
            <div style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--color-text-disabled);padding:0 var(--space-1);">
              <span style="width:6px;height:6px;border-radius:50%;background:var(--color-success);animation:pulse 2s infinite;"></span>
              Autonomy active — ${statusParts.join(', ')}
            </div>`);
        }
      }
    } catch {}

    return parts.join('');
  } catch {
    return ''; // Graceful degradation — don't break the panel
  }
}


/**
 * Render a Knowledge Graph stats card.
 * Queries edges for all entries and shows edge type distribution.
 */
async function _knowledgeGraphCard(entries) {
  try {
    // Collect edges for all entries (limit to first 50 to avoid perf hit)
    const edgesByType = {};
    const uniqueTargets = new Set();
    let totalEdges = 0;

    for (const r of entries.slice(0, 50)) {
      const edges = await getEdgesForNode('entry', r.id).catch(() => []);
      for (const e of edges) {
        edgesByType[e.edgeType] = (edgesByType[e.edgeType] || 0) + 1;
        uniqueTargets.add(`${e.targetType}:${e.targetId}`);
        totalEdges++;
      }
    }

    if (totalEdges === 0) {
      return `
        <div class="card card-compact" style="text-align:center;padding:var(--space-4);">
          <div style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);margin-bottom:var(--space-2);">${icons.link(12)} Knowledge Graph</div>
          <p style="font-size:var(--font-xs);color:var(--color-text-disabled);">
            No connections yet. Edges are created automatically when AI processes entries with participants or tasks.
          </p>
        </div>`;
    }

    const typeEntries = Object.entries(edgesByType)
      .sort((a, b) => b[1] - a[1]);

    const maxCount = typeEntries[0]?.[1] || 1;

    return `
      <div class="card card-compact">
        <div class="flex-between" style="margin-bottom:var(--space-3);">
          <span style="font-size:var(--font-xs);font-weight:var(--weight-semi);color:var(--color-text-secondary);">${icons.link(12)} Knowledge Graph</span>
          <div style="display:flex;gap:var(--space-3);font-size:10px;color:var(--color-text-disabled);">
            <span>${totalEdges} edges</span>
            <span>${uniqueTargets.size} nodes</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:var(--space-2);">
          ${typeEntries.map(([type, count]) => {
            const cfg = getEdgeTypeConfig(type);
            const pct = Math.round((count / maxCount) * 100);
            return `
              <div style="display:flex;align-items:center;gap:8px;font-size:var(--font-xs);">
                <span style="flex-shrink:0;width:14px;text-align:center;">${cfg.icon}</span>
                <span style="color:var(--color-text-secondary);min-width:80px;">${cfg.label}</span>
                <div style="flex:1;height:6px;background:rgba(255,255,255,0.04);border-radius:3px;overflow:hidden;">
                  <div style="width:${pct}%;height:100%;background:${cfg.color};border-radius:3px;transition:width 0.4s;"></div>
                </div>
                <span style="color:var(--color-text-disabled);font-size:10px;min-width:24px;text-align:right;">${count}</span>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  } catch {
    return '';
  }
}
