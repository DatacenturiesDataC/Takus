// Takus — Home Dashboard
// The default landing page showing greeting, active goals, pending tasks,
// recent entries, and quick actions. Replaces the old tab-based default view.

import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import { getEntries } from '../lib/storage.js';
import { OPEN_ENTRY } from '../lib/events.js';

let _stylesInjected = false;
function _injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'home-dashboard-styles';
  style.textContent = `
    .home-dashboard {
      max-width: var(--content-max-width, 1200px);
      margin: 0 auto;
      padding: var(--space-6) var(--space-6) var(--space-12);
      display: flex;
      flex-direction: column;
      gap: var(--space-6);
      animation: fadeIn 300ms ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Greeting */
    .home-greeting {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: var(--space-4);
    }
    .home-greeting h1 {
      font-size: var(--text-2xl, 32px);
      font-weight: var(--weight-bold, 700);
      color: var(--text-primary);
      letter-spacing: -0.02em;
      line-height: 1.2;
      margin: 0;
    }
    .home-greeting .home-date {
      font-size: var(--text-sm, 13px);
      color: var(--text-muted);
      margin-top: var(--space-1);
    }

    /* Quick Actions */
    .home-quick-actions {
      display: flex;
      gap: var(--space-3);
      flex-wrap: wrap;
    }
    .home-quick-action {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-4);
      border-radius: var(--radius-md, 8px);
      border: 1px solid var(--border-default);
      background: var(--bg-primary);
      color: var(--text-secondary);
      font-size: var(--text-sm, 13px);
      font-weight: var(--weight-medium, 500);
      cursor: pointer;
      transition: all var(--transition-base, 150ms ease);
      white-space: nowrap;
    }
    .home-quick-action:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
      border-color: var(--border-strong);
    }
    .home-quick-action:active {
      background: var(--bg-active);
    }

    /* Cards Grid */
    .home-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: var(--space-4);
    }
    .home-card {
      background: var(--bg-primary);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-lg, 12px);
      padding: var(--space-5);
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      transition: box-shadow var(--transition-base, 150ms ease);
    }
    .home-card:hover {
      box-shadow: var(--shadow-sm);
    }
    .home-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .home-card-title {
      font-size: var(--text-sm, 13px);
      font-weight: var(--weight-semibold, 600);
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .home-card-action {
      font-size: var(--text-xs, 12px);
      color: var(--accent-primary);
      cursor: pointer;
      background: none;
      border: none;
      font-weight: var(--weight-medium, 500);
      padding: var(--space-1) var(--space-2);
      border-radius: var(--radius-sm, 6px);
      transition: background var(--transition-fast, 100ms ease);
    }
    .home-card-action:hover {
      background: var(--accent-bg);
    }

    /* Stats Strip */
    .home-stats {
      display: flex;
      gap: var(--space-6);
      padding: var(--space-4) var(--space-5);
      background: var(--bg-secondary);
      border-radius: var(--radius-lg, 12px);
      border: 1px solid var(--border-subtle);
    }
    .home-stat {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .home-stat-value {
      font-size: var(--text-lg, 20px);
      font-weight: var(--weight-bold, 700);
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }
    .home-stat-label {
      font-size: var(--text-2xs, 11px);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /* Task & Entry Items */
    .home-item {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-sm, 6px);
      cursor: pointer;
      transition: background var(--transition-fast, 100ms ease);
    }
    .home-item:hover {
      background: var(--bg-hover);
    }
    .home-item-icon {
      width: 28px;
      height: 28px;
      border-radius: var(--radius-sm, 6px);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 12px;
    }
    .home-item-content {
      flex: 1;
      min-width: 0;
    }
    .home-item-title {
      font-size: var(--text-sm, 13px);
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .home-item-meta {
      font-size: var(--text-2xs, 11px);
      color: var(--text-muted);
    }
    .home-item-badge {
      font-size: var(--text-2xs, 11px);
      padding: 2px 8px;
      border-radius: var(--radius-full, 9999px);
      font-weight: var(--weight-medium, 500);
      flex-shrink: 0;
    }

    /* Goal Progress */
    .home-goal-bar {
      width: 100%;
      height: 4px;
      background: var(--bg-tertiary);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 4px;
    }
    .home-goal-fill {
      height: 100%;
      border-radius: 2px;
      transition: width 500ms ease;
    }

    /* Empty state */
    .home-empty {
      padding: var(--space-8) var(--space-4);
      text-align: center;
      color: var(--text-muted);
      font-size: var(--text-sm, 13px);
    }

    @media (max-width: 768px) {
      .home-dashboard {
        padding: var(--space-4);
      }
      .home-grid {
        grid-template-columns: 1fr;
      }
      .home-stats {
        flex-wrap: wrap;
        gap: var(--space-4);
      }
      .home-greeting h1 {
        font-size: var(--text-xl, 24px);
      }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Get time-based greeting.
 */
function _getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Format a date for display.
 */
function _formatDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format relative time.
 */
function _timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Render the home dashboard.
 * @param {HTMLElement} container
 * @param {object} opts - { onNavigate, onStartCapture, onImportFile }
 */
export async function renderHomeDashboard(container, opts = {}) {
  _injectStyles();

  const name = localStorage.getItem('takus_user_name') || '';
  const greeting = _getGreeting();
  const dateStr = _formatDate(new Date());

  // Load data
  let entries = [];
  let tasks = [];
  let goals = [];

  try {
    entries = await getEntries();
  } catch { /* empty */ }

  try {
    const { getAllTasks } = await import('../lib/graph/task-store.js');
    tasks = await getAllTasks();
  } catch { /* empty */ }

  try {
    const { getGoals } = await import('../apps/goals/index.js');
    if (typeof getGoals === 'function') {
      goals = await getGoals();
    }
  } catch { /* empty */ }

  // Sort entries by date (newest first)
  const recentEntries = [...entries]
    .sort((a, b) => (b.date || 0) - (a.date || 0))
    .slice(0, 5);

  // Pending tasks (not done)
  const pendingTasks = tasks
    .filter(t => t.status !== 'done' && t.status !== 'ignored')
    .sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);
    })
    .slice(0, 5);

  // Active goals
  const activeGoals = goals
    .filter(g => g.status === 'active' || !g.status)
    .slice(0, 3);

  // Stats
  const totalEntries = entries.length;
  const thisWeek = entries.filter(e => e.date && (Date.now() - e.date) < 7 * 86400000).length;
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(t => t.status === 'done').length;
  const totalDuration = entries.reduce((sum, e) => sum + (e.duration || 0), 0);
  const hoursRecorded = Math.round(totalDuration / 3600);

  container.innerHTML = `
    <div class="home-dashboard">
      <!-- Greeting -->
      <div class="home-greeting">
        <div>
          <h1>${greeting}${name ? `, ${esc(name)}` : ''}</h1>
          <div class="home-date">${dateStr}</div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="home-quick-actions">
        <button class="home-quick-action" id="home-action-note">
          ${icons.edit(14)} New Note
        </button>
        <button class="home-quick-action" id="home-action-capture">
          ${icons.video(14)} Start Capture
        </button>
        <button class="home-quick-action" id="home-action-import">
          ${icons.upload(14)} Import File
        </button>
        <button class="home-quick-action" id="home-action-ask">
          ${icons.messageSquare(14)} Ask Knowledge
        </button>
      </div>

      <!-- Stats Strip -->
      <div class="home-stats">
        <div class="home-stat">
          <span class="home-stat-value">${totalEntries}</span>
          <span class="home-stat-label">Entries</span>
        </div>
        <div class="home-stat">
          <span class="home-stat-value">${thisWeek}</span>
          <span class="home-stat-label">This Week</span>
        </div>
        <div class="home-stat">
          <span class="home-stat-value">${doneTasks}/${totalTasks}</span>
          <span class="home-stat-label">Tasks Done</span>
        </div>
        <div class="home-stat">
          <span class="home-stat-value">${hoursRecorded}h</span>
          <span class="home-stat-label">Recorded</span>
        </div>
      </div>

      <!-- Cards Grid -->
      <div class="home-grid">
        <!-- Pending Tasks -->
        <div class="home-card">
          <div class="home-card-header">
            <span class="home-card-title">${icons.checkSquare(14)} Pending Tasks</span>
            <button class="home-card-action" data-nav="tasks">View all →</button>
          </div>
          <div class="home-tasks-list">
            ${pendingTasks.length ? pendingTasks.map(t => `
              <div class="home-item" data-task-id="${esc(t.id)}">
                <div class="home-item-icon" style="background:${t.priority === 'high' ? 'var(--color-danger-bg)' : 'var(--accent-bg)'};color:${t.priority === 'high' ? 'var(--color-danger)' : 'var(--accent-primary)'};">
                  ${icons.checkSquare(14)}
                </div>
                <div class="home-item-content">
                  <div class="home-item-title">${esc(t.title || t.action || 'Untitled')}</div>
                  <div class="home-item-meta">${t.assignee ? esc(t.assignee) : 'Unassigned'}${t.deadline ? ` · Due ${_timeAgo(t.deadline)}` : ''}</div>
                </div>
                ${t.priority ? `<span class="home-item-badge" style="background:${t.priority === 'high' ? 'var(--color-danger-bg)' : t.priority === 'low' ? 'var(--bg-tertiary)' : 'var(--color-warning-bg)'};color:${t.priority === 'high' ? 'var(--color-danger)' : t.priority === 'low' ? 'var(--text-muted)' : 'var(--color-warning)'};">${t.priority}</span>` : ''}
              </div>
            `).join('') : '<div class="home-empty">All caught up! No pending tasks.</div>'}
          </div>
        </div>

        <!-- Recent Entries -->
        <div class="home-card">
          <div class="home-card-header">
            <span class="home-card-title">${icons.bookOpen(14)} Recent Entries</span>
            <button class="home-card-action" data-nav="history">View all →</button>
          </div>
          <div class="home-entries-list">
            ${recentEntries.length ? recentEntries.map(e => `
              <div class="home-item" data-entry-id="${esc(e.id)}">
                <div class="home-item-icon" style="background:var(--accent-bg);color:var(--accent-primary);">
                  ${icons.bookOpen(14)}
                </div>
                <div class="home-item-content">
                  <div class="home-item-title">${esc(e.title || 'Untitled')}</div>
                  <div class="home-item-meta">${e.type || 'entry'} · ${_timeAgo(e.date || e.createdAt || Date.now())}</div>
                </div>
                ${e.aiSummary ? `<span class="home-item-badge" style="background:var(--color-success-bg);color:var(--color-success);">AI</span>` : ''}
              </div>
            `).join('') : '<div class="home-empty">No entries yet. Start capturing knowledge!</div>'}
          </div>
        </div>

        ${activeGoals.length ? `
        <!-- Active Goals -->
        <div class="home-card">
          <div class="home-card-header">
            <span class="home-card-title">${icons.flag(14)} Active Goals</span>
            <button class="home-card-action" data-nav="goals">View all →</button>
          </div>
          <div>
            ${activeGoals.map(g => {
              const progress = g.progress || 0;
              const color = progress >= 80 ? 'var(--color-success)' : progress >= 40 ? 'var(--color-warning)' : 'var(--accent-primary)';
              return `
                <div class="home-item">
                  <div class="home-item-icon" style="background:var(--accent-bg);color:var(--accent-primary);">
                    ${icons.flag(14)}
                  </div>
                  <div class="home-item-content" style="flex:1;">
                    <div class="home-item-title">${esc(g.title || 'Untitled Goal')}</div>
                    <div class="home-goal-bar">
                      <div class="home-goal-fill" style="width:${progress}%;background:${color};"></div>
                    </div>
                  </div>
                  <span style="font-size:var(--text-xs);color:var(--text-muted);font-weight:var(--weight-medium);">${progress}%</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
        ` : ''}
      </div>
    </div>
  `;

  // Bind quick actions
  container.querySelector('#home-action-note')?.addEventListener('click', () => {
    import('./command-bar.js').then(({ openCommandBar }) => openCommandBar('new note')).catch(() => {});
  });
  container.querySelector('#home-action-capture')?.addEventListener('click', () => {
    if (opts.onStartCapture) opts.onStartCapture();
  });
  container.querySelector('#home-action-import')?.addEventListener('click', () => {
    if (opts.onImportFile) opts.onImportFile();
    else import('./command-bar.js').then(({ openCommandBar }) => openCommandBar('import')).catch(() => {});
  });
  container.querySelector('#home-action-ask')?.addEventListener('click', () => {
    if (opts.onNavigate) opts.onNavigate('ask');
  });

  // Bind card navigation actions
  container.querySelectorAll('.home-card-action[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (opts.onNavigate) opts.onNavigate(btn.dataset.nav);
    });
  });

  // Bind entry clicks
  container.querySelectorAll('[data-entry-id]').forEach(el => {
    el.addEventListener('click', () => {
      const entry = entries.find(e => e.id === el.dataset.entryId);
      if (entry) {
        document.dispatchEvent(new CustomEvent(OPEN_ENTRY, { detail: { entry } }));
      }
    });
  });
}
