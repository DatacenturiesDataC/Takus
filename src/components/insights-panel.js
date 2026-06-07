
// Pure browser computation on existing IndexedDB data. Zero network cost.
// Decomposed: rendering helpers in ./insights-cards/ submodules.

import { getEntries, deleteMediaBlob, getContacts } from '../lib/storage.js';
import { icons } from '../lib/icons.js';
import { esc, shortDate, MS_PER_DAY } from '../lib/utils.js';
import { OPEN_ENTRY, DATE_FILTER, NAVIGATE } from '../lib/events.js';
import { formatDuration } from '../lib/recorder.js';
import { typeLabel, typeAccent } from '../lib/content-types.js';
import { toast } from './toast.js';
import { computeTaskMetrics } from '../lib/analytics.js';
import { generateDailyDigest } from '../lib/daily-digest.js';
import { getEdgeTypeConfig } from '../lib/edge-types.js';
import { detectBlindSpots } from '../lib/blind-spot-detector.js';
import { getSignals } from '../lib/preference-engine.js';
import { getAppSettings } from '../lib/app-manager.js';
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
      <div class="card card-compact animate-in pad-card" >
        <div class="empty-state">
          ${icons.barChart(32)}
          <p class="mt-2">No insights yet</p>
          <p class="ins-muted-label mx-auto max-w-280">
            Insights emerge after your first entry. You'll see quality trends, filler word analysis, weekly digests, and knowledge patterns.
          </p>
          <button id="ins-start-btn" class="btn btn-outline mt-3 gap-1">${icons.mic(12)} Create your first entry</button>
        </div>
      </div>`;
    container.querySelector('#ins-start-btn')?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent(NAVIGATE, { detail: { tab: 'home' } }));
    });
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
    <div class="animate-in rd-col-stack gap-4">

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
        <div class="ins-stat-grid">
          ${statCell(icons.video(16), entries.length, 'Entries')}
          ${statCell(icons.clock(16), formatDuration(totalDuration), 'Recorded')}
          ${statCell(icons.zap(16), withAI, 'AI Processed')}
          ${statCell(icons.checkSquare(16), withTasks, 'With Tasks')}
        </div>
      </div>

      <!-- Quality trend + top type -->
      <div class="ins-two-col">

        <!-- Sparkline -->
        ${scored.length >= 2 ? `
          <div class="card card-compact">
            <div class="flex-between mb-3" >
              <span class="ins-section-title">${icons.trendingUp(12)} Quality Trend${avgQuality != null ? ` — avg <strong style="color:${qualColor(avgQuality)}">${avgQuality}</strong>` : ''}</span>
              <span class="ins-muted-label">last ${scored.length}</span>
            </div>
            ${sparkline(scored.map(r => r.analytics.score.score))}
            <div class="ins-sparkline-dates">
              ${scored.map(r => `<span class="ins-sparkline-date" title="${esc(r.title || '')}">${esc(shortDate(r.date))}</span>`).join('')}
            </div>
          </div>` : `<div></div>`}

        <!-- Top type + filler badge -->
        <div class="rd-col-stack">
          ${topType ? `
            <div class="card card-compact text-center ins-min-w-110">
              <div class="ins-muted-label mb-1">Top type</div>
              <div class="font-semi text-sm" style="color:${typeAccent(topType[0])};">${typeLabel(topType[0])}</div>
              <div class="ins-muted-label">${topType[1]} of ${entries.length}</div>
            </div>` : ''}
          ${avgQuality != null ? `
            <div class="card card-compact text-center">
              <div class="ins-muted-label mb-1">${icons.shield(12)} Avg quality</div>
              <div class="font-bold" style="font-size:var(--text-xl);color:${qualColor(avgQuality)};">${avgQuality}</div>
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
          <div class="ins-section-title">${icons.alertTriangle(12)} Filler Words (all entries)</div>
          <div class="rd-col-stack">
            ${topFillers.map(([label, count], i) => fillerBar(label, count, topFillers[0][1], i)).join('')}
          </div>
        </div>` : ''}

      <!-- Decision ledger -->
      ${decisions.length ? (() => {
        const conflictSet = detectConflicts(decisions);
        const conflictCount = conflictSet.size;
        return `
        <div class="card card-compact">
          <div class="flex-between mb-3" >
            <span class="ins-section-title">${icons.bookOpen(12)} Decision Ledger</span>
            <div class="flex-center gap-2">
              ${conflictCount > 0 ? `<span class="conflict-badge" title="${conflictCount} decision${conflictCount !== 1 ? 's' : ''} may overlap with another — review for conflicts">${icons.alertCircle(10)} ${conflictCount} to review</span>` : ''}
              <span class="badge badge-neutral">${decisions.length}</span>
            </div>
          </div>
          <div class="rd-col-stack ins-scroll-list">
            ${decisions.slice(0, 20).map(({ task, entry }, idx) => decisionRow(task, entry, conflictSet.has(idx))).join('')}
          </div>
          ${decisions.length > 20 ? `<p class="ins-more-text">+ ${decisions.length - 20} more decisions</p>` : ''}
        </div>`;
      })() : `
        <div class="card card-compact text-center ins-empty-pad">
          <p class="ins-muted-label">No logged decisions yet. Ask AI to extract decisions during meeting entries.</p>
        </div>`}

      <!-- Storage health -->
      <div class="card card-compact">
        <div class="ins-section-title">${icons.hardDrive(12)} Storage Health</div>
        ${usedMb != null ? `
          <div class="mb-3">
            <div class="gt-progress-labels ins-storage-labels">
              <span>IndexedDB used</span>
              <span>${usedMb} MB${quotaGb ? ` / ${quotaGb} GB` : ''}</span>
            </div>
            <div class="ins-progress-track">
              <div class="ins-progress-bar-fill-animated" style="width:${usedPct}%;background:${usedPct > 80 ? 'var(--color-danger)' : 'var(--accent-hover)'};"></div>
            </div>
          </div>` : ''}
        ${oldEntries.length ? `
          <div class="flex-between gap-2">
            <span class="text-xs-muted">${oldEntries.length} video${oldEntries.length !== 1 ? 's' : ''} older than 30 days${oldBlobMb > 0 ? ` (~${oldBlobMb} MB)` : ''}</span>
            <button id="ins-cleanup-btn" class="btn btn-ghost btn-sm ins-cleanup-btn-style">${icons.trash(11)} Free space</button>
          </div>` : `
          <p class="ins-muted-label">No entries older than 30 days.</p>`}
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
    btn.innerHTML = `<div class="spinner spinner-xs" ></div> Cleaning…`;
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
      <div class="ins-check-row gap-2">
        <span class="ins-bar-label ins-bar-label-wide"> ${esc(label)}</span>
        <div class="ins-bar-track">
          <div class="ins-chart-bar" style="width:${pct}%;background:var(--accent-gradient);"></div>
        </div>
        <span class="ins-bar-pct">${pct}%</span>
      </div>`;
  }).join('');

  return `
    <div class="card card-compact">
      <div class="ins-section-title">${icons.checkSquare(12)} Task Completion</div>

      <div class="ins-completion-wrap">
        <!-- Rate -->
        <div class="text-center">
          <div class="font-bold" style="font-size:var(--text-lg);color:${rateColor};">${m.completionRate}%</div>
          <div class="ins-muted-label">completion rate</div>
        </div>

        <!-- Counts -->
        <div class="ins-counts-row">
          <div class="text-center">
            <div class="text-lg-bold">${m.done}</div>
            <div class="ins-9-success">done</div>
          </div>
          <div class="text-center">
            <div class="text-lg-bold">${m.ignored}</div>
            <div class="text-9-warning">ignored</div>
          </div>
          <div class="text-center">
            <div class="text-lg-bold">${m.pending}</div>
            <div class="ins-9-muted">pending</div>
          </div>
        </div>

        ${m.avgTimeToDone !== null ? `
        <div class="text-center">
          <div class="text-lg-bold">${m.avgTimeToDone}h</div>
          <div class="ins-muted-label">avg resolve</div>
        </div>` : ''}
      </div>

      <!-- Progress -->
      <div class="task-progress-bar mb-3" >
        <div class="task-progress-fill" style="width:${m.completionRate}%;"></div>
      </div>

      ${topActions.length ? `
      <div class="hist-related-label mb-2" >By Action Type</div>
      <div class="rd-col-stack">${actionBars}</div>` : ''}

      ${m.totalSteps > 0 ? `
      <div class="ins-step-divider">
        <div class="ins-check-row">
          <span class="text-disabled">Step Progress</span>
          <div class="ins-progress-track flex-1" >
            <div class="ins-progress-bar-fill" style="width:${m.stepRate}%;background:var(--color-success);"></div>
          </div>
          <span class="text-muted">${m.doneSteps}/${m.totalSteps} (${m.stepRate}%)</span>
        </div>
        ${m.objectiveCount > 0 ? `
        <div class="ins-check-row mt-4" >
          <span class="text-primary">⦿</span>
          <span class="text-disabled">${m.objectivesCompleted} of ${m.objectiveCount} objectives completed</span>
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
      ? `<span class="flex-center gap-1 ins-streak-badge">🔥 ${digest.streak}-day streak</span>`
      : '';

    parts.push(`
      <div class="card card-compact ins-border-left-primary relative" style="overflow:visible;">
        <div class="flex-between mb-2" >
          <span class="flex-center gap-2 ins-section-title text-primary"  >
            ${icons.zap(12)} Right Now
          </span>
          <div class="flex-center gap-3">
            ${streakHtml}
            <span class="ins-muted-label">${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          </div>
        </div>`);

    // ── Pending Actions ──────────────────────────────────────────────────────
    if (digest.overdueTasks.length > 0 || digest.todayTasks.length > 0) {
      const overdueCount = digest.overdueTasks.length;
      const todayCount = digest.todayTasks.length;
      const allActions = [...digest.overdueTasks, ...digest.todayTasks].slice(0, 4);

      parts.push(`
        <div class="ins-overdue-box">
          <div class="flex-center gap-1 ins-overdue-heading">
            ${icons.alertCircle(10)}
            ${overdueCount > 0 ? `${overdueCount} overdue` : ''}${overdueCount && todayCount ? ' · ' : ''}${todayCount > 0 ? `${todayCount} due today` : ''}
          </div>
          ${allActions.map(t => `
            <div class="flex-center gap-2 ins-item-row" >
              <span style="color:${t.deadline < Date.now() ? 'var(--color-danger)' : 'var(--color-warning)'};font-size:var(--text-2xs);">●</span>
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
        <div class="flex-center gap-2 ins-task-rate-bar">
          ${icons.checkSquare(10)}
          <span>Tasks: <strong style="color:${rateColor}">${rate}%</strong> completed (${digest.taskMetrics.done}/${digest.taskMetrics.total})</span>
        </div>`);
    }

    // ── Week Stats ───────────────────────────────────────────────────────────
    if (digest.weekStats.entries > 0) {
      parts.push(`
        <div class="flex-center gap-3 ins-muted-label" >
          <span>${digest.weekStats.entries} entry${digest.weekStats.entries !== 1 ? 's' : ''} this week</span>
          <span>${formatDuration(digest.weekStats.totalDuration)}</span>
          ${digest.weekStats.withAI > 0 ? `<span>${digest.weekStats.withAI} AI-processed</span>` : ''}
        </div>`);
    }

    parts.push('</div>'); // Close main card

    // ── Blind Spots Card ─────────────────────────────────────────────────────
    if (getAppSettings('insights').blindSpots !== false) {
      try {
        const [signals, contacts] = await Promise.all([
          getSignals().catch(() => []),
          getContacts().catch(() => []),
        ]);
        const spots = detectBlindSpots(entries, signals, contacts);
        if (spots.length > 0) {
          const severityIcon = (s) => s === 'warning' ? icons.alertTriangle(10) : icons.info(10);
          const severityColor = (s) => s === 'warning' ? 'var(--color-warning)' : 'var(--color-info, var(--accent-hover))';
          parts.push(`
            <div class="card card-compact ins-border-left-warning">
              <div class="flex-center gap-2 ins-section-title text-warning mb-2"  >
                ${icons.eye(12)} Blind Spots
              </div>
              ${spots.slice(0, 3).map(spot => `
                <div class="flex-center gap-2 ins-pattern-row">
                  <span class="ins-pattern-arrow" style="color:${severityColor(spot.severity)};">${severityIcon(spot.severity)}</span>
                  <span>${esc(spot.message)}</span>
                </div>
              `).join('')}
              <div class="ins-muted-label mt-1" >
                Based on your usage patterns · Disable in Settings → Insights
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
                <div class="card card-compact ins-border-left-success">
                  <div class="flex-center gap-2 ins-section-title text-success mb-2">
                    ${icons.calendar(12)} Meeting Prep · ${esc(ev.title || 'Untitled')} at ${esc(startTime)}
                  </div>
                  ${hasPrev ? `<div class="ins-item-row">
                    ${icons.video(10)} ${prep.previousMeetings.length} previous meeting${prep.previousMeetings.length > 1 ? 's' : ''} with these participants
                  </div>` : ''}
                  ${hasOpen ? `<div class="ins-item-row">
                    ${icons.checkSquare(10)} ${prep.openTasks.length} open task${prep.openTasks.length > 1 ? 's' : ''} from past meetings
                  </div>` : ''}
                  ${hasDecisions ? `<div class="ins-item-row">
                    ${icons.zap(10)} ${prep.keyDecisions.length} key decision${prep.keyDecisions.length > 1 ? 's' : ''} to review
                  </div>` : ''}
                  <div class="ins-muted-label mt-1" >
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
              <div class="flex-center gap-2 ins-section-title mb-2" style="color:${riskColor};">
                ${icons.barChart(12)} Knowledge Health
              </div>
              <div class="ins-stat-grid mb-2" >
                <div class="text-center">
                  <div class="ins-big-num text-success" >${facts}</div>
                  <div class="ins-muted-label">Facts</div>
                </div>
                <div class="text-center">
                  <div class="ins-big-num text-primary" >${decisions}</div>
                  <div class="ins-muted-label">Decisions</div>
                </div>
                <div class="text-center">
                  <div class="ins-big-num text-warning" >${assumptions}</div>
                  <div class="ins-muted-label">Assumed</div>
                </div>
                <div class="text-center">
                  <div class="ins-big-num text-muted" >${questions}</div>
                  <div class="ins-muted-label">Open</div>
                </div>
              </div>
              <div class="ins-bar-row">
                <div class="ins-progress-track flex-1" >
                  <div class="ins-progress-bar-fill" style="width:${Math.min(100, risk.score)}%;background:${riskColor};"></div>
                </div>
                <span class="ins-risk-label" style="color:${riskColor};">${risk.riskLevel} risk</span>
              </div>
              <div class="ins-muted-label mt-1" >
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
          <div class="card card-compact ins-border-left-info">
            <div class="ins-section-title text-info mb-2">
              ${icons.trendingUp(11)} Patterns
            </div>
            ${insightItems.map(item => `
              <div class="ins-pattern-row">
                <span class="ins-pattern-arrow text-info">→</span>
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
          <div class="card card-compact ins-border-left-warning">
            <div class="ins-section-title text-warning mb-2" >
              ${icons.users(11)} Reconnect
            </div>
            ${staleContacts.map(c => {
              const name = c.name || c.email || 'Unknown';
              const daysSince = Math.round((Date.now() - (c.lastInteractionDate || 0)) / MS_PER_DAY);
              return `
                <div class="ins-item-row">
                  <span class="ins-avatar-circle">${name.charAt(0).toUpperCase()}</span>
                  <span class="truncate">${esc(name)}</span>
                  <span class="text-10-disabled flex-shrink-0 ml-auto">${daysSince > 0 ? `${daysSince}d ago` : ''}</span>
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
            <div class="ins-autonomy-bar">
              <span class="ins-autonomy-dot"></span>
              Autonomy active — ${statusParts.join(', ')}
            </div>`);
        }
      }
    } catch { /* non-critical */ }

    return parts.join('');
  } catch { /* non-critical */
    return ''; // Graceful degradation — don't break the panel
  }
}


/**
 * Render a Knowledge Graph stats card.
 * Queries all edges and shows type distribution, most connected entry,
 * and knowledge density metrics.
 */
async function _knowledgeGraphCard(entries) {
  try {
    // Use bulk edge query — single IDB transaction instead of N per-entry reads
    const { getAllEdges } = await import('../lib/storage.js');
    const allEdges = await getAllEdges().catch(() => []);

    if (allEdges.length === 0) {
      return `
        <div class="card card-compact text-center p-4">
          <div class="ins-section-title">${icons.link(12)} Knowledge Graph</div>
          <p class="ins-muted-label">
            No connections yet. Edges are created automatically when AI processes entries with participants or tasks.
          </p>
        </div>`;
    }

    // ── Aggregate edge stats ────────────────────────────────────────
    const edgesByType = {};
    const uniqueNodes = new Set();
    const edgesPerEntry = {};   // entryId → count (for density + most-connected)

    for (const e of allEdges) {
      // Type distribution
      edgesByType[e.edgeType] = (edgesByType[e.edgeType] || 0) + 1;

      // Unique nodes
      uniqueNodes.add(`${e.sourceType}:${e.sourceId}`);
      uniqueNodes.add(`${e.targetType}:${e.targetId}`);

      // Per-entry edge count (track entries on either side)
      if (e.sourceType === 'entry') {
        edgesPerEntry[e.sourceId] = (edgesPerEntry[e.sourceId] || 0) + 1;
      }
      if (e.targetType === 'entry') {
        edgesPerEntry[e.targetId] = (edgesPerEntry[e.targetId] || 0) + 1;
      }
    }

    const totalEdges = allEdges.length;

    // ── Edge type breakdown (sorted by count) ───────────────────────
    const typeEntries = Object.entries(edgesByType)
      .sort((a, b) => b[1] - a[1]);
    const maxCount = typeEntries[0]?.[1] || 1;

    // ── Most connected entry ────────────────────────────────────────
    let mostConnectedHtml = '';
    const entryEdgePairs = Object.entries(edgesPerEntry);
    if (entryEdgePairs.length > 0) {
      entryEdgePairs.sort((a, b) => b[1] - a[1]);
      const [topEntryId, topEdgeCount] = entryEdgePairs[0];
      const topEntry = entries.find(r => r.id === topEntryId);
      const topEntryTitle = topEntry
        ? esc(topEntry.title || 'Untitled')
        : `entry ${topEntryId.slice(0, 8)}…`;
      mostConnectedHtml = `
        <div class="ins-most-connected">
          <span class="ins-most-connected-icon">🏆</span>
          <span class="ins-most-connected-name" title="${topEntryTitle}">
            Most connected: <strong style="color:var(--text-primary);">${topEntryTitle}</strong>
          </span>
          <span class="ins-most-connected-count">${topEdgeCount} edge${topEdgeCount !== 1 ? 's' : ''}</span>
        </div>`;
    }

    // ── Knowledge density (avg edges per entry with edges) ──────────
    const entriesWithEdges = entryEdgePairs.length;
    const density = entriesWithEdges > 0
      ? (entryEdgePairs.reduce((s, [, c]) => s + c, 0) / entriesWithEdges).toFixed(1)
      : '0';

    return `
      <div class="card card-compact">
        <div class="flex-between mb-3" >
          <span class="ins-section-title">${icons.link(12)} Knowledge Graph</span>
          <div class="ins-graph-header-stats">
            <span>${totalEdges} edge${totalEdges !== 1 ? 's' : ''}</span>
            <span>${uniqueNodes.size} node${uniqueNodes.size !== 1 ? 's' : ''}</span>
          </div>
        </div>

        <!-- Density + connected-entries summary -->
        <div class="ins-stat-grid mb-3" >
          <div class="text-center">
            <div class="ins-big-num text-primary" >${totalEdges}</div>
            <div class="ins-muted-label">Edges</div>
          </div>
          <div class="text-center">
            <div class="ins-big-num text-primary" >${uniqueNodes.size}</div>
            <div class="ins-muted-label">Nodes</div>
          </div>
          <div class="text-center">
            <div class="ins-big-num text-primary" >${density}</div>
            <div class="ins-muted-label">Avg edges/entry</div>
          </div>
          <div class="text-center">
            <div class="ins-big-num text-primary" >${entriesWithEdges}</div>
            <div class="ins-muted-label">Connected</div>
          </div>
        </div>

        ${mostConnectedHtml}

        <!-- Edge type breakdown -->
        <div class="ins-muted-label mb-1 mt-2">Edges by type</div>
        <div class="rd-col-stack">
          ${typeEntries.map(([type, count]) => {
            const cfg = getEdgeTypeConfig(type);
            const pct = Math.round((count / maxCount) * 100);
            return `
              <div class="ins-edge-row">
                <span class="ins-edge-icon">${cfg.icon}</span>
                <span class="ins-edge-label">${cfg.label}</span>
                <div class="ins-edge-track">
                  <div class="ins-chart-bar" style="width:${pct}%;background:${cfg.color};"></div>
                </div>
                <span class="ins-edge-count">${count}</span>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  } catch { /* non-critical */
    return '';
  }
}
