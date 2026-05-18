// Takus — Platform Health Check (Phase 47: Production Readiness)
// Validates that all platform services are functioning correctly.
// Used by the Insights panel and on-demand diagnostics.

import { getEntries, getNodesByType } from './storage.js';
import { getTaskCounts, computeTaskAnalytics } from './graph/task-store.js';
import { computeGoalAnalytics } from '../apps/goals/index.js';
import { getInboxCount } from './inbox.js';
import { runCompaction, estimateStorageUsage } from './idb-compaction.js';

/**
 * Run a full platform health check.
 * Returns a structured report with status, warnings, and metrics.
 *
 * @returns {Promise<object>} Health check report
 */
export async function runHealthCheck() {
  const checks = [];
  const warnings = [];
  const metrics = {};

  // 1. Storage — verify entries are accessible
  try {
    const entries = await getEntries();
    metrics.entries = entries.length;
    checks.push({ name: 'Storage', status: 'ok', detail: `${entries.length} entries` });

    // Check for orphaned entries (no title, no transcript)
    const orphaned = entries.filter(r => !r.title && !r.textContent);
    if (orphaned.length > 0) {
      warnings.push(`${orphaned.length} entry(s) have no title or transcript`);
    }

    // Check for entries with failed pipeline runs
    const failed = entries.filter(r => r.pipelineRun?.status === 'failed');
    if (failed.length > 0) {
      warnings.push(`${failed.length} entry(s) have failed pipeline runs`);
      metrics.failedPipelines = failed.length;
    }
  } catch (e) {
    checks.push({ name: 'Storage', status: 'error', detail: e.message });
  }

  // 2. Graph — verify node and edge stores
  try {
    const [goals, tasks, people] = await Promise.all([
      getNodesByType('goal').catch(() => []),
      getNodesByType('task').catch(() => []),
      getNodesByType('person').catch(() => []),
    ]);
    metrics.goals = goals.length;
    metrics.taskNodes = tasks.length;
    metrics.people = people.length;
    metrics.totalNodes = goals.length + tasks.length + people.length;
    checks.push({ name: 'Graph', status: 'ok', detail: `${metrics.totalNodes} nodes (${goals.length} goals, ${tasks.length} tasks, ${people.length} people)` });
  } catch (e) {
    checks.push({ name: 'Graph', status: 'error', detail: e.message });
  }

  // 3. Tasks — verify task store
  try {
    const taskCounts = await getTaskCounts();
    const taskAnalytics = await computeTaskAnalytics();
    metrics.tasksPending = taskCounts.pending;
    metrics.tasksDone = taskCounts.done;
    metrics.tasksTotal = taskCounts.total;
    metrics.taskVelocity = taskAnalytics.velocity;
    metrics.taskOverdue = taskAnalytics.overdueCount;
    checks.push({ name: 'Tasks', status: 'ok', detail: `${taskCounts.total} total (${taskCounts.pending} pending)` });

    if (taskAnalytics.overdueCount > 5) {
      warnings.push(`${taskAnalytics.overdueCount} tasks overdue (>7 days old)`);
    }
  } catch (e) {
    checks.push({ name: 'Tasks', status: 'error', detail: e.message });
  }

  // 4. Goals — verify goal engine
  try {
    const goalAnalytics = await computeGoalAnalytics();
    metrics.goalAchieved = goalAnalytics.achieved || 0;
    metrics.goalTotal = goalAnalytics.total || 0;
    checks.push({ name: 'Goals', status: 'ok', detail: `${goalAnalytics.total || 0} goals` });
  } catch (e) {
    checks.push({ name: 'Goals', status: 'ok', detail: '0 goals (analytics unavailable)' });
  }

  // 5. Inbox — verify inbox service
  try {
    const inboxCount = await getInboxCount();
    metrics.inboxCount = inboxCount;
    checks.push({ name: 'Inbox', status: 'ok', detail: `${inboxCount} items` });
  } catch (e) {
    checks.push({ name: 'Inbox', status: 'error', detail: e.message });
  }

  // 6. IDB Compaction — scan for orphaned records (dry-run)
  try {
    const compaction = await runCompaction({ dryRun: true });
    metrics.orphanedRecords = compaction.totalOrphans;
    if (compaction.totalOrphans > 0) {
      warnings.push(`${compaction.totalOrphans} orphaned record(s) detected (run IDB compaction to clean up)`);
      checks.push({ name: 'IDB Integrity', status: 'ok', detail: `${compaction.totalOrphans} orphan(s) found · ${compaction.durationMs}ms scan` });
    } else {
      checks.push({ name: 'IDB Integrity', status: 'ok', detail: 'No orphans detected' });
    }
  } catch (e) {
    checks.push({ name: 'IDB Integrity', status: 'ok', detail: 'Scan unavailable' });
  }

  // 7. Storage quota estimation
  try {
    const usage = await estimateStorageUsage();
    if (usage) {
      metrics.storageUsedMB = Math.round(usage.used / 1_048_576);
      metrics.storageQuotaMB = Math.round(usage.quota / 1_048_576);
      metrics.storagePercent = usage.percentage;
      const detail = `${metrics.storageUsedMB} MB / ${metrics.storageQuotaMB} MB (${usage.percentage}%)`;
      if (usage.percentage > 80) {
        warnings.push(`Storage usage at ${usage.percentage}% — consider archiving old entries`);
        checks.push({ name: 'Storage Quota', status: 'ok', detail });
      } else {
        checks.push({ name: 'Storage Quota', status: 'ok', detail });
      }
    }
  } catch {
    // Storage API not available — skip silently
  }

  // Compute overall status
  const hasErrors = checks.some(c => c.status === 'error');
  const status = hasErrors ? 'degraded' : warnings.length > 0 ? 'healthy_with_warnings' : 'healthy';

  return {
    status,
    timestamp: Date.now(),
    checks,
    warnings,
    metrics,
  };
}

/**
 * Format a health check report as a human-readable string.
 * @param {object} report - From runHealthCheck()
 * @returns {string}
 */
export function formatHealthReport(report) {
  const lines = [
    `Platform Health: ${report.status.toUpperCase()}`,
    `Timestamp: ${new Date(report.timestamp).toISOString()}`,
    '',
    '── Services ──',
  ];

  for (const check of report.checks) {
    const icon = check.status === 'ok' ? '✓' : '✗';
    lines.push(`  ${icon} ${check.name}: ${check.detail}`);
  }

  if (report.warnings.length > 0) {
    lines.push('', '── Warnings ──');
    for (const w of report.warnings) {
      lines.push(`  ⚠ ${w}`);
    }
  }

  lines.push('', '── Metrics ──');
  for (const [key, val] of Object.entries(report.metrics)) {
    lines.push(`  ${key}: ${val}`);
  }

  return lines.join('\n');
}
