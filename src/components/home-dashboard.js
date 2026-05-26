// Takus — Home Dashboard
// The default landing page showing greeting, active goals, pending tasks,
// recent entries, and quick actions. Replaces the old tab-based default view.

import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import { getEntries, getAllEmbeddings } from '../lib/storage.js';
import { OPEN_ENTRY } from '../lib/events.js';
import { getEffectiveAIConfig } from '../lib/settings-store.js';

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

    /* Greeting Bar */
    .home-greeting-bar {
      background: var(--bg-primary);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-lg, 12px);
      padding: var(--space-5) var(--space-6);
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      position: relative;
      overflow: hidden;
    }
    .home-greeting-bar::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--accent-primary), var(--color-info), var(--accent-primary));
      background-size: 200% 100%;
      animation: shimmer 3s ease-in-out infinite;
      opacity: 0.6;
    }
    .home-greeting-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-4);
    }
    .home-greeting-bar h1 {
      font-size: var(--text-2xl, 32px);
      font-weight: var(--weight-bold, 700);
      color: var(--text-primary);
      letter-spacing: -0.02em;
      line-height: 1.2;
      margin: 0;
    }
    .home-greeting-bar .home-date {
      font-size: var(--text-sm, 13px);
      color: var(--text-muted);
      margin-top: var(--space-1);
    }
    .home-streak-badge {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      padding: var(--space-1) var(--space-3);
      border-radius: 99px;
      background: linear-gradient(135deg, rgba(251, 146, 60, 0.15), rgba(239, 68, 68, 0.1));
      color: #fb923c;
      font-size: var(--text-xs, 12px);
      font-weight: var(--weight-semibold, 600);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .home-suggestion {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-md, 8px);
      background: var(--bg-secondary, rgba(255,255,255,0.03));
      font-size: var(--text-sm, 13px);
      color: var(--text-secondary);
      line-height: 1.4;
    }
    .home-briefing-strip {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .home-briefing-chip {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      padding: var(--space-1) var(--space-2);
      border-radius: var(--radius-sm, 6px);
      font-size: var(--text-xs, 12px);
      font-weight: var(--weight-medium, 500);
      background: var(--bg-secondary, rgba(255,255,255,0.04));
      color: var(--text-muted);
      white-space: nowrap;
    }
    .home-briefing-chip--danger {
      background: rgba(239, 68, 68, 0.1);
      color: var(--color-danger, #ef4444);
    }
    .home-briefing-chip--warning {
      background: rgba(245, 158, 11, 0.1);
      color: var(--color-warning, #f59e0b);
    }
    .home-briefing-chip--success {
      background: rgba(34, 197, 94, 0.1);
      color: var(--color-success, #22c55e);
    }
    .home-birthday-overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none;
      overflow: hidden;
    }
    .home-birthday-emoji {
      position: absolute;
      font-size: 20px;
      animation: birthday-float 3s ease-out forwards;
      opacity: 0;
    }
    @keyframes birthday-float {
      0% { opacity: 1; transform: translateY(0) rotate(0deg); }
      100% { opacity: 0; transform: translateY(-80px) rotate(20deg); }
    }

    /* AI Config Nudge Banner */
    .home-ai-nudge {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      padding: var(--space-4) var(--space-5);
      padding-left: calc(var(--space-5) + 3px);
      border-radius: var(--radius-lg, 12px);
      background: rgba(255, 255, 255, 0.03);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.06);
      position: relative;
      overflow: hidden;
      animation: fadeIn 300ms ease;
    }
    .home-ai-nudge::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
      width: 3px;
      background: linear-gradient(180deg, var(--accent-primary, #7c3aed), var(--color-info, #3b82f6));
      border-radius: var(--radius-lg, 12px) 0 0 var(--radius-lg, 12px);
    }
    .home-ai-nudge-content {
      flex: 1;
      font-size: var(--text-sm, 13px);
      color: var(--text-secondary);
      line-height: 1.5;
    }
    .home-ai-nudge-cta {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-4);
      border-radius: var(--radius-md, 8px);
      border: none;
      background: linear-gradient(135deg, var(--accent-primary, #7c3aed), var(--color-info, #3b82f6));
      color: #fff;
      font-size: var(--text-sm, 13px);
      font-weight: var(--weight-semibold, 600);
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: opacity var(--transition-base, 150ms ease);
    }
    .home-ai-nudge-cta:hover {
      opacity: 0.9;
    }
    .home-ai-nudge-dismiss {
      position: absolute;
      top: var(--space-2);
      right: var(--space-2);
      background: none;
      border: none;
      color: var(--text-disabled);
      cursor: pointer;
      padding: var(--space-1);
      border-radius: var(--radius-sm, 6px);
      font-size: 14px;
      line-height: 1;
      transition: color var(--transition-fast, 100ms ease);
    }
    .home-ai-nudge-dismiss:hover {
      color: var(--text-muted);
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

    /* Quick Search */
    .home-search {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-4);
      border-radius: var(--radius-md, 8px);
      border: 1px solid var(--border-default);
      background: var(--bg-primary);
      cursor: pointer;
      transition: all var(--transition-base, 150ms ease);
    }
    .home-search:hover {
      border-color: var(--border-strong);
      background: var(--bg-hover);
    }
    .home-search-text {
      flex: 1;
      font-size: var(--text-sm, 13px);
      color: var(--text-muted);
    }
    .home-search-kbd {
      font-size: var(--text-2xs, 11px);
      color: var(--text-disabled);
      background: var(--bg-tertiary);
      padding: 2px 6px;
      border-radius: var(--radius-xs, 4px);
      font-family: var(--font-mono);
    }

    /* Activity Sparkline */
    .home-sparkline {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 40px;
    }
    .home-sparkline-bar {
      flex: 1;
      border-radius: 2px 2px 0 0;
      background: var(--accent-primary);
      opacity: 0.7;
      min-height: 2px;
      transition: opacity var(--transition-fast, 100ms ease);
    }
    .home-sparkline-bar:hover {
      opacity: 1;
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
      .home-greeting-bar h1 {
        font-size: var(--text-xl, 24px);
      }
      .home-search-kbd {
        display: none;
      }
    }

    /* Onboarding Tooltip Hints */
    .onboarding-hint-overlay {
      position: fixed;
      inset: 0;
      z-index: 9998;
      background: rgba(0,0,0,0.35);
      animation: fadeIn 200ms ease;
    }
    .onboarding-hint {
      position: fixed;
      z-index: 9999;
      max-width: 280px;
      padding: 14px 16px;
      background: var(--color-bg-deep, #1a1a2e);
      border: 1px solid rgba(139, 92, 246, 0.5);
      border-radius: var(--radius-md, 8px);
      color: var(--text-primary, #f1f5f9);
      font-size: var(--text-sm, 13px);
      line-height: 1.5;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(139,92,246,0.2);
      animation: fadeIn 200ms ease;
    }
    .onboarding-hint-arrow {
      position: absolute;
      width: 10px;
      height: 10px;
      background: var(--color-bg-deep, #1a1a2e);
      border: 1px solid rgba(139, 92, 246, 0.5);
      transform: rotate(45deg);
    }
    .onboarding-hint-arrow.arrow-left {
      left: -6px;
      top: 18px;
      border-right: none;
      border-top: none;
    }
    .onboarding-hint-arrow.arrow-top {
      top: -6px;
      left: 24px;
      border-bottom: none;
      border-right: none;
    }
    .onboarding-hint-text {
      margin-bottom: 12px;
      color: var(--text-secondary, #cbd5e1);
    }
    .onboarding-hint-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2, 8px);
    }
    .onboarding-hint-btn {
      padding: 4px 12px;
      border-radius: var(--radius-sm, 6px);
      font-size: var(--text-xs, 12px);
      font-weight: var(--weight-medium, 500);
      cursor: pointer;
      border: none;
      transition: background 100ms ease;
    }
    .onboarding-hint-btn--skip {
      background: transparent;
      color: var(--text-muted, #94a3b8);
    }
    .onboarding-hint-btn--skip:hover {
      background: rgba(255,255,255,0.06);
    }
    .onboarding-hint-btn--next {
      background: rgba(139, 92, 246, 0.8);
      color: #fff;
    }
    .onboarding-hint-btn--next:hover {
      background: rgba(139, 92, 246, 1);
    }
    .onboarding-hint-step {
      font-size: 10px;
      color: var(--text-disabled, #64748b);
      margin-bottom: 6px;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Render compact daily briefing chips from greeting context.
 * Only shows non-zero / meaningful data.
 */
function _renderBriefingStrip(gCtx) {
  const chips = [];

  // First session — show setup guidance instead of stats
  if (gCtx.isFirstSession) {
    // Check AI config
    let aiReady = false;
    try {
      const cfg = getEffectiveAIConfig();
      aiReady = !!(cfg.apiKey || cfg.useProxy);
    } catch { /* settings not loaded yet */ }

    if (!aiReady) {
      chips.push(`<span class="home-briefing-chip home-briefing-chip--warning">🔑 Set up AI in Settings to unlock intelligence</span>`);
    }
    chips.push(`<span class="home-briefing-chip home-briefing-chip--success">📝 Capture your first entry to get started</span>`);
    return chips.length > 0 ? `<div class="home-briefing-strip">${chips.join('')}</div>` : '';
  }

  // Today tasks
  if (gCtx.todayTasks > 0) {
    chips.push(`<span class="home-briefing-chip">📋 ${gCtx.todayTasks} task${gCtx.todayTasks !== 1 ? 's' : ''} today</span>`);
  } else {
    chips.push(`<span class="home-briefing-chip home-briefing-chip--success">✓ No tasks due</span>`);
  }

  // Overdue
  if (gCtx.overdueTasks > 0) {
    chips.push(`<span class="home-briefing-chip home-briefing-chip--danger">⚠️ ${gCtx.overdueTasks} overdue</span>`);
  }

  // Next meeting
  if (gCtx.upcomingMeetings?.length > 0) {
    const next = gCtx.upcomingMeetings[0];
    chips.push(`<span class="home-briefing-chip">📅 ${esc(next.title || 'Meeting')}</span>`);
  }

  // At-risk goals
  if (gCtx.atRiskGoals > 0) {
    chips.push(`<span class="home-briefing-chip home-briefing-chip--warning">🎯 ${gCtx.atRiskGoals} at risk</span>`);
  }

  // Focus level
  const focusColors = { deep: '--success', moderate: '--success', light: '--warning', exhausted: '--danger' };
  const focusVariant = focusColors[gCtx.focusLevel] || '';
  if (gCtx.focusLevel && gCtx.focusLevel !== 'moderate') {
    chips.push(`<span class="home-briefing-chip home-briefing-chip${focusVariant}">🧠 ${gCtx.focusLevel} focus</span>`);
  }

  if (chips.length === 0) return '';
  return `<div class="home-briefing-strip">${chips.join('')}</div>`;
}

/**
 * Check whether the AI config nudge banner should be shown.
 * Hidden when: AI is configured, or dismissed within the last 7 days.
 */
function _shouldShowAINudge() {
  // Check if AI is already configured
  try {
    const cfg = getEffectiveAIConfig();
    if (cfg.apiKey || cfg.useProxy) return false;
  } catch { /* settings not loaded — show nudge */ }

  // Check dismissal timestamp
  try {
    const dismissed = localStorage.getItem('ai_nudge_dismissed');
    if (dismissed) {
      const ts = parseInt(dismissed, 10);
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (!isNaN(ts) && (Date.now() - ts) < sevenDays) return false;
    }
  } catch { /* localStorage unavailable — show nudge */ }

  return true;
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

  // Show skeleton loading immediately
  container.innerHTML = `
    <div class="home-dashboard">
      <div style="display:flex;flex-direction:column;gap:var(--space-3);">
        <div style="height:32px;width:50%;border-radius:var(--radius-md);background:linear-gradient(90deg,rgba(255,255,255,0.05) 25%,rgba(255,255,255,0.1) 50%,rgba(255,255,255,0.05) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;"></div>
        <div style="height:14px;width:30%;border-radius:var(--radius-sm);background:linear-gradient(90deg,rgba(255,255,255,0.05) 25%,rgba(255,255,255,0.1) 50%,rgba(255,255,255,0.05) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;"></div>
      </div>
      <div style="display:flex;gap:var(--space-3);">
        ${[1,2,3,4].map(() => `<div style="height:36px;width:120px;border-radius:var(--radius-md);background:linear-gradient(90deg,rgba(255,255,255,0.05) 25%,rgba(255,255,255,0.1) 50%,rgba(255,255,255,0.05) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;"></div>`).join('')}
      </div>
    </div>`;

  // Get contextual greeting from the intelligence engine
  let gCtx;
  try {
    const { getGreetingContext } = await import('../lib/greeting-engine.js');
    gCtx = await getGreetingContext();
  } catch {
    gCtx = {
      name: '', greeting: 'Welcome', dateStr: _formatDate(new Date()),
      streak: 0, isStreakRecord: false, overdueTasks: 0, todayTasks: 0,
      upcomingMeetings: [], atRiskGoals: 0, focusLevel: 'moderate',
      isOverloaded: false, isBirthday: false, isFirstSession: true,
      isReturning: false, suggestion: '', totalEntries: 0, aiProcessedPct: 0,
      weekEntries: 0, avatar: '🧠', tone: 'professional',
    };
  }
  const { greeting, dateStr } = gCtx;
  const name = gCtx.name;

  // Load data
  let entries = [];
  let tasks = [];
  let goals = [];
  let embeddingsCount = 0;

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

  try {
    const embs = await getAllEmbeddings();
    embeddingsCount = embs.length;
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

  // Knowledge health
  const aiProcessed = entries.filter(e => e.aiSummary).length;
  const aiPct = totalEntries > 0 ? Math.round((aiProcessed / totalEntries) * 100) : 0;
  const embPct = totalEntries > 0 ? Math.round((embeddingsCount / totalEntries) * 100) : 0;

  // Activity timeline (last 14 days)
  const now = Date.now();
  const dayMs = 86400000;
  const activityDays = Array.from({ length: 14 }, (_, i) => {
    const dayStart = now - (13 - i) * dayMs;
    const dayEnd = dayStart + dayMs;
    return entries.filter(e => e.date >= dayStart && e.date < dayEnd).length;
  });
  const maxActivity = Math.max(...activityDays, 1);

  container.innerHTML = `
    <div class="home-dashboard">
      <!-- Contextual Greeting Bar -->
      <div class="home-greeting-bar">
        ${gCtx.isBirthday ? `<div class="home-birthday-overlay" id="home-birthday-fx"></div>` : ''}
        <div class="home-greeting-top">
          <div>
            <h1>${esc(greeting)}</h1>
            <div class="home-date">${esc(dateStr)}</div>
          </div>
          ${gCtx.streak > 0 ? `<span class="home-streak-badge">🔥 ${gCtx.streak}-day streak${gCtx.isStreakRecord ? ' — NEW BEST!' : ''}</span>` : ''}
        </div>
        ${gCtx.suggestion ? `<div class="home-suggestion">
          <span style="flex:1;">${gCtx.suggestion}</span>
          ${gCtx.overdueTasks > 0 ? '<button class="btn btn-primary btn-sm" data-nav="tasks" style="flex-shrink:0;">Go to Tasks</button>' :
            gCtx.todayTasks > 0 ? '<button class="btn btn-primary btn-sm" data-nav="tasks" style="flex-shrink:0;">View Tasks</button>' :
            gCtx.isFirstSession ? '<button class="btn btn-primary btn-sm" id="home-hero-record" style="flex-shrink:0;">🎙️ Record</button>' :
            '<button class="btn btn-ghost btn-sm" id="home-hero-record" style="flex-shrink:0;">🎙️ Record</button>'}
        </div>` : ''}
        ${_renderBriefingStrip(gCtx)}
      </div>

      ${_shouldShowAINudge() ? `
      <!-- AI Config Nudge Banner -->
      <div class="home-ai-nudge" id="home-ai-nudge">
        <div class="home-ai-nudge-content">
          🔑 Unlock AI intelligence — configure your API key to enable transcription, task extraction, and semantic search.
        </div>
        <button class="home-ai-nudge-cta" id="home-ai-nudge-configure">${icons.zap(14)} Configure AI</button>
        <button class="home-ai-nudge-dismiss" id="home-ai-nudge-dismiss" title="Dismiss">✕</button>
      </div>
      ` : ''}

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

      <!-- Quick Search -->
      <div class="home-search" id="home-search-bar" title="Search your knowledge (⌘K)">
        <span style="color:var(--text-muted);display:flex;">${icons.search(14)}</span>
        <span class="home-search-text">Search your knowledge…</span>
        <span class="home-search-kbd">⌘K</span>
      </div>

      ${totalEntries === 0 ? `
      <!-- Onboarding Card (first-time user) -->
      <div class="home-card" style="text-align:center;padding:var(--space-8) var(--space-6);">
        <div style="font-size:40px;margin-bottom:var(--space-3);">🧠</div>
        <div style="font-size:var(--text-lg);font-weight:var(--weight-bold);color:var(--text-primary);margin-bottom:var(--space-2);">Welcome to your Knowledge OS</div>
        <div style="font-size:var(--text-sm);color:var(--text-muted);max-width:380px;margin:0 auto var(--space-5);">
          Capture meetings, import documents, and let AI connect your goals, tasks, and insights — all in one place.
        </div>
        <div style="display:flex;gap:var(--space-3);justify-content:center;flex-wrap:wrap;">
          <button class="home-quick-action" id="home-onboard-capture">
            ${icons.video(14)} Start a Capture
          </button>
          <button class="home-quick-action" id="home-onboard-import">
            ${icons.upload(14)} Import a Document
          </button>
          <button class="home-quick-action" id="home-onboard-ai">
            ${icons.zap(14)} Configure AI Provider
          </button>
        </div>
      </div>
      ` : `
      <!-- Action-Oriented Stats Strip -->
      <div class="home-stats">
        <div class="home-stat">
          <span class="home-stat-value">${pendingTasks.length}</span>
          <span class="home-stat-label">Pending Tasks</span>
        </div>
        <div class="home-stat">
          <span class="home-stat-value">${gCtx.streak > 0 ? `🔥 ${gCtx.streak}` : '—'}</span>
          <span class="home-stat-label">Streak</span>
        </div>
        <div class="home-stat">
          <span class="home-stat-value">${thisWeek}</span>
          <span class="home-stat-label">This Week</span>
        </div>
      </div>
      `}

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
                <button class="btn btn-ghost btn-sm home-share-btn" data-share-entry="${esc(e.id)}" title="Share brief" style="padding:4px;color:var(--text-muted);">
                  ${icons.link(12)}
                </button>
              </div>
              </div>
            `).join('') : '<div class="home-empty">No entries yet. Start capturing knowledge!</div>'}
          </div>
        </div>

        <!-- Knowledge Health -->
        <div class="home-card">
          <div class="home-card-header">
            <span class="home-card-title">${icons.cpu(14)} Knowledge Health</span>
            <button class="home-card-action" data-nav="insights">Insights →</button>
          </div>
          <div style="display:flex;gap:var(--space-4);">
            <div style="flex:1;text-align:center;">
              <div style="font-size:var(--text-lg);font-weight:var(--weight-bold);color:var(--accent-primary);">${aiPct}%</div>
              <div style="font-size:var(--text-2xs);color:var(--text-muted);">AI Processed</div>
            </div>
            <div style="width:1px;background:var(--border-default);"></div>
            <div style="flex:1;text-align:center;">
              <div style="font-size:var(--text-lg);font-weight:var(--weight-bold);color:var(--color-info);">${embPct}%</div>
              <div style="font-size:var(--text-2xs);color:var(--text-muted);">Searchable</div>
            </div>
            <div style="width:1px;background:var(--border-default);"></div>
            <div style="flex:1;text-align:center;">
              <div style="font-size:var(--text-lg);font-weight:var(--weight-bold);color:var(--color-success);">${totalEntries}</div>
              <div style="font-size:var(--text-2xs);color:var(--text-muted);">Total Entries</div>
            </div>
          </div>
        </div>

        ${totalEntries === 0 ? '' : `
        <!-- Activity Timeline -->
        <div class="home-card">
          <div class="home-card-header">
            <span class="home-card-title">${icons.barChart(14)} Activity (14 days)</span>
          </div>
          <div class="home-sparkline">
            ${activityDays.map((count, i) => {
              const height = Math.max(2, (count / maxActivity) * 40);
              const dayLabel = new Date(now - (13 - i) * dayMs).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
              return `<div class="home-sparkline-bar" style="height:${height}px;" title="${dayLabel}: ${count} entries"></div>`;
            }).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;font-size:var(--text-2xs);color:var(--text-disabled);">
            <span>2 weeks ago</span>
            <span>Today</span>
          </div>
        </div>
        `}

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
  // Hero CTA record button
  container.querySelector('#home-hero-record')?.addEventListener('click', () => {
    if (opts.onStartCapture) opts.onStartCapture();
  });
  // Share buttons on recent entries
  container.querySelectorAll('.home-share-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // Don't trigger entry navigation
      const entryId = btn.dataset.shareEntry;
      const entry = entries.find(e => e.id === entryId);
      if (!entry) return;
      try {
        const { toast } = await import('./toast.js');
        const res = await fetch('/api/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: entry.title, date: entry.date, type: entry.type, aiSummary: entry.aiSummary || '' }),
        });
        if (res.ok) {
          const { id } = await res.json();
          const url = `${window.location.origin}/api/share?id=${id}`;
          await navigator.clipboard.writeText(url).catch(() => {});
          toast.success('Link copied!', 'Share this link with meeting attendees');
        } else {
          toast.error('Share failed', 'Could not create share link');
        }
      } catch (err) {
        const { toast } = await import('./toast.js');
        toast.error('Share failed', err.message);
      }
    });
  });
  container.querySelector('#home-action-import')?.addEventListener('click', () => {
    if (opts.onImportFile) { opts.onImportFile(); return; }
    // Fallback: use a file input routed through document-adapter
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.pdf,.docx,.md,.txt,.csv,.html,.htm,.json,.text,.markdown,.eml';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', async () => {
      const files = fileInput.files;
      if (!files?.length) { fileInput.remove(); return; }
      try {
        const { toast } = await import('./toast.js');
        const { extractTextFromFile, ingestDocument } = await import('../lib/document-adapter.js');
        let imported = 0;
        for (const file of files) {
          try {
            const doc = await extractTextFromFile(file);
            const result = await ingestDocument(doc);
            if (result.success) imported++;
          } catch (e) {
            toast.error('Import failed', `${file.name}: ${e.message}`);
          }
        }
        if (imported > 0) {
          toast.success(`${imported} file${imported > 1 ? 's' : ''} imported`, 'Available in your Knowledge Library.');
          if (opts.onNavigate) opts.onNavigate('history');
        }
      } catch (e) {
        console.error('[HomeDashboard] Import fallback error:', e);
      }
      fileInput.remove();
    });
    document.body.appendChild(fileInput);
    fileInput.click();
  });
  container.querySelector('#home-action-ask')?.addEventListener('click', () => {
    if (opts.onNavigate) opts.onNavigate('ask');
  });

  // Bind onboarding card quick actions (first-time user)
  container.querySelector('#home-onboard-capture')?.addEventListener('click', () => {
    if (opts.onStartCapture) opts.onStartCapture();
  });
  container.querySelector('#home-onboard-import')?.addEventListener('click', () => {
    if (opts.onImportFile) opts.onImportFile();
    else import('./command-bar.js').then(({ openCommandBar }) => openCommandBar('import')).catch(() => {});
  });
  container.querySelector('#home-onboard-ai')?.addEventListener('click', () => {
    import('./settings-panel.js').then(({ openSettingsModal }) => openSettingsModal()).catch(() => {});
  });

  // Bind AI nudge banner
  container.querySelector('#home-ai-nudge-configure')?.addEventListener('click', () => {
    import('./settings-panel.js').then(({ openSettingsModal }) => openSettingsModal()).catch(() => {});
  });
  container.querySelector('#home-ai-nudge-dismiss')?.addEventListener('click', () => {
    try { localStorage.setItem('ai_nudge_dismissed', String(Date.now())); } catch { /* ignore */ }
    container.querySelector('#home-ai-nudge')?.remove();
  });

  // Bind quick search
  container.querySelector('#home-search-bar')?.addEventListener('click', () => {
    import('./command-bar.js').then(({ openCommandBar }) => openCommandBar()).catch(() => {});
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

  // Birthday celebration animation
  if (gCtx.isBirthday) {
    const overlay = container.querySelector('#home-birthday-fx');
    if (overlay) {
      const emojis = ['🎂', '🎉', '🎈', '🎊', '✨', '🥳', '🎁', '🌟'];
      for (let i = 0; i < 12; i++) {
        const span = document.createElement('span');
        span.className = 'home-birthday-emoji';
        span.textContent = emojis[i % emojis.length];
        span.style.left = `${8 + Math.random() * 84}%`;
        span.style.bottom = '0';
        span.style.animationDelay = `${i * 0.15}s`;
        overlay.appendChild(span);
      }
    }
  }

  // Show onboarding tooltip hints (once, after wizard completes)
  _showOnboardingHints(container);
}

/**
 * Show sequential onboarding tooltip hints after first setup.
 * Checks localStorage key 'onboarding_hints_shown' — if true, skips.
 * Shows 3 hints sequentially pointing to: Knowledge section, search bar, quick actions.
 */
function _showOnboardingHints(dashboardContainer) {
  try {
    if (localStorage.getItem('onboarding_hints_shown') === 'true') return;
  } catch { return; }

  const hints = [
    {
      targetSelector: '[data-section="knowledge"], #sidebar-tab-history',
      text: 'Your knowledge lives here — Library holds all your entries, Ask lets you search with AI',
      arrowDir: 'left',
    },
    {
      targetSelector: '#home-search-bar, .home-search',
      text: 'Search anything instantly with ⌘K',
      arrowDir: 'top',
    },
    {
      targetSelector: '.home-quick-actions',
      text: 'Start here — capture a meeting, import a document, or ask a question',
      arrowDir: 'top',
    },
  ];

  let current = 0;

  function _dismiss() {
    try { localStorage.setItem('onboarding_hints_shown', 'true'); } catch { /* ignore */ }
    const overlay = document.querySelector('.onboarding-hint-overlay');
    const hint = document.querySelector('.onboarding-hint');
    if (overlay) overlay.remove();
    if (hint) hint.remove();
  }

  function _showHint(index) {
    // Clean up previous
    const oldOverlay = document.querySelector('.onboarding-hint-overlay');
    const oldHint = document.querySelector('.onboarding-hint');
    if (oldOverlay) oldOverlay.remove();
    if (oldHint) oldHint.remove();

    if (index >= hints.length) {
      _dismiss();
      return;
    }

    const h = hints[index];
    const target = document.querySelector(h.targetSelector);
    if (!target) {
      // Target not found — skip to next or dismiss
      if (index < hints.length - 1) { _showHint(index + 1); return; }
      _dismiss();
      return;
    }

    const rect = target.getBoundingClientRect();

    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'onboarding-hint-overlay';
    overlay.addEventListener('click', _dismiss);
    document.body.appendChild(overlay);

    // Hint tooltip
    const hint = document.createElement('div');
    hint.className = 'onboarding-hint';

    const isLast = index === hints.length - 1;
    const stepLabel = `${index + 1} of ${hints.length}`;

    hint.innerHTML = `
      <div class="onboarding-hint-arrow arrow-${h.arrowDir}"></div>
      <div class="onboarding-hint-step">${stepLabel}</div>
      <div class="onboarding-hint-text">${h.text}</div>
      <div class="onboarding-hint-actions">
        <button class="onboarding-hint-btn onboarding-hint-btn--skip" data-hint-skip>Skip</button>
        <button class="onboarding-hint-btn onboarding-hint-btn--next" data-hint-next>${isLast ? 'Got it' : 'Next'}</button>
      </div>
    `;

    // Position based on arrow direction
    if (h.arrowDir === 'left') {
      hint.style.top = `${rect.top}px`;
      hint.style.left = `${rect.right + 12}px`;
    } else if (h.arrowDir === 'top') {
      hint.style.top = `${rect.bottom + 12}px`;
      hint.style.left = `${rect.left}px`;
    }

    document.body.appendChild(hint);

    hint.querySelector('[data-hint-skip]').addEventListener('click', _dismiss);
    hint.querySelector('[data-hint-next]').addEventListener('click', () => {
      current++;
      _showHint(current);
    });
  }

  // Delay slightly to let the dashboard render fully
  setTimeout(() => _showHint(0), 600);
}
