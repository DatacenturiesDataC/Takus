// Takus — Goals App (App Platform)
// First-class goal preservation — the mission-critical feature of Takus.
// Goals are platform-agnostic: any source (entry, document, email, manual)
// can create or link to a goal.
//
// Goal lifecycle: aspiration → active → at-risk → achieved | abandoned
// The autonomy engine detects goals from content and monitors health.

import { createAppStub } from '../../lib/app-interface.js';
import { esc, timeAgo, MS_PER_DAY } from '../../lib/utils.js';
import { promptAsync, confirmAsync } from '../../lib/dialog-utils.js';
import { recordSignal } from '../../lib/preference-engine.js';

/** Valid goal states */
export const GOAL_STATES = ['aspiration', 'active', 'at-risk', 'achieved', 'abandoned'];

/** Goal states that count as "open" (not terminal) */
export const OPEN_GOAL_STATES = ['aspiration', 'active', 'at-risk'];

export const GoalApp = createAppStub({
  id: 'goals',
  name: 'Goals',
  version: '1.0.0',
  description: 'Capture, track, and preserve your goals. The system monitors progress and gently flags goals at risk of being forgotten.',
  icon: '🎯',
  category: 'core',
  requires: [],

  async activate(platform) {
    this._platform = platform;
    this._atRiskCount = 0;
    this._goals = [];

    // Register the 'goal' node type
    try {
      const { registerNodeType } = await import('../../lib/graph/node-registry.js');
      registerNodeType({
        type: 'goal',
        label: 'Goal',
        icon: '🎯',
        appId: 'goals',
        requiredProps: ['title', 'state'],
        validate: (node) => {
          const p = node.properties || {};
          if (p.state && !GOAL_STATES.includes(p.state)) return null;
          return node;
        },
      });
    } catch { /* non-critical */ }

    // Load initial goals
    await this._loadGoals();
  },

  async deactivate() {
    this._platform = null;
    this._goals = [];
  },

  /** Reload goals from the graph store */
  async _loadGoals() {
    try {
      const { getNodesByType } = await import('../../lib/storage.js');
      this._goals = await getNodesByType('goal');
      this._atRiskCount = this._goals.filter(g =>
        (g.properties?.state || g.state) === 'at-risk'
      ).length;
    } catch { /* non-critical */
      this._goals = [];
      this._atRiskCount = 0;
    }
  },

  getSettingsSchema() {
    return [
      {
        key: 'healthCheckDays', label: 'Stagnation threshold (days)', type: 'number',
        defaultValue: 14, description: 'Flag a goal as at-risk if not mentioned for this many days',
      },
      {
        key: 'maxActiveGoals', label: 'Active goal limit (gentle nudge)', type: 'number',
        defaultValue: 7, description: 'Suggest focusing when you have more active goals than this',
      },
    ];
  },

  getDefaultSettings() {
    return { healthCheckDays: 14, maxActiveGoals: 7 };
  },

  getNavItem() {
    return {
      id: 'goals',
      label: 'Goals',
      icon: 'flag',
      section: 'productivity',
      order: 4, // Before Inbox (5) and History (10)
      getBadgeCount: () => this._atRiskCount || 0,
    };
  },

  getQuickActions() {
    return [
      {
        id: 'add-goal',
        label: 'Add Goal',
        icon: '🎯',
        primary: false,
        handler: async () => {
          const title = await promptAsync('New Goal', 'What goal would you like to track?');
          if (!title?.trim()) return;
          try {
            const { saveNode } = await import('../../lib/storage.js');
            const { generateId } = await import('../../lib/id.js');
            await saveNode({
              id: generateId(),
              type: 'goal',
              appId: 'goals',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              properties: {
                title: title.trim(),
                state: 'aspiration',
                mentionCount: 0,
                evidence: [],
              },
            });
            recordSignal('GOAL_ACTIVATED', { title: title.trim() });
          } catch (e) {
            console.warn('[Goals] Create failed:', e.message);
          }
        },
      },
    ];
  },

  async renderPanel(container) {
    await this._loadGoals();
    const goals = this._goals;

    // Group by state
    const grouped = {
      active: goals.filter(g => _getState(g) === 'active'),
      'at-risk': goals.filter(g => _getState(g) === 'at-risk'),
      aspiration: goals.filter(g => _getState(g) === 'aspiration'),
      achieved: goals.filter(g => _getState(g) === 'achieved'),
      abandoned: goals.filter(g => _getState(g) === 'abandoned'),
    };

    const totalOpen = grouped.active.length + grouped['at-risk'].length + grouped.aspiration.length;

    if (!goals.length) {
      container.innerHTML = `
        <div class="card card-compact animate-in">
          <div class="card-header"><h3>🎯 Goals</h3></div>
          <div class="empty-state" style="padding:var(--space-6) var(--space-4);">
            <span style="font-size:32px;">🎯</span>
            <p>No goals yet</p>
            <p style="font-size:var(--font-xs);color:var(--color-text-disabled);margin-top:calc(-1 * var(--space-2));">
              Goals are captured from your entries, or add one manually.
            </p>
            <button class="btn btn-primary goal-add-btn" style="margin-top:var(--space-3);font-size:var(--font-sm);padding:6px 16px;">
              🎯 Add Goal
            </button>
          </div>
        </div>`;
      _bindAddGoal(container, this);
      return;
    }

    const analytics = _computeGoalAnalytics(goals, grouped);

    container.innerHTML = `
      <div class="card card-compact animate-in">
        <div class="card-header">
          <h3>🎯 Goals <span style="font-size:11px;font-weight:600;padding:1px 7px;border-radius:8px;background:var(--color-primary-light);color:#000;margin-left:6px;">${totalOpen} open</span></h3>
          <button class="btn btn-sm goal-add-btn" style="font-size:var(--font-xs);background:var(--color-primary);color:#fff;border:none;border-radius:var(--radius-sm);font-weight:600;cursor:pointer;padding:4px 12px;">
            + Add Goal
          </button>
        </div>

        <!-- Goal Analytics -->
        <div style="padding:var(--space-2) var(--space-3);display:flex;flex-direction:column;gap:var(--space-2);">
          <div style="display:flex;align-items:center;gap:var(--space-2);">
            <div style="flex:1;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;display:flex;">
              ${analytics.achievedPct > 0 ? `<div style="width:${analytics.achievedPct}%;background:var(--color-success);transition:width 0.3s;" title="${analytics.achieved} achieved"></div>` : ''}
              ${analytics.activePct > 0 ? `<div style="width:${analytics.activePct}%;background:var(--color-info);transition:width 0.3s;" title="${analytics.active} active"></div>` : ''}
              ${analytics.atRiskPct > 0 ? `<div style="width:${analytics.atRiskPct}%;background:var(--color-error);transition:width 0.3s;" title="${analytics.atRisk} at risk"></div>` : ''}
              ${analytics.aspirationPct > 0 ? `<div style="width:${analytics.aspirationPct}%;background:rgba(255,255,255,0.15);transition:width 0.3s;" title="${analytics.aspirations} aspirations"></div>` : ''}
            </div>
            <span style="font-size:10px;color:var(--color-text-disabled);flex-shrink:0;">${analytics.achievedPct}%</span>
          </div>
          <div style="display:flex;gap:var(--space-3);font-size:10px;color:var(--color-text-muted);flex-wrap:wrap;">
            ${analytics.totalMentions > 0 ? `<span>${analytics.totalMentions} mention${analytics.totalMentions !== 1 ? 's' : ''}</span>` : ''}
            ${analytics.avgAgeDays > 0 ? `<span>avg age: ${analytics.avgAgeDays}d</span>` : ''}
            ${analytics.mostActive ? `<span>🔥 ${esc(analytics.mostActive)}</span>` : ''}
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:var(--space-2);max-height:clamp(250px,45vh,500px);overflow-y:auto;">
          ${_renderSection('🔴 At Risk', grouped['at-risk'], 'var(--color-error)')}
          ${_renderSection('🟢 Active', grouped.active, 'var(--color-success)')}
          ${_renderSection('💭 Aspirations', grouped.aspiration, 'var(--color-info)')}
          ${_renderSection('✅ Achieved', grouped.achieved, 'var(--color-text-muted)')}
          ${_renderSection('🚫 Abandoned', grouped.abandoned, 'var(--color-text-disabled)')}
        </div>
      </div>`;

    _bindAddGoal(container, this);
    _bindGoalActions(container, this);

    // Async: enrich active/at-risk goals with task-based progress
    _enrichGoalProgress(container).catch(() => {});
  },

  getNodeTypes() { return ['goal']; },
  getEdgeTypes() { return ['CONTRIBUTES_TO', 'SUPPORTS', 'INVOLVES']; },

  getStepTypes() {
    return [
      { type: 'goal_detection', handler: _goalDetectionHandler, autoApprove: true },
      { type: 'goal_health_check', handler: _goalHealthCheckHandler, autoApprove: true },
    ];
  },

  getAutoRunPresets() {
    return [
      {
        field: 'type', operator: 'equals', value: 'meeting',
        label: 'Auto-detect goals from meetings',
        description: 'Automatically extract goals mentioned in meeting transcripts',
      },
    ];
  },

  /**
   * Poll for at-risk goals that need attention.
   * Surfaces goals approaching or exceeding the stagnation threshold
   * as inbox items so the user is reminded to act.
   * @returns {Promise<import('../../lib/inbound-poller.js').InboundItem[]>}
   */
  async pollInbound() {
    await this._loadGoals();
    const settings = this.getDefaultSettings();
    const stagnationMs = (settings.healthCheckDays || 14) * MS_PER_DAY;
    const warningMs = stagnationMs * 0.75; // Warn at 75% of threshold
    const now = Date.now();
    const items = [];

    for (const goal of this._goals) {
      const props = goal.properties || {};
      const state = props.state || 'aspiration';

      // Only surface open goals
      if (!['active', 'at-risk'].includes(state)) continue;

      const lastMention = props.lastMentionedAt || goal.createdAt || 0;
      const silenceDays = Math.round((now - lastMention) / MS_PER_DAY);

      // Surface if approaching or past stagnation threshold
      if (now - lastMention > warningMs) {
        const isAtRisk = state === 'at-risk';
        items.push({
          sourceId: `goal-reminder-${goal.id}-${Math.floor(now / MS_PER_DAY)}`,
          sourceApp: 'goals',
          title: `${isAtRisk ? '🔴' : '⚠️'} Goal needs attention: ${props.title || 'Untitled'}`,
          textContent: `Your goal "${props.title}" hasn't been mentioned in ${silenceDays} day${silenceDays !== 1 ? 's' : ''}. ${isAtRisk ? 'It is now at risk of being forgotten.' : 'Consider reviewing your progress.'}`,
          type: 'goal-reminder',
          date: now,
          tags: ['goal', 'reminder', isAtRisk ? 'at-risk' : 'stagnating'],
          metadata: { goalId: goal.id, silenceDays, state },
          autoProcess: false,
        });
      }
    }

    return items;
  },

  canProduceInboxItems: true,
});

// ── Step Handlers ────────────────────────────────────────────────────────────

/**
 * Goal detection step — extracts goals from any text content.
 * Platform-agnostic: works on transcripts, documents, notes, etc.
 */
async function _goalDetectionHandler(step, context) {
  if (!context.text && !context.transcript) return { detected: 0 };
  if (!context.apiKey) return { detected: 0 };

  const text = context.text || context.transcript;
  const { extractGoals } = await import('../../lib/ai-engine.js');
  const { getNodesByType, saveNode, addEdge, updateNode } = await import('../../lib/storage.js');

  const existingGoals = await getNodesByType('goal');
  const result = await extractGoals(text, existingGoals, context.apiKey, context.aiProvider || 'openai');

  let detected = 0;
  for (const goal of result.goals || []) {
    if (goal.matchedGoalId) {
      // Link source to existing goal
      if (context.sourceId) {
        await addEdge({
          sourceType: context.sourceType || 'entry',
          sourceId: context.sourceId,
          targetType: 'goal',
          targetId: goal.matchedGoalId,
          edgeType: 'CONTRIBUTES_TO',
          metadata: { evidence: goal.evidence, detectedAt: Date.now() },
        }).catch(() => {});

        // Update lastMentionedAt
        await updateNode(goal.matchedGoalId, (existing) => {
          if (!existing || existing.type !== 'goal') return null;
          existing.properties.lastMentionedAt = Date.now();
          existing.properties.mentionCount = (existing.properties.mentionCount || 0) + 1;
          return existing;
        }).catch(() => {});
      }
    } else {
      // New goal detected — create as graph node
      const { createNode } = await import('../../lib/graph/node-registry.js');
      const goalNode = createNode('goal', {
        title: goal.title,
        description: goal.description || '',
        state: 'aspiration', // New goals start as aspirations
        targetDate: null,
        createdAt: Date.now(),
        lastMentionedAt: Date.now(),
        mentionCount: 1,
        progressNotes: goal.evidence ? [goal.evidence] : [],
        source: context.sourceType || 'unknown', // Platform-agnostic source
      }, { appId: 'goals' });

      await saveNode(goalNode).catch(() => {});

      // Link source to new goal
      if (context.sourceId) {
        await addEdge({
          sourceType: context.sourceType || 'entry',
          sourceId: context.sourceId,
          targetType: 'goal',
          targetId: goalNode.id,
          edgeType: 'CONTRIBUTES_TO',
          metadata: { evidence: goal.evidence, detectedAt: Date.now() },
        }).catch(() => {});
      }
    }
    detected++;
  }

  return { detected };
}

/**
 * Goal health check step — flags stagnating goals.
 * Runs on every autonomy tick (lightweight — pure data query).
 */
async function _goalHealthCheckHandler(step, context) {
  const { getNodesByType, updateNode } = await import('../../lib/storage.js');
  const goals = await getNodesByType('goal');

  const stagnationDays = context.healthCheckDays || 14;
  const stagnationMs = stagnationDays * MS_PER_DAY;
  const now = Date.now();

  let flagged = 0;
  for (const goal of goals) {
    const props = goal.properties || {};
    // Only check active goals
    if (props.state !== 'active') continue;

    const lastMention = props.lastMentionedAt || goal.createdAt || 0;
    if (now - lastMention > stagnationMs) {
      const updated = await updateNode(goal.id, (node) => {
        if (!node || node.properties?.state !== 'active') return null;
        node.properties.state = 'at-risk';
        return node;
      }).catch(() => null);
      if (updated) flagged++;
    }
  }

  return { flagged };
}

// ── UI Helpers ──────────────────────────────────────────────────────────────

function _getState(goal) {
  return goal.properties?.state || goal.state || 'aspiration';
}

function _renderSection(heading, goals, borderColor) {
  if (!goals.length) return '';
  return `
      <div class="goal-section-header">
        ${heading} (${goals.length})
      </div>
      ${goals.map(g => {
        const props = g.properties || {};
        const title = esc(props.title || 'Untitled goal');
        const desc = esc(props.description || '');
        const mentions = props.mentionCount || 0;
        const lastMention = props.lastMentionedAt
          ? timeAgo(new Date(props.lastMentionedAt))
          : 'never';
        const targetDate = props.targetDate;
        const deadlineBadge = (() => {
          if (!targetDate) return '';
          const daysLeft = Math.round((targetDate - Date.now()) / MS_PER_DAY);
          if (daysLeft < 0) return `<span style="color:var(--color-error);font-weight:var(--weight-semi);">⚠ ${Math.abs(daysLeft)}d overdue</span>`;
          if (daysLeft <= 7) return `<span style="color:var(--color-warning);font-weight:var(--weight-semi);">${daysLeft}d left</span>`;
          return `<span>${daysLeft}d left</span>`;
        })();
        const ageDays = g.createdAt ? Math.round((Date.now() - g.createdAt) / MS_PER_DAY) : 0;

        return `
          <div class="goal-card" data-id="${g.id}" data-state="${_getState(g)}" style="border-left:3px solid ${borderColor};">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:var(--font-sm);font-weight:var(--weight-medium);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</span>
              <div class="goal-actions" style="display:flex;gap:4px;flex-shrink:0;">
                ${_getState(g) === 'aspiration' ? `<button class="btn btn-sm goal-activate" data-id="${g.id}" title="Activate" style="font-size:10px;padding:1px 6px;border-radius:4px;background:var(--color-success);color:#fff;border:none;cursor:pointer;">▶</button>` : ''}
                ${_getState(g) === 'active' || _getState(g) === 'at-risk' ? `<button class="btn btn-sm goal-achieve" data-id="${g.id}" title="Mark achieved" style="font-size:10px;padding:1px 6px;border-radius:4px;background:var(--color-success);color:#fff;border:none;cursor:pointer;">✓</button>` : ''}
                ${OPEN_GOAL_STATES.includes(_getState(g)) ? `<button class="btn btn-sm goal-abandon" data-id="${g.id}" title="Abandon" style="font-size:10px;padding:1px 6px;border-radius:4px;background:var(--color-text-muted);color:#fff;border:none;cursor:pointer;">✕</button>` : ''}
                ${!OPEN_GOAL_STATES.includes(_getState(g)) ? `<button class="btn btn-sm goal-delete" data-id="${g.id}" title="Delete permanently" style="font-size:10px;padding:1px 6px;border-radius:4px;background:transparent;color:var(--color-text-disabled);border:1px solid rgba(255,255,255,0.1);cursor:pointer;">🗑</button>` : ''}
              </div>
            </div>
            ${desc ? `<div style="font-size:var(--font-xs);color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${desc}</div>` : ''}
            <div style="font-size:10px;color:var(--color-text-disabled);display:flex;gap:var(--space-2);flex-wrap:wrap;">${mentions} mention${mentions !== 1 ? 's' : ''} · last: ${lastMention}${ageDays > 0 ? ` · age: ${ageDays}d` : ''}${deadlineBadge ? ` · ${deadlineBadge}` : ''}</div>
          </div>`;
      }).join('')}
    </div>`;
}

function _bindAddGoal(container, app) {
  container.querySelectorAll('.goal-add-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      // Simple inline creation — prompt for title
      const title = await promptAsync('What is your goal?');
      if (!title?.trim()) return;

      // Optional: prompt for target date (skip = no deadline)
      const dateStr = await promptAsync('Target date? (YYYY-MM-DD or leave blank)', '').catch(() => '');
      const parsedDate = dateStr?.trim() ? Date.parse(dateStr.trim()) : NaN;
      const targetDate = Number.isFinite(parsedDate) ? parsedDate : null;

      try {
        const { createNode } = await import('../../lib/graph/node-registry.js');
        const { saveNode } = await import('../../lib/storage.js');
        const goalNode = createNode('goal', {
          title: title.trim(),
          description: '',
          state: 'active',
          targetDate,
          createdAt: Date.now(),
          lastMentionedAt: Date.now(),
          mentionCount: 0,
          progressNotes: [],
          source: 'manual',
        }, { appId: 'goals' });

        await saveNode(goalNode);
        const { toast } = await import('../../components/toast.js');
        toast.success('Goal created', `"${title.trim()}" is now active`);
        app.renderPanel(container); // Re-render
      } catch (err) {
        const { toast } = await import('../../components/toast.js');
        toast.error('Failed to create goal', err.message);
      }
    });
  });
}

function _bindGoalActions(container, app) {
  const updateState = async (id, newState) => {
    try {
      const { updateNode } = await import('../../lib/storage.js');
      let title = 'Untitled';
      const updated = await updateNode(id, (node) => {
        if (!node || node.type !== 'goal') return null;
        title = node.properties?.title || 'Untitled';
        node.properties.state = newState;
        return node;
      });
      if (!updated) return;

      // Record preference signal for goal lifecycle actions
      if (newState === 'active') {
        recordSignal('GOAL_ACTIVATED', { goalId: id, title }).catch(() => {});
      } else if (newState === 'achieved') {
        recordSignal('GOAL_ACHIEVED', { goalId: id, title }).catch(() => {});
      } else if (newState === 'abandoned') {
        recordSignal('GOAL_ABANDONED', { goalId: id, title }).catch(() => {});
      }

      app.renderPanel(container);
    } catch { /* non-critical */ }
  };

  container.querySelectorAll('.goal-activate').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); updateState(btn.dataset.id, 'active'); })
  );
  container.querySelectorAll('.goal-achieve').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); updateState(btn.dataset.id, 'achieved'); })
  );
  container.querySelectorAll('.goal-abandon').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); updateState(btn.dataset.id, 'abandoned'); })
  );
  container.querySelectorAll('.goal-delete').forEach(btn =>
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!(await confirmAsync('Delete this goal permanently? This cannot be undone.', { confirmLabel: 'Delete', destructive: true }))) return;
      try {
        const { deleteNode, removeEdgesForNode } = await import('../../lib/storage.js');
        await Promise.all([
          deleteNode(btn.dataset.id),
          removeEdgesForNode('goal', btn.dataset.id).catch(() => {}),
        ]);
        app.renderPanel(container);
      } catch { /* non-critical */ }
    })
  );
}

// ── Goal Analytics ──────────────────────────────────────────

/**
 * Compute analytics from a set of goals.
 * Platform-agnostic: pure function, no API calls.
 *
 * @param {object[]} goals - Goal nodes
 * @param {object} [grouped] - Pre-grouped goals by state (optional, computed if absent)
 * @returns {object} Analytics object
 */
function _computeGoalAnalytics(goals, grouped) {
  if (!grouped) {
    grouped = {
      active: goals.filter(g => _getState(g) === 'active'),
      'at-risk': goals.filter(g => _getState(g) === 'at-risk'),
      aspiration: goals.filter(g => _getState(g) === 'aspiration'),
      achieved: goals.filter(g => _getState(g) === 'achieved'),
      abandoned: goals.filter(g => _getState(g) === 'abandoned'),
    };
  }

  const total = goals.length || 1; // Avoid division by zero
  const achieved = grouped.achieved.length;
  const active = grouped.active.length;
  const atRisk = grouped['at-risk'].length;
  const aspirations = grouped.aspiration.length;
  const abandoned = grouped.abandoned.length;

  // Achievement % (achieved / non-abandoned)
  const nonAbandoned = total - abandoned || 1;
  const achievedPct = Math.round((achieved / nonAbandoned) * 100);

  // State distribution %
  const activePct = Math.round((active / total) * 100);
  const atRiskPct = Math.round((atRisk / total) * 100);
  const aspirationPct = Math.round((aspirations / total) * 100);

  // Average goal age (days since creation for open goals)
  const now = Date.now();
  const openGoals = goals.filter(g => OPEN_GOAL_STATES.includes(_getState(g)));
  const avgAgeDays = openGoals.length > 0
    ? Math.round(openGoals.reduce((sum, g) => sum + (now - (g.createdAt || now)), 0) / openGoals.length / MS_PER_DAY)
    : 0;

  // Total mentions (from CONTRIBUTES_TO edges metadata)
  const totalMentions = goals.reduce((sum, g) => sum + (g.properties?.mentionCount || 0), 0);

  // Most active goal (most mentions among open goals)
  const mostActiveGoal = openGoals.length > 0
    ? openGoals.reduce((best, g) => ((g.properties?.mentionCount || 0) > (best?.properties?.mentionCount || 0) ? g : best), openGoals[0])
    : null;
  const mostActive = mostActiveGoal?.properties?.title || '';

  return {
    total: goals.length,
    achieved, active, atRisk, aspirations, abandoned,
    achievedPct, activePct, atRiskPct, aspirationPct,
    avgAgeDays,
    totalMentions,
    mostActive: mostActive.length > 25 ? mostActive.slice(0, 23) + '…' : mostActive,
  };
}

/**
 * Exported platform utility — compute goal analytics from storage.
 * Any intelligence surface can call this (Daily Digest, Ask, Insights).
 *
 * @returns {Promise<object>} Goal analytics summary
 */
export async function computeGoalAnalytics() {
  try {
    const { getNodesByType } = await import('../../lib/storage.js');
    const goals = await getNodesByType('goal').catch(() => []);
    return _computeGoalAnalytics(goals);
  } catch { /* non-critical */
    return { total: 0, achieved: 0, active: 0, atRisk: 0, aspirations: 0, abandoned: 0, achievedPct: 0, activePct: 0, atRiskPct: 0, aspirationPct: 0, avgAgeDays: 0, totalMentions: 0, mostActive: '' };
  }
}

export default GoalApp;

// ── Goal Progress Enrichment ────────────────────────────────────────────

/**
 * Enrich rendered goal cards with task-based progress bars.
 * Called async after renderPanel — non-blocking.
 */
async function _enrichGoalProgress(container) {
  try {
    const { computeGoalProgress } = await import('../../lib/goal-linker.js');
    const cards = container.querySelectorAll('.goal-card');
    for (const card of cards) {
      const id = card.dataset.id;
      const state = card.dataset.state;
      if (state !== 'active' && state !== 'at-risk') continue;
      const progress = await computeGoalProgress(id);
      if (progress.total === 0) continue;
      // Inject a tiny progress bar below the card content
      const bar = document.createElement('div');
      bar.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:2px;';
      bar.innerHTML = `
        <div style="flex:1;height:3px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
          <div style="width:${progress.progressPct}%;height:100%;background:var(--color-success);border-radius:2px;transition:width 0.3s;"></div>
        </div>
        <span style="font-size:9px;color:var(--color-text-disabled);">${progress.done}/${progress.total} tasks</span>`;
      card.appendChild(bar);
    }
  } catch { /* goal-linker not available — skip */ }
}
