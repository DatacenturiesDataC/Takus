// Takus — Global Tasks Panel (Phase 14a / Phase 15: Advanced Task Engine)
// Aggregates tasks across ALL recordings with filter bar, progress, and status transitions.
import { icons } from '../lib/icons.js';
import { esc, shortDate } from '../lib/utils.js';
import { OPEN_RECORDING } from '../lib/events.js';
import { getRecordings, saveRecording, getContacts, getAllInteractions } from '../lib/storage.js';
import { toast } from './toast.js';
import { typeAccent } from './type-picker.js';
import { migrateTask } from '../lib/ai-engine.js';
import { computeTaskPriority, getPriorityTier } from '../lib/task-priority.js';
import { requiresApproval, executeStep, hasHandler } from '../lib/step-executor.js';
import { isStepDone, getStepDoneCount, areAllStepsDone } from '../lib/task-helpers.js';

/**
 * Render the global tasks dashboard into `container`.
 */
export async function renderGlobalTasksPanel(container) {
  const recordings = await getRecordings().catch(() => []);

  // Collect all tasks from all recordings, with source info
  const allTakus = [];
  const allMe = [];
  let totalAll = 0;

  for (const rec of recordings) {
    const tasks = rec.tasks || {};
    const src = { id: rec.id, title: rec.title || 'Untitled', date: rec.date, type: rec.type || 'screen' };
    for (const t of (tasks.takusTasks || [])) {
      migrateTask(t);
      allTakus.push({ ...t, _source: src, _recRef: rec });
      totalAll++;
    }
    for (const t of (tasks.meTasks || [])) {
      migrateTask(t);
      allMe.push({ ...t, _source: src, _recRef: rec });
      totalAll++;
    }
  }

  // Load contacts and interactions for priority scoring
  const [contacts, interactions] = await Promise.all([
    getContacts().catch(() => []),
    getAllInteractions().catch(() => []),
  ]);

  const allTasks = [...allTakus, ...allMe];

  // Compute priority scores for all pending tasks
  for (const task of allTasks) {
    if ((task.status || 'pending') === 'pending') {
      task._priority = computeTaskPriority(task, task._recRef, contacts, interactions);
      task._priorityTier = getPriorityTier(task._priority);
    }
  }
  const pending = allTasks.filter(t => t.status === 'pending');
  const done = allTasks.filter(t => t.status === 'done');
  const ignored = allTasks.filter(t => t.status === 'ignored');

  if (totalAll === 0) {
    container.innerHTML = `
      <div class="card card-compact animate-in">
        <div class="empty-state" style="padding:var(--space-6) var(--space-4);">
          ${icons.checkSquare(32)}
          <p>No tasks yet</p>
          <p style="font-size:var(--font-xs);color:var(--color-text-disabled);margin-top:calc(-1 * var(--space-2));">Tasks are extracted automatically from your recordings with AI.</p>
        </div>
      </div>`;
    return;
  }

  const completedCount = done.length + ignored.length;
  const progressPct = totalAll > 0 ? Math.round((completedCount / totalAll) * 100) : 0;

  const ACTION_META = {
    CREATE_BUG_REPORT:     { label: 'Bug Report',     color: '#ef4444', icon: icons.terminal(12) },
    LOG_DECISION:          { label: 'Decision',        color: '#7c3aed', icon: icons.checkSquare(12) },
    DRAFT_SHARE_MESSAGE:   { label: 'Share',           color: '#0ea5e9', icon: icons.send(12) },
    UPDATE_TICKET:         { label: 'Ticket',          color: '#f59e0b', icon: icons.arrowRight(12) },
    DRAFT_SLACK_MESSAGE:   { label: 'Slack',           color: '#10b981', icon: icons.send(12) },
    CREATE_CALENDAR_EVENT: { label: 'Calendar',        color: '#10b981', icon: icons.calendar(12) },
    DRAFT_EMAIL:           { label: 'Email',            color: '#0ea5e9', icon: icons.send(12) },
    UPLOAD_TO_DRIVE:       { label: 'Drive',            color: '#f59e0b', icon: icons.cloud(12) },
    TAKUS_TASK:            { label: 'Task',             color: '#6b7280', icon: icons.zap(12) },
  };

  function actionMeta(action) {
    return ACTION_META[action] || ACTION_META.TAKUS_TASK;
  }

  function renderTaskRow(task, type) {
    const src = task._source;
    const accent = typeAccent(src.type);
    const dateStr = shortDate(src.date);
    const status = task.status || 'pending';
    const statusClass = status === 'done' ? ' task-status-done' : status === 'ignored' ? ' task-status-ignored' : '';
    const seqBadge = task.sequence ? `<span class="task-sequence-badge" style="font-size:9px;">${task.sequence}</span>` : '';

    const label = type === 'takus'
      ? (() => { const m = actionMeta(task.action); return `<span style="font-size:10px;font-weight:600;color:${m.color};background:${m.color}18;padding:1px 6px;border-radius:8px;display:inline-flex;align-items:center;gap:3px;">${m.icon} ${m.label}</span>`; })()
      : (task.urgency === 'high' ? `<span style="font-size:10px;font-weight:600;color:#ef4444;background:rgba(239,68,68,0.1);padding:1px 6px;border-radius:8px;">Urgent</span>` : '');

    // Priority badge for pending tasks
    const priorityBadge = status === 'pending' && task._priority > 0
      ? (() => {
          const tier = task._priorityTier || 'low';
          const colors = { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#6b7280' };
          const dots = { critical: '🔴', high: '🟡', medium: '🔵', low: '' };
          return dots[tier] ? `<span title="Priority: ${task._priority}" style="font-size:9px;cursor:help;">${dots[tier]}</span>` : '';
        })()
      : '';

    const title = esc(task.title || task.note || '');
    const outputLine = status === 'done' && task.output ? `<div class="task-output" style="margin-top:2px;">${icons.check(9)} ${esc(task.output)}</div>` : '';
    const ignoredLine = status === 'ignored' && task.ignoredReason ? `<div class="task-ignored-reason" style="margin-top:2px;">${icons.x(9)} ${esc(task.ignoredReason)}</div>` : '';

    return `
      <div class="global-task-row${statusClass}" data-recording-id="${esc(src.id)}" data-task-id="${esc(task.id)}" data-task-type="${type}">
        <div class="global-task-check">
          ${status === 'pending' ? `
            <button class="btn-task-done" title="Mark done" aria-label="Mark task done">
              <span style="width:16px;height:16px;border:1.5px solid rgba(255,255,255,0.2);border-radius:3px;display:flex;align-items:center;justify-content:center;transition:all 0.15s;">&nbsp;</span>
            </button>` : `
            <button class="btn btn-ghost btn-icon btn-sm task-reopen" data-id="${esc(task.id)}" title="Reopen" style="padding:0;line-height:0;">${icons.refresh(13)}</button>`}
        </div>
        <div class="global-task-body">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${priorityBadge} ${seqBadge} ${label}
            <span style="font-size:var(--font-sm);color:var(--color-text-primary);">${title}</span>
          </div>
          <div style="font-size:10px;color:var(--color-text-disabled);display:flex;align-items:center;gap:6px;margin-top:2px;">
            <span style="color:${accent};">●</span> ${esc(src.title)} · ${dateStr}
            ${task.contextTimestamp ? `· <span style="font-family:monospace;">${esc(task.contextTimestamp)}</span>` : ''}
            ${task.steps?.length ? `· <span style="color:${areAllStepsDone(task) ? 'var(--color-success)' : 'var(--color-text-disabled)'}">${getStepDoneCount(task)}/${task.steps.length} steps</span>` : ''}
          </div>
          ${task.objective ? `<div class="task-objective">${icons.arrowRight(9)} ${esc(task.objective)}</div>` : ''}
          ${outputLine}${ignoredLine}
          ${_renderSubSteps(task)}
        </div>
        ${status === 'pending' ? `
          <button class="btn btn-ghost btn-icon btn-sm task-global-ignore" data-id="${esc(task.id)}" title="Ignore" style="color:var(--color-warning);flex-shrink:0;">${icons.x(13)}</button>` : ''}
      </div>`;
  }

  // Filter state
  let activeFilter = 'pending';

  function getFiltered() {
    if (activeFilter === 'priority') {
      const pendingTakus = allTakus.filter(t => t.status === 'pending').sort((a, b) => (b._priority || 0) - (a._priority || 0));
      const pendingMe = allMe.filter(t => t.status === 'pending').sort((a, b) => (b._priority || 0) - (a._priority || 0));
      return { takus: pendingTakus, me: pendingMe };
    }
    if (activeFilter === 'pending') return { takus: allTakus.filter(t => t.status === 'pending'), me: allMe.filter(t => t.status === 'pending') };
    if (activeFilter === 'done') return { takus: allTakus.filter(t => t.status === 'done'), me: allMe.filter(t => t.status === 'done') };
    if (activeFilter === 'ignored') return { takus: allTakus.filter(t => t.status === 'ignored'), me: allMe.filter(t => t.status === 'ignored') };
    return { takus: allTakus, me: allMe };
  }

  function renderInner() {
    const f = getFiltered();
    const innerCount = f.takus.length + f.me.length;

    return `
      <div class="card-header" style="padding-bottom:var(--space-2);">
        <h3 style="display:flex;align-items:center;gap:var(--space-2);">
          ${icons.zap(14)} Tasks
          <span style="font-size:var(--font-xs);font-weight:400;color:var(--color-text-muted);">${pending.length} pending</span>
        </h3>
      </div>

      <!-- Progress -->
      <div style="margin-bottom:var(--space-3);">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--color-text-disabled);margin-bottom:4px;">
          <span>${completedCount} of ${totalAll} completed</span>
          <span>${progressPct}%</span>
        </div>
        <div class="task-progress-bar"><div class="task-progress-fill" style="width:${progressPct}%;"></div></div>
      </div>

      <!-- Filter bar -->
      <div class="task-filter-bar" style="margin-bottom:var(--space-3);">
        <button class="task-filter-chip${activeFilter === 'pending' ? ' active' : ''}" data-filter="pending">Pending (${pending.length})</button>
        <button class="task-filter-chip${activeFilter === 'priority' ? ' active' : ''}" data-filter="priority">${icons.trendingUp(10)} Priority</button>
        <button class="task-filter-chip${activeFilter === 'done' ? ' active' : ''}" data-filter="done">Done (${done.length})</button>
        <button class="task-filter-chip${activeFilter === 'ignored' ? ' active' : ''}" data-filter="ignored">Ignored (${ignored.length})</button>
        <button class="task-filter-chip${activeFilter === 'all' ? ' active' : ''}" data-filter="all">All (${totalAll})</button>
      </div>

      ${innerCount === 0 ? `
        <div style="text-align:center;padding:var(--space-4);color:var(--color-text-disabled);font-size:var(--font-xs);">
          No ${activeFilter === 'all' ? '' : activeFilter + ' '}tasks
        </div>` : ''}

      ${_renderObjectiveSummary([...f.takus, ...f.me])}

      ${f.takus.length ? `
        <div style="margin-bottom:var(--space-3);">
          <div style="font-size:10px;font-weight:var(--weight-semi);color:var(--color-text-disabled);text-transform:uppercase;letter-spacing:0.5px;padding:0 var(--space-3);margin-bottom:var(--space-1);">Tasks for Takus</div>
          <div id="global-takus-list">${f.takus.map(t => renderTaskRow(t, 'takus')).join('')}</div>
        </div>` : ''}

      ${f.me.length ? `
        <div>
          <div style="font-size:10px;font-weight:var(--weight-semi);color:var(--color-text-disabled);text-transform:uppercase;letter-spacing:0.5px;padding:0 var(--space-3);margin-bottom:var(--space-1);">Tasks for Me</div>
          <div id="global-me-list">${f.me.map(t => renderTaskRow(t, 'me')).join('')}</div>
        </div>` : ''}`;
  }

  container.innerHTML = `<div class="card card-compact animate-in" id="global-tasks-card">${renderInner()}</div>`;

  function rebind() {
    const card = container.querySelector('#global-tasks-card');
    if (!card) return;

    // Filter chips
    card.querySelectorAll('.task-filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        activeFilter = chip.dataset.filter;
        card.innerHTML = renderInner();
        rebind();
      });
    });

    // Mark done
    card.querySelectorAll('.btn-task-done').forEach(btn => {
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
        if (!task) return;

        const output = prompt('What was the output/result?', '') ?? '';
        task.status = 'done';
        task.output = output || null;
        task.doneAt = Date.now();
        delete task.done; // clean legacy field
        await saveRecording(rec).catch(() => {});

        toast.success('Task done', (task.title || task.note || '').slice(0, 40));
        renderGlobalTasksPanel(container);
      });
    });

    // Ignore
    card.querySelectorAll('.task-global-ignore').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.global-task-row');
        if (!row) return;
        const recId = row.dataset.recordingId;
        const taskId = row.dataset.taskId || btn.dataset.id;
        const taskType = row.dataset.taskType;

        const rec = recordings.find(r => r.id === recId);
        if (!rec?.tasks) return;
        const list = taskType === 'takus' ? rec.tasks.takusTasks : rec.tasks.meTasks;
        const task = list?.find(t => t.id === taskId);
        if (!task) return;

        const reason = prompt('Why are you ignoring this task?', '');
        if (reason === null) return;
        if (!reason.trim()) { toast.warning('Reason required', 'Please provide a reason.'); return; }

        task.status = 'ignored';
        task.ignoredReason = reason.trim();
        task.ignoredAt = Date.now();
        delete task.done;
        await saveRecording(rec).catch(() => {});

        toast.info('Task ignored', reason.trim().slice(0, 40));
        renderGlobalTasksPanel(container);
      });
    });

    // Reopen
    card.querySelectorAll('.task-reopen').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.global-task-row');
        if (!row) return;
        const recId = row.dataset.recordingId;
        const taskId = row.dataset.taskId || btn.dataset.id;
        const taskType = row.dataset.taskType;

        const rec = recordings.find(r => r.id === recId);
        if (!rec?.tasks) return;
        const list = taskType === 'takus' ? rec.tasks.takusTasks : rec.tasks.meTasks;
        const task = list?.find(t => t.id === taskId);
        if (!task) return;

        task.status = 'pending';
        task.output = null;
        task.ignoredReason = null;
        task.doneAt = null;
        task.ignoredAt = null;
        await saveRecording(rec).catch(() => {});

        toast.info('Task reopened');
        renderGlobalTasksPanel(container);
      });
    });

    // Click task body → open source recording
    card.querySelectorAll('.global-task-body').forEach(body => {
      body.style.cursor = 'pointer';
      body.addEventListener('click', () => {
        const row = body.closest('.global-task-row');
        if (!row) return;
        const rec = recordings.find(r => r.id === row.dataset.recordingId);
        if (rec) {
          document.dispatchEvent(new CustomEvent(OPEN_RECORDING, { detail: { recording: rec } }));
        }
      });
    });

    // Run sub-step via step executor
    card.querySelectorAll('.step-run-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const row = btn.closest('.global-task-row');
        if (!row) return;
        const recId = row.dataset.recordingId;
        const taskId = row.dataset.taskId;
        const taskType = row.dataset.taskType;
        const stepIdx = parseInt(btn.dataset.stepIdx, 10);

        const rec = recordings.find(r => r.id === recId);
        if (!rec?.tasks) return;
        const list = taskType === 'takus' ? rec.tasks.takusTasks : rec.tasks.meTasks;
        const task = list?.find(t => t.id === taskId);
        if (!task?.steps?.[stepIdx]) return;

        const step = task.steps[stepIdx];
        btn.disabled = true;
        btn.innerHTML = `<div class="spinner" style="width:8px;height:8px;border-width:1px;"></div>`;

        const result = await executeStep(step, {
          recording: rec,
          transcript: rec.aiTranscript,
          summary: rec.aiSummary,
        });

        if (result.success) {
          step.done = true;
          step.status = 'completed';
          await saveRecording(rec).catch(() => {});
          toast.success('Step completed', step.title || step.type);
        } else {
          toast.error('Step failed', result.error || 'Unknown error');
        }

        renderGlobalTasksPanel(container);
      });
    });
  }

  rebind();
}

/** Group tasks by objective and render a compact strategic summary */
function _renderObjectiveSummary(tasks) {
  const objectives = {};
  for (const t of tasks) {
    if (!t.objective) continue;
    if (!objectives[t.objective]) objectives[t.objective] = { total: 0, done: 0 };
    objectives[t.objective].total++;
    if (t.status === 'done' || t.status === 'ignored') objectives[t.objective].done++;
  }
  const entries = Object.entries(objectives);
  if (!entries.length) return '';

  return `
    <div style="margin-bottom:var(--space-3);border:1px solid rgba(124,58,237,0.15);border-radius:var(--radius-md);padding:var(--space-2) var(--space-3);background:rgba(124,58,237,0.03);">
      <div style="font-size:9px;font-weight:var(--weight-semi);color:var(--color-primary-light);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:var(--space-1);">Active Objectives</div>
      ${entries.map(([obj, c]) => {
        const pct = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
        return `
          <div style="display:flex;align-items:center;gap:8px;font-size:10px;margin-top:3px;">
            <span style="flex:1;color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(obj)}</span>
            <div style="width:60px;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;flex-shrink:0;">
              <div style="width:${pct}%;height:100%;background:var(--color-primary-light);border-radius:2px;"></div>
            </div>
            <span style="font-size:9px;color:var(--color-text-disabled);width:30px;text-align:right;">${c.done}/${c.total}</span>
          </div>`;
      }).join('')}
    </div>`;
}

/**
 * Render expandable sub-steps for a task (if it has steps).
 * Shows step status badges and a "Run" button for auto-approved pending steps.
 */
function _renderSubSteps(task) {
  if (!task.steps?.length) return '';
  const doneCount = getStepDoneCount(task);
  const totalCount = task.steps.length;
  const allDone = doneCount === totalCount;

  return `
    <details class="task-substeps" style="margin-top:4px;">
      <summary style="font-size:10px;color:${allDone ? 'var(--color-success)' : 'var(--color-text-disabled)'};cursor:pointer;user-select:none;display:inline-flex;align-items:center;gap:4px;">
        ${icons.arrowRight(8)} ${doneCount}/${totalCount} sub-steps ${allDone ? '✓' : ''}
      </summary>
      <div style="margin-top:4px;padding-left:var(--space-2);border-left:2px solid rgba(255,255,255,0.06);">
        ${task.steps.map((s, i) => {
          const isDone = isStepDone(s);
          const isFailed = s.status === 'failed';
          const isPending = !isDone && !isFailed;
          const statusIcon = isDone ? `<span style="color:var(--color-success);">${icons.check(9)}</span>`
            : isFailed ? `<span style="color:var(--color-danger);">${icons.x(9)}</span>`
            : `<span style="color:var(--color-text-disabled);">○</span>`;
          const canRun = isPending && s.assignee === 'takus' && s.type && hasHandler(s.type) && !requiresApproval(s);

          return `
            <div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:10px;" data-step-idx="${i}">
              ${statusIcon}
              <span style="flex:1;color:${isDone ? 'var(--color-text-disabled)' : 'var(--color-text-secondary)'};${isDone ? 'text-decoration:line-through;' : ''}">${esc(s.title || s.type || `Step ${i + 1}`)}</span>
              ${canRun ? `<button class="btn btn-ghost btn-sm step-run-btn" data-step-idx="${i}" style="font-size:9px;padding:1px 6px;line-height:1.2;">${icons.zap(8)} Run</button>` : ''}
              ${s.status === 'waiting_input' ? `<span style="font-size:9px;color:var(--color-warning);">needs approval</span>` : ''}
            </div>`;
        }).join('')}
      </div>
    </details>`;
}
