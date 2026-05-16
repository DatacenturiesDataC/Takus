// Takus — Data Export Engine (Phase 51)
// Enables data portability: export recordings, tasks, goals, and decisions
// in standard formats (JSON, Markdown). Critical for production readiness.

import { getRecordings, getNodesByType } from './storage.js';
import { getAllTasks, computeTaskAnalytics } from './graph/task-store.js';
import { getTaskTitle } from './task-helpers.js';

/**
 * Export all user data as a structured JSON bundle.
 * Includes recordings (metadata only, not blobs), tasks, goals, decisions, and analytics.
 *
 * @param {object} [options]
 * @param {boolean} [options.includeTranscripts=true] — Include AI transcripts
 * @param {boolean} [options.includeTasks=true]
 * @param {boolean} [options.includeGoals=true]
 * @returns {Promise<object>} Export bundle
 */
export async function exportData(options = {}) {
  const {
    includeTranscripts = true,
    includeTasks = true,
    includeGoals = true,
  } = options;

  const [recordings, tasks, goals, analytics] = await Promise.all([
    getRecordings().catch(() => []),
    includeTasks ? getAllTasks().catch(() => []) : [],
    includeGoals ? getNodesByType('goal').catch(() => []) : [],
    includeTasks ? computeTaskAnalytics().catch(() => null) : null,
  ]);

  // Strip blob references and internal state from recordings
  const cleanRecordings = recordings.map(r => {
    const clean = { ...r };
    delete clean._blob;
    delete clean._blobUrl;
    if (!includeTranscripts) {
      delete clean.aiTranscript;
      delete clean.aiVtt;
    }
    return clean;
  });

  // Extract decisions
  const decisions = [];
  for (const r of recordings) {
    for (const t of r.tasks?.takusTasks || []) {
      if (t.action === 'LOG_DECISION') {
        decisions.push({
          id: t.id,
          decision: t.payload?.decision || getTaskTitle(t),
          owner: t.payload?.owner || null,
          recordingId: r.id,
          recordingTitle: r.title,
          date: r.date,
        });
      }
    }
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    platform: 'takus',
    summary: {
      recordings: cleanRecordings.length,
      tasks: tasks.length,
      goals: goals.length,
      decisions: decisions.length,
    },
    analytics,
    recordings: cleanRecordings,
    tasks: includeTasks ? tasks.map(t => {
      const clean = { ...t };
      delete clean._source;
      delete clean._recRef;
      delete clean._priority;
      delete clean._priorityTier;
      delete clean._priorityOverride;
      return clean;
    }) : [],
    goals: includeGoals ? goals.map(g => ({
      id: g.id,
      title: g.properties?.title,
      description: g.properties?.description,
      state: g.properties?.state,
      targetDate: g.properties?.targetDate,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    })) : [],
    decisions,
  };
}

/**
 * Export data as a downloadable JSON file.
 * Triggers a browser download.
 *
 * @param {object} [options] — Same as exportData
 */
export async function downloadExportJSON(options = {}) {
  const bundle = await exportData(options);
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  _download(blob, `takus-export-${_dateSlug()}.json`);
  return bundle.summary;
}

/**
 * Export data as a Markdown document — human-readable archive.
 *
 * @param {object} [options]
 * @returns {Promise<string>} Markdown content
 */
export async function exportMarkdown(options = {}) {
  const bundle = await exportData(options);
  const lines = [
    `# Takus Export — ${bundle.exportedAt}`,
    '',
    `## Summary`,
    `| Item | Count |`,
    `|------|-------|`,
    `| Recordings | ${bundle.summary.recordings} |`,
    `| Tasks | ${bundle.summary.tasks} |`,
    `| Goals | ${bundle.summary.goals} |`,
    `| Decisions | ${bundle.summary.decisions} |`,
    '',
  ];

  // Goals
  if (bundle.goals.length > 0) {
    lines.push('## Goals', '');
    for (const g of bundle.goals) {
      const state = g.state || 'aspiration';
      const icon = state === 'achieved' ? '✅' : state === 'active' ? '🔄' : state === 'at-risk' ? '⚠️' : '🎯';
      lines.push(`### ${icon} ${g.title || 'Untitled'}`, '');
      if (g.description) lines.push(`> ${g.description}`, '');
      lines.push(`- **State:** ${state}`);
      if (g.targetDate) lines.push(`- **Target:** ${g.targetDate}`);
      lines.push('');
    }
  }

  // Decisions
  if (bundle.decisions.length > 0) {
    lines.push('## Decisions', '');
    for (const d of bundle.decisions) {
      lines.push(`- **${d.decision}**${d.owner ? ` (${d.owner})` : ''} — ${d.recordingTitle || 'Untitled'} · ${new Date(d.date).toLocaleDateString()}`);
    }
    lines.push('');
  }

  // Tasks
  if (bundle.tasks.length > 0) {
    const pending = bundle.tasks.filter(t => t.status === 'pending');
    const done = bundle.tasks.filter(t => t.status === 'done');
    const ignored = bundle.tasks.filter(t => t.status === 'ignored');

    lines.push('## Tasks', '');
    if (pending.length > 0) {
      lines.push('### Pending', '');
      for (const t of pending) lines.push(`- [ ] ${getTaskTitle(t, 'Untitled')}`);
      lines.push('');
    }
    if (done.length > 0) {
      lines.push('### Done', '');
      for (const t of done) lines.push(`- [x] ${getTaskTitle(t, 'Untitled')}${t.output ? ` — ${t.output}` : ''}`);
      lines.push('');
    }
    if (ignored.length > 0) {
      lines.push('### Ignored', '');
      for (const t of ignored) lines.push(`- ~~${getTaskTitle(t, 'Untitled')}~~${t.ignoredReason ? ` — ${t.ignoredReason}` : ''}`);
      lines.push('');
    }
  }

  // Recordings
  if (bundle.recordings.length > 0) {
    lines.push('## Recordings', '');
    for (const r of bundle.recordings.slice(0, 50)) {
      lines.push(`### ${r.title || 'Untitled'}`);
      lines.push(`- **Type:** ${r.type || 'screen'}`);
      lines.push(`- **Date:** ${new Date(r.date).toLocaleString()}`);
      if (r.aiSummary) {
        lines.push('', '**Summary:**', '', r.aiSummary.slice(0, 500));
      }
      lines.push('');
    }
    if (bundle.recordings.length > 50) {
      lines.push(`*... and ${bundle.recordings.length - 50} more recordings*`, '');
    }
  }

  return lines.join('\n');
}

/**
 * Download markdown export.
 */
export async function downloadExportMarkdown(options = {}) {
  const md = await exportMarkdown(options);
  const blob = new Blob([md], { type: 'text/markdown' });
  _download(blob, `takus-export-${_dateSlug()}.md`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _dateSlug() {
  return new Date().toISOString().slice(0, 10);
}

function _download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
