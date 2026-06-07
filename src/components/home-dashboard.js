// Takus — Home Dashboard
// The default landing page showing greeting, active goals, pending tasks,
// recent entries, and quick actions. Replaces the old tab-based default view.

import { icons } from '../lib/icons.js';
import { esc } from '../lib/utils.js';
import { getEntryHeaders, getAllEmbeddings } from '../lib/storage.js';
import { OPEN_ENTRY } from '../lib/events.js';
import { getEffectiveAIConfig } from '../lib/settings-store.js';

let _stylesInjected = false;
function _injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  // Styles now loaded externally via src/styles/dashboard.css
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
        <div class="home-skeleton-bar home-skeleton-bar--lg"></div>
        <div class="home-skeleton-bar home-skeleton-bar--sm"></div>
      </div>
      <div style="display:flex;gap:var(--space-3);">
        ${[1,2,3,4].map(() => `<div class="home-skeleton-bar home-skeleton-bar--action"></div>`).join('')}
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
    entries = await getEntryHeaders();
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
  const aiProcessed = entries.filter(e => e.hasAiSummary).length;
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
        <button class="home-ai-nudge-dismiss" id="home-ai-nudge-dismiss" title="Dismiss" aria-label="Dismiss AI nudge">✕</button>
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
      <div class="home-card home-onboarding-card">
        <div class="home-onboarding-icon">🧠</div>
        <div class="home-onboarding-title">Welcome to your Knowledge OS</div>
        <div class="home-onboarding-desc">
          Capture meetings, import documents, and let AI connect your goals, tasks, and insights — all in one place.
        </div>
        <div class="home-onboarding-actions">
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
                ${e.hasAiSummary ? `<span class="home-item-badge" style="background:var(--color-success-bg);color:var(--color-success);">AI</span>` : ''}
                <button class="btn btn-ghost btn-sm home-share-btn" data-share-entry="${esc(e.id)}" title="Share brief" aria-label="Share brief" style="padding:4px;color:var(--text-muted);">
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
          <div class="home-health-grid">
            <div class="home-health-stat">
              <div class="home-health-value" style="color:var(--accent-primary);">${aiPct}%</div>
              <div class="home-health-label">AI Processed</div>
            </div>
            <div class="home-health-divider"></div>
            <div class="home-health-stat">
              <div class="home-health-value" style="color:var(--color-info);">${embPct}%</div>
              <div class="home-health-label">Searchable</div>
            </div>
            <div class="home-health-divider"></div>
            <div class="home-health-stat">
              <div class="home-health-value" style="color:var(--color-success);">${totalEntries}</div>
              <div class="home-health-label">Total Entries</div>
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
          <div class="home-timeline-labels">
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
        const title = entry.title || 'Untitled';
        const dateStr = entry.date ? new Date(entry.date).toLocaleDateString() : '';
        const lines = [`# ${title}`, dateStr, ''];
        if (entry.aiSummary || entry.hasAiSummary) lines.push(entry.aiSummary || '(AI summary available in app)');
        else lines.push('(No AI summary yet)');
        await navigator.clipboard.writeText(lines.join('\n'));
        toast.success('Copied to clipboard', 'Markdown summary ready to paste');
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
