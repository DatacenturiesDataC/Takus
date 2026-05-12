// Takus — Global Tasks Panel (Phase 14a: FOCUS)
// Aggregates uncompleted tasks across ALL recordings into a single dashboard.
// Tasks for Takus (automated workflows) + Tasks for Me (personal follow-ups).
import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import { getRecordings, saveRecording } from '../lib/storage.js';
import { toast } from './toast.js';
import { typeLabel, typeAccent } from './type-picker.js';

/**
 * Render the global tasks dashboard into `container`.
 * Shows all pending tasks across all recordings, grouped by type.
 */
export async function renderGlobalTasksPanel(container) {
  const recordings = await getRecordings().catch(() => []);

  // Collect all tasks from all recordings, with source info
  const allTakus = [];
  const allMe = [];

  for (const rec of recordings) {
    const tasks = rec.tasks || {};
    const src = { id: rec.id, title: rec.title || 'Untitled', date: rec.date, type: rec.type || 'screen' };
    for (const t of (tasks.takusTasks || [])) {
      if (!t.done) allTakus.push({ ...t, _source: src });
    }
    for (const t of (tasks.meTasks || [])) {
      if (!t.done) allMe.push({ ...t, _source: src });
    }
  }

  const totalPending = allTakus.length + allMe.length;

  if (totalPending === 0) {
    container.innerHTML = `
      <div class="card card-compact animate-in">
        <div class="empty-state" style="padding:var(--space-6) var(--space-4);">
          ${icons.checkSquare(32)}
          <p>All caught up</p>
          <p style="font-size:var(--font-xs);color:var(--color-text-disabled);margin-top:calc(-1 * var(--space-2));">Tasks are extracted automatically from your recordings with AI.</p>
        </div>
      </div>`;
    return;
  }

  const ACTION_META = {
    CREATE_BUG_REPORT:     { label: 'Bug Report',     color: '#ef4444', icon: icons.terminal(12) },
    LOG_DECISION:          { label: 'Decision',        color: '#7c3aed', icon: icons.checkSquare(12) },
    DRAFT_SHARE_MESSAGE:   { label: 'Share',           color: '#0ea5e9', icon: icons.send(12) },
    UPDATE_TICKET:         { label: 'Ticket',          color: '#f59e0b', icon: icons.arrowRight(12) },
    DRAFT_SLACK_MESSAGE:   { label: 'Slack',           color: '#10b981', icon: icons.send(12) },
    CREATE_CALENDAR_EVENT: { label: 'Calendar',        color: '#10b981', icon: icons.calendar(12) },
    TAKUS_TASK:            { label: 'Task',             color: '#6b7280', icon: icons.zap(12) },
  };

  function actionMeta(action) {
    return ACTION_META[action] || ACTION_META.TAKUS_TASK;
  }

  function renderTaskRow(task, type) {
    const src = task._source;
    const accent = typeAccent(src.type);
    const dateStr = new Date(src.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    if (type === 'takus') {
      const meta = actionMeta(task.action);
      return `
        <div class="global-task-row" data-recording-id="${esc(src.id)}" data-task-id="${esc(task.id)}" data-task-type="takus">
          <div class="global-task-check">
            <button class="btn-task-done" title="Mark done" aria-label="Mark task done">
              <span style="width:16px;height:16px;border:1.5px solid rgba(255,255,255,0.2);border-radius:3px;display:flex;align-items:center;justify-content:center;transition:all 0.15s;">&nbsp;</span>
            </button>
          </div>
          <div class="global-task-body">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span style="font-size:10px;font-weight:600;color:${meta.color};background:${meta.color}18;padding:1px 6px;border-radius:8px;display:inline-flex;align-items:center;gap:3px;">${meta.icon} ${meta.label}</span>
              <span style="font-size:var(--font-sm);color:var(--color-text-primary);">${esc(task.title || task.note || '')}</span>
            </div>
            <div style="font-size:10px;color:var(--color-text-disabled);display:flex;align-items:center;gap:6px;margin-top:2px;">
              <span style="color:${accent};">●</span> ${esc(src.title)} · ${dateStr}
              ${task.contextTimestamp ? `· <span style="font-family:monospace;">${esc(task.contextTimestamp)}</span>` : ''}
            </div>
          </div>
        </div>`;
    }

    // me task
    const urgencyColor = task.urgency === 'high' ? '#ef4444' : 'var(--color-text-muted)';
    return `
      <div class="global-task-row" data-recording-id="${esc(src.id)}" data-task-id="${esc(task.id)}" data-task-type="me">
        <div class="global-task-check">
          <button class="btn-task-done" title="Mark done" aria-label="Mark task done">
            <span style="width:16px;height:16px;border:1.5px solid rgba(255,255,255,0.2);border-radius:3px;display:flex;align-items:center;justify-content:center;transition:all 0.15s;">&nbsp;</span>
          </button>
        </div>
        <div class="global-task-body">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${task.urgency === 'high' ? `<span style="font-size:10px;font-weight:600;color:#ef4444;background:rgba(239,68,68,0.1);padding:1px 6px;border-radius:8px;">Urgent</span>` : ''}
            <span style="font-size:var(--font-sm);color:var(--color-text-primary);">${esc(task.note || '')}</span>
          </div>
          <div style="font-size:10px;color:var(--color-text-disabled);display:flex;align-items:center;gap:6px;margin-top:2px;">
            <span style="color:${accent};">●</span> ${esc(src.title)} · ${dateStr}
            ${task.contextTimestamp ? `· <span style="font-family:monospace;">${esc(task.contextTimestamp)}</span>` : ''}
          </div>
        </div>
      </div>`;
  }

  container.innerHTML = `
    <div class="card card-compact animate-in">
      <div class="card-header" style="padding-bottom:var(--space-2);">
        <h3 style="display:flex;align-items:center;gap:var(--space-2);">
          ${icons.zap(14)} Tasks
          <span style="font-size:var(--font-xs);font-weight:400;color:var(--color-text-muted);">${totalPending} pending</span>
        </h3>
      </div>

      ${allTakus.length ? `
        <div style="margin-bottom:var(--space-3);">
          <div style="font-size:10px;font-weight:var(--weight-semi);color:var(--color-text-disabled);text-transform:uppercase;letter-spacing:0.5px;padding:0 var(--space-3);margin-bottom:var(--space-1);">Tasks for Takus</div>
          <div id="global-takus-list">${allTakus.map(t => renderTaskRow(t, 'takus')).join('')}</div>
        </div>
      ` : ''}

      ${allMe.length ? `
        <div>
          <div style="font-size:10px;font-weight:var(--weight-semi);color:var(--color-text-disabled);text-transform:uppercase;letter-spacing:0.5px;padding:0 var(--space-3);margin-bottom:var(--space-1);">Tasks for Me</div>
          <div id="global-me-list">${allMe.map(t => renderTaskRow(t, 'me')).join('')}</div>
        </div>
      ` : ''}
    </div>`;

  // Mark done handler
  container.querySelectorAll('.btn-task-done').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.global-task-row');
      if (!row) return;
      const recId = row.dataset.recordingId;
      const taskId = row.dataset.taskId;
      const taskType = row.dataset.taskType;

      const rec = recordings.find(r => r.id === recId);
      if (!rec?.tasks) return;

      const list = taskType === 'takus' ? rec.tasks.takusTasks : rec.tasks.meTasks;
      const task = list?.find(t => t.id === taskId);
      if (task) {
        task.done = true;
        await saveRecording(rec).catch(() => {});
        row.style.opacity = '0.3';
        row.style.textDecoration = 'line-through';
        setTimeout(() => row.remove(), 400);
        toast.success('Task done', 'Marked as completed');
      }
    });
  });

  // Click task body → open source recording in detail view
  container.querySelectorAll('.global-task-body').forEach(body => {
    body.style.cursor = 'pointer';
    body.addEventListener('click', () => {
      const row = body.closest('.global-task-row');
      if (!row) return;
      const rec = recordings.find(r => r.id === row.dataset.recordingId);
      if (rec) {
        document.dispatchEvent(new CustomEvent('takus:open-recording', { detail: { recording: rec } }));
      }
    });
  });
}
