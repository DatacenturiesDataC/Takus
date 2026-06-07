
// Aggregates tasks from both embedded entries AND standalone graph nodes.
import { icons } from '../lib/icons.js';
import { esc, shortDate, MS_PER_HOUR } from '../lib/utils.js';
import { OPEN_ENTRY, NAVIGATE } from '../lib/events.js';
import { getEntries, getContacts, getAllInteractions } from '../lib/storage.js';
import { toast } from './toast.js';
import { typeAccent } from '../lib/content-types.js';
import { promptAsync, selectAsync } from '../lib/dialog-utils.js';
import { computeTaskPriority, getPriorityTier } from '../lib/task-priority.js';
import { requiresApproval, executeStep, hasHandler } from '../lib/step-executor.js';
import { isStepDone, getStepDoneCount, areAllStepsDone, getTaskTitle } from '../lib/task-helpers.js';
import { recordSignal } from '../lib/preference-engine.js';
import { getAllTasks, updateTask, computeTaskAnalytics } from '../lib/graph/task-store.js';

/**
 * Render the global tasks dashboard into `container`.
 */
export async function renderGlobalTasksPanel(container) {
  // Show loading skeleton immediately while data loads
  container.innerHTML = '<div class="skeleton-list"><div class="skeleton-row"></div><div class="skeleton-row"></div><div class="skeleton-row"></div></div>';

  // Use the unified task store — covers both embedded and standalone tasks
  const allTasksRaw = await getAllTasks().catch(() => []);

  // Load entries for priority scoring context
  const entries = await getEntries().catch(() => []);
  const entryMap = new Map(entries.map(r => [r.id, r]));

  // Split by assignee type
  const allTakus = allTasksRaw.filter(t => t.assignee === 'takus');
  const allMe = allTasksRaw.filter(t => t.assignee === 'me');
  const totalAll = allTasksRaw.length;

  // Attach entry references for priority scoring
  for (const t of allTasksRaw) {
    t._source = t.source || { id: t._contentId, title: 'Untitled', date: t.createdAt, type: 'screen' };
    t._entryRef = entryMap.get(t._contentId) || null;
  }

  // Load contacts and interactions for priority scoring
  const [contacts, interactions] = await Promise.all([
    getContacts().catch(() => []),
    getAllInteractions().catch(() => []),
  ]);

  const allTasks = [...allTakus, ...allMe];

  // Compute priority scores for all pending tasks
  const TIER_TO_SCORE = { critical: 90, high: 65, medium: 35, low: 10 };
  for (const task of allTasks) {
    if ((task.status || 'pending') === 'pending') {
      task._priority = await computeTaskPriority(task, task._entryRef, contacts, interactions);
      task._priorityTier = getPriorityTier(task._priority);

      // Apply manual override if the user has set one
      if (task.priorityOverride) {
        task._priorityOverride = task.priorityOverride;
        task._priorityTier = task.priorityOverride;
        task._priority = TIER_TO_SCORE[task.priorityOverride] ?? task._priority;
      }
    }
  }
  const pending = allTasks.filter(t => t.status === 'pending');
  const done = allTasks.filter(t => t.status === 'done');
  const ignored = allTasks.filter(t => t.status === 'ignored');

  // Task Analytics
  const analytics = await computeTaskAnalytics().catch(() => ({}));

  if (totalAll === 0) {
    container.innerHTML = `
      <div class="card card-compact animate-in" id="global-tasks-card">
        <div class="empty-state pad-card" >
          ${icons.checkSquare(32)}
          <p>No tasks yet</p>
          <p class="text-xs text-disabled" style="margin-top:calc(-1 * var(--space-2));">Tasks are extracted automatically from entries, or create your own.</p>
          <div class="flex gap-2 mt-3 flex-wrap justify-center">
            <button id="create-task-empty-btn" class="btn btn-outline gap-1">${icons.plus(12)} New Task</button>
            <button id="create-entry-empty-btn" class="btn btn-ghost gap-1 text-xs">${icons.mic(12)} Create an entry</button>
          </div>
        </div>
        ${_renderNewTaskForm()}
      </div>`;
    _bindNewTaskForm(container, () => renderGlobalTasksPanel(container));
    container.querySelector('#create-entry-empty-btn')?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent(NAVIGATE, { detail: { tab: 'home' } }));
    });
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
    ME_TASK:               { label: 'Personal',         color: '#6b7280', icon: icons.checkSquare(12) },
    CHAT_TASK:             { label: 'Chat',             color: '#8b5cf6', icon: icons.messageSquare(12) },
    CHAT_EXTRACTED:        { label: 'Extracted',        color: '#06b6d4', icon: icons.search(12) },
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
    const seqBadge = task.sequence ? `<span class="task-sequence-badge">${task.sequence}</span>` : '';

    const label = type === 'takus'
      ? (() => { const m = actionMeta(task.action); return `<span class="task-action-badge" style="color:${m.color};background:${m.color}18;">${m.icon} ${m.label}</span>`; })()
      : (task.urgency === 'high' ? `<span class="task-urgent-badge">Urgent</span>` : '');

    // Priority badge for pending tasks — clickable for override
    const priorityBadge = status === 'pending' && task._priority > 0
      ? (() => {
          const tier = task._priorityOverride || task._priorityTier || 'low';
          const colors = { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#6b7280' };
          const dots = { critical: '🔴', high: '🟡', medium: '🔵', low: '' };
          const overrideLabel = task._priorityOverride ? ' ✎' : '';
          return dots[tier] || task._priorityOverride
            ? `<button class="btn btn-ghost btn-sm task-priority-btn" data-id="${esc(task.id)}" title="Priority: ${task._priority}${task._priorityOverride ? ' (overridden to ' + tier + ')' : ''} — click to change">${dots[tier] || '○'}${overrideLabel}</button>`
            : '';
        })()
      : '';

    const title = esc(getTaskTitle(task));
    const outputLine = status === 'done' && task.output ? `<div class="task-output mt-2 mt-4 mt-4"   >${icons.check(9)} ${esc(task.output)}</div>` : '';
    const ignoredLine = status === 'ignored' && task.ignoredReason ? `<div class="task-ignored-reason mt-2 mt-4 mt-4"   >${icons.x(9)} ${esc(task.ignoredReason)}</div>` : '';

    return `
      <div class="global-task-row${statusClass}" data-entry-id="${esc(src.id)}" data-task-id="${esc(task.id)}" data-task-type="${type}">
        <div class="global-task-check">
          ${batchMode && status === 'pending' ? `
            <label class="flex items-center cursor-pointer">
              <input type="checkbox" class="batch-task-cb" data-id="${esc(task.id)}" ${batchSelected.has(task.id) ? 'checked' : ''} />
            </label>` :
            status === 'pending' ? `
            <button class="btn-task-done" title="Mark done" aria-label="Mark task done">
              <span class="task-done-check">&nbsp;</span>
            </button>` : `
            <button class="btn btn-ghost btn-icon btn-sm task-reopen" data-id="${esc(task.id)}" title="Reopen">${icons.refresh(13)}</button>`}
        </div>
        <div class="global-task-body">
          <div class="gt-row-labels">
            ${priorityBadge} ${seqBadge} ${label}
            <span class="gt-row-title">${title}</span>
          </div>
          <div class="task-row-meta">
            <span style="color:${accent};">●</span> ${esc(src.title)} · ${dateStr}
            ${task.contextTimestamp ? `· <span class="font-mono">${esc(task.contextTimestamp)}</span>` : ''}
            ${task.steps?.length ? `· <span style="color:${areAllStepsDone(task) ? 'var(--color-success)' : 'var(--text-disabled)'}">${getStepDoneCount(task)}/${task.steps.length} steps</span>` : ''}
          </div>
          ${task.objective ? `<div class="task-objective">${icons.arrowRight(9)} ${esc(task.objective)}</div>` : ''}
          ${outputLine}${ignoredLine}
          ${_renderSubSteps(task)}
        </div>
        ${status === 'pending' ? `
          <button class="btn btn-ghost btn-icon btn-sm task-global-ignore text-warning shrink-0" data-id="${esc(task.id)}" title="Ignore">${icons.x(13)}</button>` : ''}
      </div>`;
  }

  // Filter state
  let activeFilter = 'pending';
  let batchMode = false;
  const batchSelected = new Set();

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
      <div class="card-header gt-card-head" >
        <h2 class="flex-center gap-2 flex-1" >
          ${icons.zap(14)} Tasks
          <span class="gt-pending-count">${pending.length} pending</span>
        </h2>
        <div class="set-flex-row">
          ${activeFilter === 'pending' && pending.length > 1 ? `<button id="batch-mode-toggle" class="btn btn-ghost" style="font-size:var(--text-2xs);padding:2px 8px;${batchMode ? 'color:var(--accent-hover);background:rgba(124,58,237,0.1);' : ''}">${batchMode ? 'Cancel' : '☐ Select'}</button>` : ''}
          <button id="create-task-header-btn" class="btn btn-outline btn-sm gap-1" title="Create a standalone task">${icons.plus(11)} New</button>
        </div>
      </div>

      ${batchMode ? `
      <div class="task-batch-bar">
        <label class="flex items-center gap-1 cursor-pointer text-secondary">
          <input type="checkbox" id="batch-select-all"  /> Select all
        </label>
        <span class="flex-1"></span>
        <span id="batch-count" class="text-xs text-muted">${batchSelected.size} selected</span>
        <button id="batch-done-btn" class="btn btn-sm task-batch-btn-done" ${batchSelected.size === 0 ? 'disabled' : ''}>✓ Done</button>
        <button id="batch-ignore-btn" class="btn btn-sm btn-ghost task-batch-btn-ignore" ${batchSelected.size === 0 ? 'disabled' : ''}>${icons.x(10)} Ignore</button>
      </div>` : ''}

      ${_renderNewTaskForm()}

      <!-- Progress -->
      <div class="mb-2">
        <div class="gt-progress-labels">
          <span>${completedCount} of ${totalAll} completed</span>
          <span>${progressPct}%</span>
        </div>
        <div class="task-progress-bar"><div class="task-progress-fill" style="width:${progressPct}%;"></div></div>
      </div>

      <!-- Task Analytics -->
      ${totalAll > 0 ? `
      <div class="task-analytics-strip">
        ${analytics.velocity > 0 ? `<span>⚡ ${analytics.velocity}/wk</span>` : ''}
        ${analytics.avgResolutionHours > 0 ? `<span>⏱ avg ${analytics.avgResolutionHours}h</span>` : ''}
        ${analytics.overdueCount > 0 ? `<span class="text-warning">⚠ ${analytics.overdueCount} overdue</span>` : ''}
        ${analytics.oldestPendingDays > 7 ? `<span class="text-disabled">oldest: ${analytics.oldestPendingDays}d</span>` : ''}
      </div>` : ''}
      
      <!-- Filter bar -->
      <div class="task-filter-bar mb-3" >
        <button class="task-filter-chip${activeFilter === 'pending' ? ' active' : ''}" data-filter="pending">Pending (${pending.length})</button>
        <button class="task-filter-chip${activeFilter === 'priority' ? ' active' : ''}" data-filter="priority">${icons.trendingUp(10)} Priority</button>
        <button class="task-filter-chip${activeFilter === 'done' ? ' active' : ''}" data-filter="done">Done (${done.length})</button>
        <button class="task-filter-chip${activeFilter === 'ignored' ? ' active' : ''}" data-filter="ignored">Ignored (${ignored.length})</button>
        <button class="task-filter-chip${activeFilter === 'all' ? ' active' : ''}" data-filter="all">All (${totalAll})</button>
        <input type="search" id="tasks-search" placeholder="Search tasks..." aria-label="Search tasks" class="task-search-input" />
      </div>

      ${innerCount === 0 ? `
        <div class="rd-empty-state text-xs" >
          No ${activeFilter === 'all' ? '' : activeFilter + ' '}tasks
        </div>` : ''}

      ${_renderObjectiveSummary([...f.takus, ...f.me])}

      ${f.takus.length ? `
        <div class="mb-3">
          <div class="task-section-label">Tasks for Takus</div>
          <div id="global-takus-list">${f.takus.map(t => renderTaskRow(t, 'takus')).join('')}</div>
        </div>` : ''}

      ${f.me.length ? `
        <div>
          <div class="task-section-label">Tasks for Me</div>
          <div id="global-me-list">${f.me.map(t => renderTaskRow(t, 'me')).join('')}</div>
        </div>` : ''}`;
  }

  container.innerHTML = `<div class="card card-compact animate-in" id="global-tasks-card">${renderInner()}</div>`;

  function rebind() {
    const card = container.querySelector('#global-tasks-card');
    if (!card) return;

    // New task form
    _bindNewTaskForm(container, () => renderGlobalTasksPanel(container));

    // Filter chips
    card.querySelectorAll('.task-filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        activeFilter = chip.dataset.filter;
        card.innerHTML = renderInner();
        rebind();
      });
    });

    // In-panel search for tasks
    const searchInput = card.querySelector('#tasks-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        card.querySelectorAll('.global-task-row').forEach(row => {
          const titleEl = row.querySelector('.gt-row-title');
          const titleText = (titleEl?.textContent || '').toLowerCase();
          row.style.display = query && !titleText.includes(query) ? 'none' : '';
        });
      });
    }

    // Mark done
    card.querySelectorAll('.btn-task-done').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.global-task-row');
        if (!row) return;
        const taskId = row.dataset.taskId;

        const output = await promptAsync('What was the output/result?', '') ?? '';
        await updateTask(taskId, { status: 'done', output: output || null });

        // Find task data for signal entry
        const task = allTasksRaw.find(t => t.id === taskId);
        if (task) {
          recordSignal('TASK_ACCEPTED', {
            action: task.action || 'ME_TASK',
            hadDeadline: !!task.deadline,
            closenessScore: task.priority || 0,
            ageHours: task.createdAt ? Math.round((Date.now() - task.createdAt) / MS_PER_HOUR) : 0,
            wasRouted: (task.integrations?.length || 0) > 0,
          }).catch(err => console.warn('[Tasks]', err?.message));
        }

        toast.success('Task done', task ? getTaskTitle(task).slice(0, 40) : '');
        renderGlobalTasksPanel(container);
      });
    });

    // Ignore
    card.querySelectorAll('.task-global-ignore').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.global-task-row');
        if (!row) return;
        const taskId = row.dataset.taskId || btn.dataset.id;

        const reason = await promptAsync('Why are you ignoring this task?', '');
        if (reason === null) return;
        if (!reason.trim()) { toast.warning('Reason required', 'Please provide a reason.'); return; }

        await updateTask(taskId, { status: 'ignored', ignoredReason: reason.trim() });

        const task = allTasksRaw.find(t => t.id === taskId);
        recordSignal('TASK_IGNORED', {
          action: task?.action || 'ME_TASK',
          reason: reason.trim(),
        }).catch(err => console.warn('[Tasks]', err?.message));

        toast.info('Task ignored', reason.trim().slice(0, 40));
        renderGlobalTasksPanel(container);
      });
    });

    // Reopen
    card.querySelectorAll('.task-reopen').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.global-task-row');
        if (!row) return;
        const taskId = row.dataset.taskId || btn.dataset.id;

        await updateTask(taskId, { status: 'pending' });

        toast.info('Task reopened');
        renderGlobalTasksPanel(container);
      });
    });

    // Click task body → open source entry
    card.querySelectorAll('.global-task-body').forEach(body => {
      body.style.cursor = 'pointer';
      body.addEventListener('click', () => {
        const row = body.closest('.global-task-row');
        if (!row) return;
        const sourceEntry = entries.find(r => r.id === row.dataset.contentId);
        if (sourceEntry) {
          document.dispatchEvent(new CustomEvent(OPEN_ENTRY, { detail: { entry: sourceEntry } }));
        }
      });
    });

    // Priority override
    card.querySelectorAll('.task-priority-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const row = btn.closest('.global-task-row');
        if (!row) return;
        const taskId = row.dataset.taskId;

        const task = allTasksRaw.find(t => t.id === taskId);
        if (!task) return;

        const current = task.priorityOverride || getPriorityTier(task.priority || 0);
        const tiers = ['critical', 'high', 'medium', 'low'];
        const choice = await selectAsync(
          `Override priority for this task (currently: ${current})`,
          ['critical', 'high', 'medium', 'low', ''],
          ['Critical', 'High', 'Medium', 'Low', 'Clear override'],
          task.priorityOverride || ''
        );
        if (choice === null) return; // cancelled

        const cleaned = choice.trim().toLowerCase();
        const previousTier = current;

        let newOverride = null;
        if (cleaned === '' || cleaned === getPriorityTier(task.priority || 0)) {
          newOverride = null; // Clear override
        } else if (tiers.includes(cleaned)) {
          newOverride = cleaned;
        } else {
          toast.warning('Invalid priority', `Must be one of: ${tiers.join(', ')}`);
          return;
        }

        await updateTask(taskId, { priorityOverride: newOverride });

        recordSignal('PRIORITY_OVERRIDE', {
          taskId,
          action: task.action || 'ME_TASK',
          previousTier,
          newTier: newOverride || getPriorityTier(task.priority || 0),
          computedScore: task.priority || 0,
        }).catch(err => console.warn('[Tasks]', err?.message));

        toast.success('Priority updated', newOverride ? `Set to ${newOverride}` : 'Override cleared');
        renderGlobalTasksPanel(container);
      });
    });

    // Run sub-step via step executor
    card.querySelectorAll('.step-run-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const row = btn.closest('.global-task-row');
        if (!row) return;
        const taskId = row.dataset.taskId;
        const stepIdx = parseInt(btn.dataset.stepIdx, 10);

        const task = allTasksRaw.find(t => t.id === taskId);
        if (!task?.steps?.[stepIdx]) return;

        const sourceEntry = entryMap.get(task._contentId);
        const step = task.steps[stepIdx];
        btn.disabled = true;
        btn.innerHTML = `<div class="spinner spinner-mini"></div>`;

        const result = await executeStep(step, {
          entry: sourceEntry,
          transcript: sourceEntry?.textContent,
          summary: sourceEntry?.aiSummary,
        });

        if (result.success) {
          step.status = 'completed';
          // Update the steps array in the store
          await updateTask(taskId, { steps: task.steps });
          toast.success('Step completed', step.title || step.type);
        } else {
          toast.error('Step failed', result.error || 'Unknown error');
        }

        renderGlobalTasksPanel(container);
      });
    });

    // ── Batch Mode ──────────────────────────────────────────────

    card.querySelector('#batch-mode-toggle')?.addEventListener('click', () => {
      batchMode = !batchMode;
      batchSelected.clear();
      card.innerHTML = renderInner();
      rebind();
    });

    card.querySelector('#batch-select-all')?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      const pendingIds = pending.map(t => t.id);
      if (checked) {
        pendingIds.forEach(id => batchSelected.add(id));
      } else {
        batchSelected.clear();
      }
      card.innerHTML = renderInner();
      rebind();
    });

    card.querySelectorAll('.batch-task-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) batchSelected.add(cb.dataset.id);
        else batchSelected.delete(cb.dataset.id);
        // Update count + button state without full re-render
        const countEl = card.querySelector('#batch-count');
        if (countEl) countEl.textContent = `${batchSelected.size} selected`;
        const doneBtn = card.querySelector('#batch-done-btn');
        const ignBtn = card.querySelector('#batch-ignore-btn');
        if (doneBtn) doneBtn.disabled = batchSelected.size === 0;
        if (ignBtn) ignBtn.disabled = batchSelected.size === 0;
      });
    });

    card.querySelector('#batch-done-btn')?.addEventListener('click', async () => {
      if (batchSelected.size === 0) return;
      const count = batchSelected.size;
      await Promise.all([...batchSelected].map(id =>
        updateTask(id, { status: 'done', output: `Batch completed (${count} tasks)` })
      ));
      toast.success(`${count} tasks done`, 'Batch operation');
      batchMode = false;
      batchSelected.clear();
      renderGlobalTasksPanel(container);
    });

    card.querySelector('#batch-ignore-btn')?.addEventListener('click', async () => {
      if (batchSelected.size === 0) return;
      const reason = await promptAsync('Reason for ignoring these tasks?', '');
      if (reason === null) return;
      if (!reason.trim()) { toast.warning('Reason required'); return; }
      const count = batchSelected.size;
      await Promise.all([...batchSelected].map(id =>
        updateTask(id, { status: 'ignored', ignoredReason: reason.trim() })
      ));
      toast.info(`${count} tasks ignored`, reason.trim().slice(0, 40));
      batchMode = false;
      batchSelected.clear();
      renderGlobalTasksPanel(container);
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
    <div class="gt-objective-box">
      <div class="gt-objective-label">Active Objectives</div>
      ${entries.map(([obj, c]) => {
        const pct = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
        return `
          <div class="gt-objective-row">
            <span class="flex-1 text-secondary truncate">${esc(obj)}</span>
            <div class="task-objective-track">
              <div class="task-objective-fill" style="width:${pct}%;"></div>
            </div>
            <span class="task-objective-pct">${c.done}/${c.total}</span>
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
    <details class="task-substeps mt-4" >
      <summary class="task-substeps-summary" style="color:${allDone ? 'var(--color-success)' : 'var(--text-disabled)'};">
        ${icons.arrowRight(8)} ${doneCount}/${totalCount} sub-steps ${allDone ? '✓' : ''}
      </summary>
      <div class="task-substeps-list">
        ${task.steps.map((s, i) => {
          const isDone = isStepDone(s);
          const isFailed = s.status === 'failed';
          const isPending = !isDone && !isFailed;
          const statusIcon = isDone ? `<span class="text-success">${icons.check(9)}</span>`
            : isFailed ? `<span class="text-danger">${icons.x(9)}</span>`
            : `<span class="text-disabled">○</span>`;
          const canRun = isPending && s.assignee === 'takus' && s.type && hasHandler(s.type) && !requiresApproval(s);

          return `
            <div class="task-substep-row" data-step-idx="${i}">
              ${statusIcon}
              <span class="flex-1 ${isDone ? 'text-disabled text-strikethrough' : 'text-secondary'}">${esc(s.title || s.type || `Step ${i + 1}`)}</span>
              ${canRun ? `<button class="btn btn-ghost btn-sm step-run-btn step-run-btn-style" data-step-idx="${i}">${icons.zap(8)} Run</button>` : ''}
              ${s.status === 'waiting_input' ? `<span class="text-9-warning">needs approval</span>` : ''}
            </div>`;
        }).join('')}
      </div>
    </details>`;
}

// ── New Task Form ────────────────────────────────────────────────────────────

/** Render the inline new-task form (hidden by default). */
function _renderNewTaskForm() {
  return `
    <div id="new-task-form" class="new-task-form-panel" style="display:none;">
      <div class="flex gap-2 items-start">
        <input type="text" id="new-task-title" aria-label="New task title" placeholder="What needs to be done?"
          class="new-task-input"
          autocomplete="off" />
        <button id="new-task-submit" class="btn btn-primary new-task-submit-btn" disabled>Add</button>
      </div>
      <div class="flex items-center gap-3 mt-2">
        <div class="flex items-center gap-2 text-xs text-muted">
          <span>Assign to:</span>
          <label class="flex-center cursor-pointer gap-1">
            <input type="radio" name="new-task-assignee" value="me" checked />
            <span>Me</span>
          </label>
          <label class="flex-center cursor-pointer gap-1">
            <input type="radio" name="new-task-assignee" value="takus" />
            <span>Takus</span>
          </label>
        </div>
        <button id="new-task-cancel" class="btn btn-ghost new-task-cancel-btn">Cancel</button>
      </div>
    </div>`;
}

/** Bind the new-task form toggle and submission. */
function _bindNewTaskForm(container, onCreated) {
  const form = container.querySelector('#new-task-form');
  if (!form) return;

  // Toggle buttons — either from header or empty state
  const headerBtn = container.querySelector('#create-task-header-btn');
  const emptyBtn = container.querySelector('#create-task-empty-btn');
  const titleInput = form.querySelector('#new-task-title');
  const submitBtn = form.querySelector('#new-task-submit');
  const cancelBtn = form.querySelector('#new-task-cancel');

  function showForm() {
    form.style.display = '';
    titleInput?.focus();
  }

  function hideForm() {
    form.style.display = 'none';
    if (titleInput) titleInput.value = '';
    if (submitBtn) submitBtn.disabled = true;
  }

  headerBtn?.addEventListener('click', showForm);
  emptyBtn?.addEventListener('click', showForm);
  cancelBtn?.addEventListener('click', hideForm);

  // Enable submit when title is non-empty
  titleInput?.addEventListener('input', () => {
    if (submitBtn) submitBtn.disabled = !titleInput.value.trim();
  });

  // Enter to submit
  titleInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && titleInput.value.trim()) {
      e.preventDefault();
      submitBtn?.click();
    }
    if (e.key === 'Escape') {
      hideForm();
    }
  });

  // Submit
  submitBtn?.addEventListener('click', async () => {
    const title = titleInput?.value?.trim();
    if (!title) return;

    const assigneeRadio = form.querySelector('input[name="new-task-assignee"]:checked');
    const assignee = assigneeRadio?.value || 'me';

    submitBtn.disabled = true;
    submitBtn.textContent = '…';

    try {
      const { createTask } = await import('../lib/graph/task-store.js');
      await createTask({
        title,
        assignee,
        action: assignee === 'takus' ? 'TAKUS_TASK' : 'ME_TASK',
        status: 'pending',
      });

      toast.success('Task created', title.slice(0, 40));
      hideForm();
      if (onCreated) onCreated();
    } catch (err) {
      toast.error('Failed to create task', err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Add';
    }
  });
}
