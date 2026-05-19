
// Dual-pane view with rich status model (pending/done/ignored), dependencies, and integration routing.
import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import { promptAsync } from '../lib/dialog-utils.js';
import { toast } from './toast.js';
import { getIntegrationConfig } from './connect-panel.js';
import { postToSlack, buildSlackPayload } from '../lib/integrations/slack.js';
import { createGitHubIssue, buildGitHubIssuePayload } from '../lib/integrations/github.js';
import { createLinearIssue, buildLinearIssuePayload } from '../lib/integrations/linear.js';
import { getJiraConfig, createJiraIssue, buildJiraIssuePayload } from '../lib/integrations/jira.js';
import { getNotionConfig, createNotionPage, buildNotionPayload } from '../lib/integrations/notion.js';
import { normalizeTask } from '../lib/ai-engine.js';
import { isStepDone, getStepDoneCount, isTaskPending, getTaskTitle } from '../lib/task-helpers.js';
import { recordSignal } from '../lib/preference-engine.js';

// Integration icon map for task chips
const INTEGRATION_ICONS = {
  slack:    { label: 'Slack',    icon: (s) => icons.send(s),     color: '#10b981' },
  github:   { label: 'GitHub',   icon: (s) => icons.terminal(s), color: '#8b5cf6' },
  linear:   { label: 'Linear',   icon: (s) => icons.zap(s),      color: '#5e6ad2' },
  jira:     { label: 'Jira',     icon: (s) => icons.flag(s),      color: '#0052cc' },
  notion:   { label: 'Notion',   icon: (s) => icons.bookOpen(s),  color: '#999' },
  calendar: { label: 'Calendar', icon: (s) => icons.calendar(s),  color: '#10b981' },
  email:    { label: 'Email',    icon: (s) => icons.send(s),      color: '#0ea5e9' },
  drive:    { label: 'Drive',    icon: (s) => icons.cloud(s),     color: '#f59e0b' },
};



const ACTION_LABELS = {
  CREATE_BUG_REPORT:    { label: 'Bug Report',     color: '#ef4444', icon: (s) => icons.terminal(s) },
  LOG_DECISION:         { label: 'Log Decision',   color: '#7c3aed', icon: (s) => icons.checkSquare(s) },
  DRAFT_SHARE_MESSAGE:  { label: 'Draft Message',  color: '#0ea5e9', icon: (s) => icons.send(s) },
  UPDATE_TICKET:        { label: 'Update Ticket',  color: '#f59e0b', icon: (s) => icons.arrowRight(s) },
  DRAFT_SLACK_MESSAGE:  { label: 'Slack Message',  color: '#10b981', icon: (s) => icons.send(s) },
  CREATE_CALENDAR_EVENT:{ label: 'Calendar Event', color: '#10b981', icon: (s) => icons.calendar(s) },
  DRAFT_EMAIL:          { label: 'Draft Email',    color: '#0ea5e9', icon: (s) => icons.send(s) },
  UPLOAD_TO_DRIVE:      { label: 'Upload to Drive', color: '#f59e0b', icon: (s) => icons.cloud(s) },
  TAKUS_TASK:           { label: 'Task',            color: '#6b7280', icon: (s) => icons.zap(s) },
  ME_TASK:              { label: 'Personal',        color: '#6b7280', icon: (s) => icons.checkSquare(s) },
  CHAT_TASK:            { label: 'Chat',            color: '#8b5cf6', icon: (s) => icons.messageSquare(s) },
  CHAT_EXTRACTED:       { label: 'Extracted',        color: '#06b6d4', icon: (s) => icons.search(s) },
};

function _actionMeta(action) {
  return ACTION_LABELS[action] || ACTION_LABELS.TAKUS_TASK;
}

/**
 * Renders the tasks tab content into `container`.
 * @param {HTMLElement} container
 * @param {object} entry  Full entry object from IndexedDB
 * @param {Function} onUpdate Called with updated entry after a task state change
 */
export async function renderTasksPanel(container, entry, onUpdate) {
  // Load tasks from graph nodes store
  let allTasks = [];
  try {
    const { getTasksByContent } = await import('../lib/graph/task-store.js');
    allTasks = await getTasksByContent(entry.id);
  } catch (e) { console.warn('[Tasks] Failed to load tasks:', e.message); }

  const takus = allTasks.filter(t => t.assignee === 'takus');
  const me = allTasks.filter(t => t.assignee === 'me');
  const obsLog = entry.observerLog || null;

  if (!takus.length && !me.length) {
    container.innerHTML = `
      <div style="padding:var(--space-4);text-align:center;color:var(--color-text-muted);font-size:var(--font-sm);">
        ${icons.zap(24)}
        <p style="margin-top:var(--space-2);">No tasks for this entry.</p>
        <p style="font-size:var(--font-xs);color:var(--color-text-disabled);margin-top:var(--space-1);">Tasks are extracted from entries with speech or text content.</p>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="tasks-panes">

      ${takus.length ? `
      <!-- Tasks for Takus -->
      <div class="tasks-section">
        <div class="tasks-section-header">
          ${icons.bot(14)}
          <span>Tasks for Takus</span>
          <span class="tasks-count">${takus.filter(t => t.status === 'pending').length} pending</span>
        </div>
        <div class="tasks-list" data-pane="takus">
          ${takus.map(t => _renderTakusTask(t, allTasks)).join('')}
        </div>
      </div>` : ''}

      ${me.length ? `
      <!-- Tasks for Me -->
      <div class="tasks-section">
        <div class="tasks-section-header">
          ${icons.users(14)}
          <span>Tasks for Me</span>
          <span class="tasks-count">${me.filter(t => t.status === 'pending').length} pending</span>
        </div>
        <div class="tasks-list" data-pane="me">
          ${me.map(t => _renderMeTask(t, allTasks)).join('')}
        </div>
      </div>` : ''}

      ${obsLog && (obsLog.consoleErrors?.length || obsLog.networkErrors?.length) ? `
      <!-- Observer log summary -->
      <details class="tasks-obs-log">
        <summary style="cursor:pointer;font-size:var(--font-xs);color:var(--color-text-muted);padding:var(--space-2) 0;display:flex;align-items:center;gap:var(--space-2);list-style:none;">
          ${icons.terminal(12)}
          ${obsLog.consoleErrors?.length || 0} console error${(obsLog.consoleErrors?.length || 0) !== 1 ? 's' : ''},
          ${obsLog.networkErrors?.length || 0} network error${(obsLog.networkErrors?.length || 0) !== 1 ? 's' : ''} captured
        </summary>
        <div style="margin-top:var(--space-2);display:flex;flex-direction:column;gap:var(--space-1);">
          ${(obsLog.consoleErrors || []).slice(0, 5).map(e => `
            <div style="font-size:10px;font-family:monospace;background:rgba(239,68,68,0.07);border-left:2px solid rgba(239,68,68,0.4);padding:3px 6px;border-radius:0 3px 3px 0;color:var(--color-text-secondary);word-break:break-all;">
              [${esc(e.level)}] ${esc(e.message)}
            </div>`).join('')}
          ${(obsLog.networkErrors || []).slice(0, 5).map(e => `
            <div style="font-size:10px;font-family:monospace;background:rgba(245,158,11,0.07);border-left:2px solid rgba(245,158,11,0.4);padding:3px 6px;border-radius:0 3px 3px 0;color:var(--color-text-secondary);word-break:break-all;">
              ${esc(e.method)} ${esc(e.url)} → ${esc(String(e.status))}
            </div>`).join('')}
        </div>
      </details>` : ''}

    </div>`;

  // ── Bind handlers ──────────────────────────────────────────────────────────

  // Me-task "mark done" buttons
  container.querySelectorAll('.task-me-done').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const task = me.find(t => t.id === id);
      if (!task) return;
      const output = await promptAsync('What was the output/result?', '') ?? '';
      task.status = 'done';
      task.output = output || null;
      task.doneAt = Date.now();
      try {
        const { updateTask } = await import('../lib/graph/task-store.js');
        await updateTask(id, { status: 'done', output: task.output });
      } catch (e) { console.warn('[Tasks] Failed to persist:', e.message); toast.error('Save failed', 'Task change may not persist'); }
      if (onUpdate) onUpdate(entry);
      renderTasksPanel(container, entry, onUpdate);
      toast.success('Task done', getTaskTitle(task).slice(0, 40));
      recordSignal('TASK_EDITED', { action: 'done', taskId: id, taskType: 'me' }).catch(() => {});
    });
  });

  // Me-task "ignore" buttons
  container.querySelectorAll('.task-me-ignore').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const task = me.find(t => t.id === id);
      if (!task) return;
      const reason = await promptAsync('Why are you ignoring this task?', '');
      if (reason === null) return; // cancelled
      if (!reason.trim()) { toast.warning('Reason required', 'Please provide a reason for ignoring.'); return; }
      task.status = 'ignored';
      task.ignoredReason = reason.trim();
      task.ignoredAt = Date.now();
      try {
        const { updateTask } = await import('../lib/graph/task-store.js');
        await updateTask(id, { status: 'ignored', ignoredReason: task.ignoredReason });
      } catch (e) { console.warn('[Tasks] Failed to persist:', e.message); toast.error('Save failed', 'Task change may not persist'); }
      if (onUpdate) onUpdate(entry);
      renderTasksPanel(container, entry, onUpdate);
      toast.info('Task ignored', reason.trim().slice(0, 40));
      recordSignal('TASK_EDITED', { action: 'ignored', taskId: id, taskType: 'me' }).catch(() => {});
    });
  });

  // Reopen (done/ignored → pending)
  container.querySelectorAll('.task-reopen').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const task = allTasks.find(t => t.id === id);
      if (!task) return;
      task.status = 'pending';
      task.output = null;
      task.ignoredReason = null;
      task.doneAt = null;
      task.ignoredAt = null;
      try {
        const { updateTask } = await import('../lib/graph/task-store.js');
        await updateTask(id, { status: 'pending' });
      } catch (e) { console.warn('[Tasks] Failed to persist:', e.message); toast.error('Save failed', 'Task change may not persist'); }
      if (onUpdate) onUpdate(entry);
      renderTasksPanel(container, entry, onUpdate);
      toast.info('Task reopened');
      recordSignal('TASK_EDITED', { action: 'reopened', taskId: id }).catch(() => {});
    });
  });

  // Takus-task action buttons
  container.querySelectorAll('.task-takus-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const task = takus.find(t => t.id === id);
      if (!task) return;
      const result = await _handleTakusAction(task, entry);
      // Auto-mark done after successful integration run
      if (result) {
        task.status = 'done';
        task.output = typeof result === 'string' ? result : 'Completed via integration';
        task.doneAt = Date.now();
        try {
          const { updateTask } = await import('../lib/graph/task-store.js');
          await updateTask(task.id, { status: 'done', output: task.output });
        } catch (e) { console.warn('[Tasks] Failed to persist:', e.message); toast.error('Save failed', 'Task change may not persist'); }
        if (onUpdate) onUpdate(entry);
        renderTasksPanel(container, entry, onUpdate);
      }
    });
  });

  // Takus-task dismiss (mark done manually)
  container.querySelectorAll('.task-takus-dismiss').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const task = takus.find(t => t.id === id);
      if (!task) return;
      const output = await promptAsync('What was the output/result? (optional)', '') ?? '';
      task.status = 'done';
      task.output = output || null;
      task.doneAt = Date.now();
      try {
        const { updateTask } = await import('../lib/graph/task-store.js');
        await updateTask(id, { status: 'done', output: task.output });
      } catch (e) { console.warn('[Tasks] Failed to persist:', e.message); toast.error('Save failed', 'Task change may not persist'); }
      if (onUpdate) onUpdate(entry);
      renderTasksPanel(container, entry, onUpdate);
      toast.success('Task done', getTaskTitle(task).slice(0, 40));
    });
  });

  // Takus-task ignore
  container.querySelectorAll('.task-takus-ignore').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const task = takus.find(t => t.id === id);
      if (!task) return;
      const reason = await _promptAsync('Why are you ignoring this task?', '');
      if (reason === null) return;
      if (!reason.trim()) { toast.warning('Reason required', 'Please provide a reason.'); return; }
      task.status = 'ignored';
      task.ignoredReason = reason.trim();
      task.ignoredAt = Date.now();
      try {
        const { updateTask } = await import('../lib/graph/task-store.js');
        await updateTask(id, { status: 'ignored', ignoredReason: task.ignoredReason });
      } catch (e) { console.warn('[Tasks] Failed to persist:', e.message); toast.error('Save failed', 'Task change may not persist'); }
      if (onUpdate) onUpdate(entry);
      renderTasksPanel(container, entry, onUpdate);
      toast.info('Task ignored', reason.trim().slice(0, 40));
    });
  });

  // Step checkbox toggle
  container.querySelectorAll('.task-step-check').forEach(cb => {
    cb.addEventListener('change', async () => {
      const label = cb.closest('.task-step');
      if (!label) return;
      const taskId = label.dataset.taskId;
      const stepIdx = parseInt(label.dataset.stepIdx, 10);
      const task = allTasks.find(t => t.id === taskId);
      if (!task?.steps?.[stepIdx]) return;
      task.steps[stepIdx].status = cb.checked ? 'completed' : 'pending';
      try {
        const { updateTask } = await import('../lib/graph/task-store.js');
        await updateTask(taskId, { steps: task.steps });
      } catch (e) { console.warn('[Tasks] Failed to persist:', e.message); toast.error('Save failed', 'Step change may not persist'); }
      if (onUpdate) onUpdate(entry);
      renderTasksPanel(container, entry, onUpdate);
    });
  });
}

function _renderTakusTask(t, allTasks) {
  const meta = _actionMeta(t.action);
  const status = t.status || 'pending';
  const isBlocked = _isBlocked(t, allTasks);
  const statusClass = status === 'done' ? ' task-status-done' : status === 'ignored' ? ' task-status-ignored' : isBlocked ? ' task-status-blocked' : '';

  const seqBadge = t.sequence ? `<span class="task-sequence-badge">${t.sequence}</span>` : '';
  const depChips = _renderDepChips(t, allTasks);
  const integChips = (t.integrations || []).map(ig => {
    const m = INTEGRATION_ICONS[ig];
    if (!m) return '';
    return `<span class="task-integration-chip" style="color:${m.color};" title="${m.label}">${m.icon(10)}</span>`;
  }).join('');

  return `
    <div class="task-row${statusClass}" data-id="${esc(t.id)}">
      <div style="display:flex;align-items:flex-start;gap:var(--space-2);flex:1;min-width:0;">
        ${seqBadge}
        <span style="color:${meta.color};flex-shrink:0;margin-top:1px;">${meta.icon(14)}</span>
        <div style="min-width:0;flex:1;">
          <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;">
            <span class="task-action-badge" style="color:${meta.color};background:${meta.color}18;">${esc(meta.label)}</span>
            ${t.contextTimestamp ? `<span style="font-size:10px;color:var(--color-text-disabled);">${icons.clock(10)} ${esc(t.contextTimestamp)}</span>` : ''}
            ${integChips ? `<span style="display:inline-flex;gap:3px;align-items:center;">${integChips}</span>` : ''}
          </div>
          <div style="font-size:var(--font-xs);color:var(--color-text-secondary);margin-top:2px;">${esc(getTaskTitle(t))}</div>
          ${_renderPayloadHints(t)}
          ${_renderObjective(t)}
          ${_renderSteps(t)}
          ${depChips}
          ${status === 'done' && t.output ? `<div class="task-output">${icons.check(10)} ${esc(t.output)}</div>` : ''}
          ${status === 'ignored' && t.ignoredReason ? `<div class="task-ignored-reason">${icons.x(10)} ${esc(t.ignoredReason)}</div>` : ''}
        </div>
      </div>
      ${status === 'pending' && !isBlocked ? `
      <div style="display:flex;gap:var(--space-1);flex-shrink:0;">
        <button class="btn btn-ghost btn-sm task-takus-action" data-id="${esc(t.id)}" style="font-size:10px;padding:2px 7px;white-space:nowrap;">${icons.arrowRight(11)} Run</button>
        <button class="btn btn-ghost btn-icon btn-sm task-takus-dismiss" data-id="${esc(t.id)}" title="Mark done" style="color:var(--color-success);">${icons.check(12)}</button>
        <button class="btn btn-ghost btn-icon btn-sm task-takus-ignore" data-id="${esc(t.id)}" title="Ignore" style="color:var(--color-warning);">${icons.x(12)}</button>
      </div>` : status === 'pending' && isBlocked ? `
      <span style="font-size:10px;color:var(--color-text-disabled);">${icons.shield(12)} Blocked</span>` : `
      <button class="btn btn-ghost btn-icon btn-sm task-reopen" data-id="${esc(t.id)}" title="Reopen">${icons.refresh(12)}</button>`}
    </div>`;
}

function _renderMeTask(t, allTasks) {
  const status = t.status || 'pending';
  const urgent = t.urgency === 'high';
  const isBlocked = _isBlocked(t, allTasks);
  const statusClass = status === 'done' ? ' task-status-done' : status === 'ignored' ? ' task-status-ignored' : isBlocked ? ' task-status-blocked' : '';
  const seqBadge = t.sequence ? `<span class="task-sequence-badge">${t.sequence}</span>` : '';
  const depChips = _renderDepChips(t, allTasks);

  return `
    <div class="task-row${statusClass}" data-id="${esc(t.id)}">
      <div style="display:flex;align-items:flex-start;gap:var(--space-2);flex:1;min-width:0;">
        ${seqBadge}
        <div style="min-width:0;flex:1;">
          <div style="font-size:var(--font-xs);color:var(--color-text-secondary);">${esc(getTaskTitle(t))}</div>
          <div style="display:flex;align-items:center;gap:var(--space-2);margin-top:2px;flex-wrap:wrap;">
            ${urgent ? `<span style="font-size:9px;font-weight:600;color:var(--color-danger);background:rgba(239,68,68,0.12);padding:1px 5px;border-radius:4px;">${icons.flag(9)} High priority</span>` : ''}
            ${t.contextTimestamp ? `<span style="font-size:10px;color:var(--color-text-disabled);">${icons.clock(10)} ${esc(t.contextTimestamp)}</span>` : ''}
          </div>
          ${depChips}
          ${_renderObjective(t)}
          ${_renderSteps(t)}
          ${status === 'done' && t.output ? `<div class="task-output">${icons.check(10)} ${esc(t.output)}</div>` : ''}
          ${status === 'ignored' && t.ignoredReason ? `<div class="task-ignored-reason">${icons.x(10)} ${esc(t.ignoredReason)}</div>` : ''}
        </div>
      </div>
      ${status === 'pending' && !isBlocked ? `
      <div style="display:flex;gap:var(--space-1);flex-shrink:0;">
        <button class="btn btn-ghost btn-icon btn-sm task-me-done" data-id="${esc(t.id)}" title="Mark done" style="color:var(--color-success);">${icons.check(12)}</button>
        <button class="btn btn-ghost btn-icon btn-sm task-me-ignore" data-id="${esc(t.id)}" title="Ignore" style="color:var(--color-warning);">${icons.x(12)}</button>
      </div>` : status === 'pending' && isBlocked ? `
      <span style="font-size:10px;color:var(--color-text-disabled);">${icons.shield(12)} Blocked</span>` : `
      <button class="btn btn-ghost btn-icon btn-sm task-reopen" data-id="${esc(t.id)}" title="Reopen">${icons.refresh(12)}</button>`}
    </div>`;
}

function _renderPayloadHints(t) {
  const p = t.payload || {};
  const hints = [];
  if (p.title)       hints.push(esc(p.title));
  if (p.priority)    hints.push(`Priority: ${esc(p.priority)}`);
  if (p.ticketId)    hints.push(esc(p.ticketId));
  if (!hints.length) return '';
  return `<div class="task-row-meta">${hints.join(' · ')}</div>`;
}

/** Render the objective this task connects to */
function _renderObjective(t) {
  if (!t.objective) return '';
  return `<div class="task-objective">${icons.arrowRight(9)} ${esc(t.objective)}</div>`;
}

/** Render sub-steps as an inline checklist */
function _renderSteps(t) {
  if (!t.steps?.length) return '';
  const doneCount = getStepDoneCount(t);
  const total = t.steps.length;
  const allDone = doneCount === total;
  const rows = t.steps.map((s, i) => {
    const text = typeof s === 'string' ? s : s.text;
    return `
    <label class="task-step${isStepDone(s) ? ' step-done' : ''}" data-task-id="${esc(t.id)}" data-step-idx="${i}">
      <input type="checkbox" ${isStepDone(s) ? 'checked' : ''} class="task-step-check" />
      <span>${esc(text)}</span>
    </label>`;
  }).join('');
  return `
    <div class="task-steps-container">
      <div class="task-steps-header">
        <span class="task-steps-counter${allDone ? ' all-done' : ''}">${doneCount}/${total} steps</span>
      </div>
      ${rows}
    </div>`;
}

/** Check if a task's dependencies are all resolved */
function _isBlocked(task, allTasks) {
  if (!task.dependsOn?.length) return false;
  return task.dependsOn.some(depId => {
    const dep = allTasks.find(t => t.id === depId);
    return dep && dep.status === 'pending';
  });
}

/** Render dependency chip badges */
function _renderDepChips(task, allTasks) {
  if (!task.dependsOn?.length) return '';
  const chips = task.dependsOn.map(depId => {
    const dep = allTasks.find(t => t.id === depId);
    if (!dep) return '';
    const resolved = dep.status !== 'pending';
    const label = getTaskTitle(dep, depId);
    return `<span class="task-dep-chip${resolved ? ' resolved' : ''}" title="${esc(label)}">${icons.shield(8)} ${esc(label.slice(0, 25))}${label.length > 25 ? '…' : ''}</span>`;
  }).filter(Boolean).join('');
  return chips ? `<div class="task-row-meta" style="margin-top:3px;gap:3px;">${chips}</div>` : '';
}

async function _handleTakusAction(task, entry) {
  switch (task.action) {
    case 'DRAFT_SLACK_MESSAGE':
    case 'DRAFT_SHARE_MESSAGE':
      return await _runSlack(task, entry);
    case 'CREATE_BUG_REPORT':
      return await _runBugReport(task, entry);
    case 'UPDATE_TICKET':
      return await _runTicketUpdate(task, entry);
    case 'LOG_DECISION':
      return await _logDecision(task, entry);
    case 'CREATE_CALENDAR_EVENT':
      _openCalendarLink(task);
      return 'Calendar event opened';
    case 'DRAFT_EMAIL':
      _openEmailDraft(task, entry);
      return 'Email draft opened';
    case 'UPLOAD_TO_DRIVE':
      _copyDriveNote(task, entry);
      return null;
    default:
      _copyTaskPayload(task);
      return null;
  }
}

// ── Integration-aware action handlers ────────────────────────────────────────

function _taskBtn(task, entry) {
  // Scope lookup to the specific entry's tasks pane so multiple open
  // history items with identically-named task IDs don't cross-contaminate.
  const pane = document.querySelector(`.ai-tab-content[data-tab="tasks"][data-id="${entry.id}"]`);
  return (pane || document).querySelector(`.task-takus-action[data-id="${esc(task.id)}"]`);
}

async function _runSlack(task, entry) {
  const cfg = await getIntegrationConfig('slack');
  if (cfg.configured) {
    const btn = _taskBtn(task, entry);
    _setBtnLoading(btn, true);
    try {
      const payload = buildSlackPayload(task, entry);
      await postToSlack(cfg.webhookUrl, payload);
      toast.success('Sent to Slack', getTaskTitle(task));
      return 'Sent to Slack';
    } catch (e) {
      toast.error('Slack failed', e.message);
      return null;
    } finally {
      _setBtnLoading(btn, false);
    }
  } else {
    const p = task.payload || {};
    _copy(p.message || p.text || getTaskTitle(task), 'Draft copied — connect Slack to send directly');
    _promptConnect('Slack');
    return null;
  }
}

async function _runBugReport(task, entry) {
  // Priority chain: Jira → GitHub → Linear → clipboard
  const [jira, gh, lin] = await Promise.all([
    getJiraConfig(),
    getIntegrationConfig('github'),
    getIntegrationConfig('linear'),
  ]);

  if (jira.configured) {
    const btn = _taskBtn(task, entry);
    _setBtnLoading(btn, true);
    try {
      const issue = buildJiraIssuePayload(task, entry);
      issue.issueType = 'Bug';
      const result = await createJiraIssue(jira, issue);
      if (result.error) throw new Error(result.error);
      toast.success('Jira bug created', `${result.key}`);
      _openUrl(result.url);
      return `Jira: ${result.key}`;
    } catch (e) {
      toast.error('Jira failed', e.message);
      return null;
    } finally {
      _setBtnLoading(btn, false);
    }
  }

  if (gh.configured) {
    const btn = _taskBtn(task, entry);
    _setBtnLoading(btn, true);
    try {
      const issue = buildGitHubIssuePayload(task, entry);
      const result = await createGitHubIssue(gh.token, gh.owner, gh.repo, issue);
      toast.success('GitHub issue created', `#${result.number} — ${result.url}`);
      _openUrl(result.url);
      return `GitHub #${result.number}`;
    } catch (e) {
      toast.error('GitHub failed', e.message);
      return null;
    } finally {
      _setBtnLoading(btn, false);
    }
  }

  if (lin.configured) {
    const btn = _taskBtn(task, entry);
    _setBtnLoading(btn, true);
    try {
      const issue = buildLinearIssuePayload(task, entry);
      const result = await createLinearIssue(lin.apiKey, lin.teamId, issue);
      toast.success('Linear issue created', `${result.identifier} — ${result.url}`);
      _openUrl(result.url);
      return `Linear: ${result.identifier}`;
    } catch (e) {
      toast.error('Linear failed', e.message);
      return null;
    } finally {
      _setBtnLoading(btn, false);
    }
  }

  // Fallback: clipboard
  const p = task.payload || {};
  const lines = [
    `**Bug Report: ${getTaskTitle(task)}**`, '',
    p.steps     ? `Steps to reproduce:\n${p.steps}` : '',
    p.expected  ? `Expected: ${p.expected}` : '',
    p.actual    ? `Actual: ${p.actual}` : '',
    p.error_log ? `\nConsole error:\n\`${p.error_log}\`` : '',
    entry.driveLink ? `\nSource: ${entry.driveLink}` : '',
    task.contextTimestamp ? `Timestamp: ${task.contextTimestamp}` : '',
  ].filter(Boolean).join('\n');
  _copy(lines, 'Bug report copied — connect Jira, GitHub, or Linear to file directly');
  _promptConnect('Jira, GitHub, or Linear');
  return null;
}

async function _runTicketUpdate(task, entry) {
  // Priority chain: Jira → Linear → clipboard
  const [jira, lin] = await Promise.all([
    getJiraConfig(),
    getIntegrationConfig('linear'),
  ]);

  if (jira.configured) {
    const btn = _taskBtn(task, entry);
    _setBtnLoading(btn, true);
    try {
      const issue = buildJiraIssuePayload(task, entry);
      const result = await createJiraIssue(jira, issue);
      if (result.error) throw new Error(result.error);
      toast.success('Jira issue created', `${result.key}`);
      _openUrl(result.url);
      return `Jira: ${result.key}`;
    } catch (e) {
      toast.error('Jira failed', e.message);
      return null;
    } finally {
      _setBtnLoading(btn, false);
    }
  }

  if (lin.configured) {
    const btn = _taskBtn(task, entry);
    _setBtnLoading(btn, true);
    try {
      const issue = buildLinearIssuePayload(task, entry);
      const result = await createLinearIssue(lin.apiKey, lin.teamId, issue);
      toast.success('Linear issue created', `${result.identifier}`);
      _openUrl(result.url);
      return `Linear: ${result.identifier}`;
    } catch (e) {
      toast.error('Linear failed', e.message);
      return null;
    } finally {
      _setBtnLoading(btn, false);
    }
  }

  const p = task.payload || {};
  const id = p.ticketId || p.id || '';
  _copy(
    `${id ? id + ': ' : ''}${getTaskTitle(task)}${entry.driveLink ? `\nSource: ${entry.driveLink}` : ''}`,
    'Ticket update copied — connect Jira or Linear to file directly',
  );
  _promptConnect('Jira or Linear');
  return null;
}

async function _logDecision(task, entry) {
  const notion = await getNotionConfig();
  if (notion.configured) {
    const btn = _taskBtn(task, entry);
    _setBtnLoading(btn, true);
    try {
      const { title, content } = buildNotionPayload(task, entry);
      const result = await createNotionPage(notion, { title, content });
      if (result.error) throw new Error(result.error);
      toast.success('Logged to Notion', title);
      if (result.url) _openUrl(result.url);
      return `Notion: ${title}`;
    } catch (e) {
      toast.error('Notion failed', e.message);
      return null;
    } finally {
      _setBtnLoading(btn, false);
    }
  }
  // Fallback: clipboard
  _copyDecision(task);
  return null;
}

function _copyDecision(task) {
  const p = task.payload || {};
  const text = `Decision: ${p.decision || getTaskTitle(task)}\nOwner: ${p.owner || '—'}\nDate: ${new Date().toLocaleDateString()}${task.contextTimestamp ? `\nTimestamp: ${task.contextTimestamp}` : ''}`;
  _copy(text, 'Decision copied — connect Notion to log directly');
  _promptConnect('Notion');
}

function _openCalendarLink(task) {
  const p = task.payload || {};
  const title = encodeURIComponent(p.title || getTaskTitle(task));
  window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}`, '_blank', 'noopener');
  toast.success('Opening calendar', 'Prefilled with task title');
}

function _openEmailDraft(task, entry) {
  const p = task.payload || {};
  const to = encodeURIComponent(p.to || '');
  const subject = encodeURIComponent(p.subject || getTaskTitle(task));
  const body = encodeURIComponent(
    [p.body || p.message || getTaskTitle(task), '', entry.driveLink ? `Source: ${entry.driveLink}` : ''].filter(Boolean).join('\n')
  );
  window.open(`mailto:${to}?subject=${subject}&body=${body}`, '_self');
  toast.success('Opening email', 'Draft prefilled');
}

function _copyDriveNote(task, entry) {
  const p = task.payload || {};
  const text = [
    p.filename || getTaskTitle(task),
    p.folder ? `Folder: ${p.folder}` : '',
    entry.driveLink ? `Source: ${entry.driveLink}` : '',
    task.contextTimestamp ? `Timestamp: ${task.contextTimestamp}` : '',
  ].filter(Boolean).join('\n');
  _copy(text, 'Drive note copied — use Google Drive to upload');
}

function _copyTaskPayload(task) {
  _copy(JSON.stringify(task.payload || {}, null, 2), 'Task details copied');
}

function _copy(text, message) {
  if (!navigator.clipboard) { toast.info('Copy failed', 'Clipboard not available'); return; }
  navigator.clipboard.writeText(text).then(
    () => toast.success('Copied', message),
    () => toast.info('Copy failed', 'Clipboard not available'),
  );
}

function _openUrl(url) {
  window.open(url, '_blank', 'noopener');
}

function _promptConnect(integrationName) {
  toast.info(
    `Connect ${integrationName}`,
    'Open Settings → Connect to set up the integration.',
  );
}

function _setBtnLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.dataset.origHtml = btn.innerHTML;
    btn.innerHTML = `<div class="spinner" style="width:10px;height:10px;border-width:2px;"></div>`;
    btn.disabled = true;
  } else {
    if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
    btn.disabled = false;
  }
}

/**
 * Returns a count of pending tasks for the history item badge.
 * Uses the task-store API to look up from graph nodes.
 */
export async function tasksBadge(entryId) {
  try {
    const { getTasksByContent } = await import('../lib/graph/task-store.js');
    const tasks = await getTasksByContent(entryId);
    const open = tasks.filter(t => t.status === 'pending').length;
    return open;
  } catch { return 0; }
}
