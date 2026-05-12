// Takus — Tasks Panel (Phase 1: The Scribe / Phase 3: Connect)
// Dual-pane view: "Tasks for Takus" (automated workflows) + "Tasks for Me" (personal follow-ups).
// Phase 3: "Run" buttons route to configured integrations before falling back to clipboard copy.
import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import { saveRecording } from '../lib/storage.js';
import { toast } from './toast.js';
import { getIntegrationConfig, openConnectModal } from './connect-panel.js';
import { postToSlack, buildSlackPayload } from '../lib/integrations/slack.js';
import { createGitHubIssue, buildGitHubIssuePayload } from '../lib/integrations/github.js';
import { createLinearIssue, buildLinearIssuePayload } from '../lib/integrations/linear.js';



const ACTION_LABELS = {
  CREATE_BUG_REPORT:    { label: 'Bug Report',     color: '#ef4444', icon: (s) => icons.terminal(s) },
  LOG_DECISION:         { label: 'Log Decision',   color: '#7c3aed', icon: (s) => icons.checkSquare(s) },
  DRAFT_SHARE_MESSAGE:  { label: 'Draft Message',  color: '#0ea5e9', icon: (s) => icons.send(s) },
  UPDATE_TICKET:        { label: 'Update Ticket',  color: '#f59e0b', icon: (s) => icons.arrowRight(s) },
  DRAFT_SLACK_MESSAGE:  { label: 'Slack Message',  color: '#10b981', icon: (s) => icons.send(s) },
  CREATE_CALENDAR_EVENT:{ label: 'Calendar Event', color: '#10b981', icon: (s) => icons.calendar(s) },
  TAKUS_TASK:           { label: 'Task',            color: '#6b7280', icon: (s) => icons.zap(s) },
};

function _actionMeta(action) {
  return ACTION_LABELS[action] || ACTION_LABELS.TAKUS_TASK;
}

/**
 * Renders the tasks tab content into `container`.
 * @param {HTMLElement} container
 * @param {object} recording  Full recording object from IndexedDB
 * @param {Function} onUpdate Called with updated recording after a task state change
 */
export function renderTasksPanel(container, recording, onUpdate) {
  const tasks = recording.tasks || { takusTasks: [], meTasks: [] };
  const takus  = tasks.takusTasks || [];
  const me     = tasks.meTasks    || [];
  const obsLog = recording.observerLog || null;

  if (!takus.length && !me.length) {
    container.innerHTML = `
      <div style="padding:var(--space-4);text-align:center;color:var(--color-text-muted);font-size:var(--font-sm);">
        ${icons.zap(24)}
        <p style="margin-top:var(--space-2);">No tasks extracted for this recording.</p>
        <p style="font-size:var(--font-xs);color:var(--color-text-disabled);margin-top:var(--space-1);">Tasks are generated from recordings with audible speech.</p>
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
          <span class="tasks-count">${takus.filter(t => !t.done).length} open</span>
        </div>
        <div class="tasks-list" data-pane="takus">
          ${takus.map(t => _renderTakusTask(t)).join('')}
        </div>
      </div>` : ''}

      ${me.length ? `
      <!-- Tasks for Me -->
      <div class="tasks-section">
        <div class="tasks-section-header">
          ${icons.users(14)}
          <span>Tasks for Me</span>
          <span class="tasks-count">${me.filter(t => !t.done).length} open</span>
        </div>
        <div class="tasks-list" data-pane="me">
          ${me.map(t => _renderMeTask(t)).join('')}
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

  // Me-task checkboxes
  container.querySelectorAll('.task-me-check').forEach(cb => {
    cb.addEventListener('change', async () => {
      const id = cb.dataset.id;
      const task = me.find(t => t.id === id);
      if (!task) return;
      task.done = cb.checked;
      _updateRowDoneState(cb.closest('.task-row'), task.done);
      const updated = { ...recording, tasks: { takusTasks: takus, meTasks: me } };
      await saveRecording(updated).catch(() => {});
      if (onUpdate) onUpdate(updated);
    });
  });

  // Takus-task action buttons
  container.querySelectorAll('.task-takus-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const task = takus.find(t => t.id === id);
      if (!task) return;
      await _handleTakusAction(task, recording);
    });
  });

  // Takus-task dismiss (mark done)
  container.querySelectorAll('.task-takus-dismiss').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const task = takus.find(t => t.id === id);
      if (!task) return;
      task.done = true;
      _updateRowDoneState(btn.closest('.task-row'), true);
      const updated = { ...recording, tasks: { takusTasks: takus, meTasks: me } };
      await saveRecording(updated).catch(() => {});
      if (onUpdate) onUpdate(updated);
    });
  });
}

function _renderTakusTask(t) {
  const meta = _actionMeta(t.action);
  const done = t.done;
  return `
    <div class="task-row${done ? ' task-done' : ''}" data-id="${esc(t.id)}">
      <div style="display:flex;align-items:flex-start;gap:var(--space-2);flex:1;min-width:0;">
        <span style="color:${meta.color};flex-shrink:0;margin-top:1px;">${meta.icon(14)}</span>
        <div style="min-width:0;flex:1;">
          <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;">
            <span style="font-size:9px;font-weight:600;letter-spacing:0.04em;color:${meta.color};background:${meta.color}18;padding:1px 5px;border-radius:4px;white-space:nowrap;">${esc(meta.label)}</span>
            ${t.contextTimestamp ? `<span style="font-size:10px;color:var(--color-text-disabled);">${icons.clock(10)} ${esc(t.contextTimestamp)}</span>` : ''}
          </div>
          <div style="font-size:var(--font-xs);color:var(--color-text-secondary);margin-top:2px;">${esc(t.title)}</div>
          ${_renderPayloadHints(t)}
        </div>
      </div>
      ${!done ? `
      <div style="display:flex;gap:var(--space-1);flex-shrink:0;">
        <button class="btn btn-ghost btn-sm task-takus-action" data-id="${esc(t.id)}" style="font-size:10px;padding:2px 7px;white-space:nowrap;">${icons.arrowRight(11)} Run</button>
        <button class="btn btn-ghost btn-icon btn-sm task-takus-dismiss" data-id="${esc(t.id)}" title="Mark done" style="color:var(--color-text-disabled);">${icons.check(12)}</button>
      </div>` : `<span style="font-size:10px;color:var(--color-text-disabled);">${icons.checkSquare(12)}</span>`}
    </div>`;
}

function _renderMeTask(t) {
  const done = t.done;
  const urgent = t.urgency === 'high';
  return `
    <div class="task-row${done ? ' task-done' : ''}" data-id="${esc(t.id)}">
      <label style="display:flex;align-items:flex-start;gap:var(--space-2);flex:1;cursor:pointer;min-width:0;">
        <input type="checkbox" class="task-me-check" data-id="${esc(t.id)}" ${done ? 'checked' : ''}
          style="margin-top:2px;flex-shrink:0;accent-color:var(--color-primary);" />
        <div style="min-width:0;flex:1;">
          <div style="font-size:var(--font-xs);color:var(--color-text-secondary);">${esc(t.note)}</div>
          <div style="display:flex;align-items:center;gap:var(--space-2);margin-top:2px;flex-wrap:wrap;">
            ${urgent ? `<span style="font-size:9px;font-weight:600;color:#ef4444;background:rgba(239,68,68,0.12);padding:1px 5px;border-radius:4px;">${icons.flag(9)} High priority</span>` : ''}
            ${t.contextTimestamp ? `<span style="font-size:10px;color:var(--color-text-disabled);">${icons.clock(10)} ${esc(t.contextTimestamp)}</span>` : ''}
          </div>
        </div>
      </label>
    </div>`;
}

function _renderPayloadHints(t) {
  const p = t.payload || {};
  const hints = [];
  if (p.title)       hints.push(esc(p.title));
  if (p.priority)    hints.push(`Priority: ${esc(p.priority)}`);
  if (p.ticketId)    hints.push(esc(p.ticketId));
  if (!hints.length) return '';
  return `<div style="font-size:10px;color:var(--color-text-disabled);margin-top:2px;">${hints.join(' · ')}</div>`;
}

function _updateRowDoneState(row, done) {
  if (!row) return;
  row.classList.toggle('task-done', done);
}

async function _handleTakusAction(task, recording) {
  switch (task.action) {
    case 'DRAFT_SLACK_MESSAGE':
    case 'DRAFT_SHARE_MESSAGE':
      await _runSlack(task, recording);
      break;
    case 'CREATE_BUG_REPORT':
      await _runBugReport(task, recording);
      break;
    case 'UPDATE_TICKET':
      await _runTicketUpdate(task, recording);
      break;
    case 'LOG_DECISION':
      _copyDecision(task);
      break;
    case 'CREATE_CALENDAR_EVENT':
      _openCalendarLink(task);
      break;
    default:
      _copyTaskPayload(task);
  }
}

// ── Integration-aware action handlers ────────────────────────────────────────

function _taskBtn(task, recording) {
  // Scope lookup to the specific recording's tasks pane so multiple open
  // history items with identically-named task IDs don't cross-contaminate.
  const pane = document.querySelector(`.ai-tab-content[data-tab="tasks"][data-id="${recording.id}"]`);
  return (pane || document).querySelector(`.task-takus-action[data-id="${esc(task.id)}"]`);
}

async function _runSlack(task, recording) {
  const cfg = await getIntegrationConfig('slack');
  if (cfg.configured) {
    const btn = _taskBtn(task, recording);
    _setBtnLoading(btn, true);
    try {
      const payload = buildSlackPayload(task, recording);
      await postToSlack(cfg.webhookUrl, payload);
      toast.success('Sent to Slack', task.title);
    } catch (e) {
      toast.error('Slack failed', e.message);
    } finally {
      _setBtnLoading(btn, false);
    }
  } else {
    const p = task.payload || {};
    _copy(p.message || p.text || task.title, 'Draft copied — connect Slack to send directly');
    _promptConnect('Slack');
  }
}

async function _runBugReport(task, recording) {
  // Try GitHub first, then Linear, then clipboard
  const [gh, lin] = await Promise.all([
    getIntegrationConfig('github'),
    getIntegrationConfig('linear'),
  ]);

  if (gh.configured) {
    const btn = _taskBtn(task, recording);
    _setBtnLoading(btn, true);
    try {
      const issue = buildGitHubIssuePayload(task, recording);
      const result = await createGitHubIssue(gh.token, gh.owner, gh.repo, issue);
      toast.success('GitHub issue created', `#${result.number} — ${result.url}`);
      _openUrl(result.url);
    } catch (e) {
      toast.error('GitHub failed', e.message);
    } finally {
      _setBtnLoading(btn, false);
    }
    return;
  }

  if (lin.configured) {
    const btn = _taskBtn(task, recording);
    _setBtnLoading(btn, true);
    try {
      const issue = buildLinearIssuePayload(task, recording);
      const result = await createLinearIssue(lin.apiKey, lin.teamId, issue);
      toast.success('Linear issue created', `${result.identifier} — ${result.url}`);
      _openUrl(result.url);
    } catch (e) {
      toast.error('Linear failed', e.message);
    } finally {
      _setBtnLoading(btn, false);
    }
    return;
  }

  // Fallback: clipboard
  const p = task.payload || {};
  const lines = [
    `**Bug Report: ${task.title}**`, '',
    p.steps     ? `Steps to reproduce:\n${p.steps}` : '',
    p.expected  ? `Expected: ${p.expected}` : '',
    p.actual    ? `Actual: ${p.actual}` : '',
    p.error_log ? `\nConsole error:\n\`${p.error_log}\`` : '',
    recording.driveLink ? `\nRecording: ${recording.driveLink}` : '',
    task.contextTimestamp ? `Timestamp: ${task.contextTimestamp}` : '',
  ].filter(Boolean).join('\n');
  _copy(lines, 'Bug report copied — connect GitHub or Linear to file directly');
  _promptConnect('GitHub or Linear');
}

async function _runTicketUpdate(task, recording) {
  const lin = await getIntegrationConfig('linear');
  if (lin.configured) {
    const btn = _taskBtn(task, recording);
    _setBtnLoading(btn, true);
    try {
      const issue = buildLinearIssuePayload(task, recording);
      const result = await createLinearIssue(lin.apiKey, lin.teamId, issue);
      toast.success('Linear issue created', `${result.identifier}`);
      _openUrl(result.url);
    } catch (e) {
      toast.error('Linear failed', e.message);
    } finally {
      _setBtnLoading(btn, false);
    }
    return;
  }
  const p = task.payload || {};
  const id = p.ticketId || p.id || '';
  _copy(
    `${id ? id + ': ' : ''}${task.title}${recording.driveLink ? `\nRecording: ${recording.driveLink}` : ''}`,
    'Ticket update copied — connect Linear to file directly',
  );
  _promptConnect('Linear');
}

function _copyDecision(task) {
  const p = task.payload || {};
  const text = `Decision: ${p.decision || task.title}\nOwner: ${p.owner || '—'}\nDate: ${new Date().toLocaleDateString()}${task.contextTimestamp ? `\nTimestamp: ${task.contextTimestamp}` : ''}`;
  _copy(text, 'Decision copied to clipboard');
}

function _openCalendarLink(task) {
  const p = task.payload || {};
  const title = encodeURIComponent(p.title || task.title);
  window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}`, '_blank', 'noopener');
  toast.success('Opening calendar', 'Prefilled with task title');
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
 * Returns a task summary badge string for the history item row.
 * e.g. "3 tasks" or "" if no tasks.
 */
export function tasksBadge(recording) {
  const tasks = recording.tasks;
  if (!tasks) return '';
  const total = (tasks.takusTasks?.length || 0) + (tasks.meTasks?.length || 0);
  if (!total) return '';
  const open  = (tasks.takusTasks?.filter(t => !t.done).length || 0)
              + (tasks.meTasks?.filter(t => !t.done).length    || 0);
  return open;
}
