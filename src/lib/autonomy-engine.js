// Takus — Autonomy Engine (Knowledge OS: Intelligence Layer)
// Background loop that continuously processes pending knowledge work:
//   1. Auto-embed unembedded transcripts
//   2. Auto-compute similarity edges
//   3. Auto-recompute stale closeness scores
//   4. Auto-execute pending Takus-assigned task steps
//
// Uses requestIdleCallback + visibilitychange to never block UI or entry.
// All actions are logged to localStorage for auditability.

import { getEntries, getAllEmbeddings, saveEmbeddings, getContacts, getContentItems, getAllEngagementEvents, saveContentItem } from './storage.js';
import { getSettings, getEffectiveAIConfig } from './settings-store.js';
import { MS_PER_DAY } from './utils.js';
import { embedTranscript } from './embeddings.js';
import { recomputeScores } from './closeness-worker.js';
import { registerStep, executeStep, createStep } from './step-executor.js';
import { averageEmbedding } from './graph/vector-utils.js';

// ── Register autonomy steps in the step-executor registry ────────────────────

registerStep('autonomy_embed', async (step, ctx) => {
  const chunks = await embedTranscript(ctx.transcript, ctx.contentId, ctx.apiKey, ctx.provider, ctx.aiConfig || null);
  if (chunks?.length > 0) await saveEmbeddings(ctx.contentId, chunks);
  return { chunks: chunks?.length || 0 };
}, { autoApprove: true });

registerStep('autonomy_closeness', async () => {
  return await recomputeScores();
}, { autoApprove: true });

registerStep('autonomy_knowledge_levels', async () => {
  const { resolveAllLevels } = await import('./knowledge-level.js');
  const { getConfig } = await import('./config.js');
  const contacts = await getContacts();
  const contentItems = await getContentItems();
  const engagementEvents = await getAllEngagementEvents();
  if (!contentItems.length) return { updated: 0 };

  const config = getConfig();
  const currentUserId = config.userId || 'local-user';
  const contactMap = new Map(contacts.map(c => [c.id, c]));
  const engagedContentIds = new Set(engagementEvents.map(e => e.contentId));

  const results = resolveAllLevels(contentItems, currentUserId, contactMap, engagedContentIds);
  let updated = 0;
  for (const r of results.filter(r => r.changed)) {
    const item = contentItems.find(i => i.id === r.id);
    if (item) {
      item.knowledgeLevel = r.newLevel;
      await saveContentItem(item);
      // Sync the level back to the entry so history-panel can display it
      try {
        const { getEntry, saveEntry } = await import('./storage.js');
        const entry = await getEntry(item.id);
        if (entry && entry.knowledgeLevel !== r.newLevel) {
          entry.knowledgeLevel = r.newLevel;
          await saveEntry(entry);
        }
      } catch { /* entry may not exist for this content item */ }
      updated++;
    }
  }
  return { updated };
}, { autoApprove: true });

registerStep('autonomy_archive_scan', async () => {
  const { isEnabled } = await import('./feature-flags.js');
  if (!await isEnabled('archiveEngine')) return { skipped: true };
  const { scanEligibleEntries } = await import('./archive-engine.js');
  const eligible = await scanEligibleEntries();
  return { eligible: eligible.length };
}, { autoApprove: true });

registerStep('autonomy_cold_storage_scan', async () => {
  const { isEnabled } = await import('./feature-flags.js');
  if (!await isEnabled('archiveEngine')) return { skipped: true };
  const { scanEligibleColdStorageEntries, transitionToColdStorage } = await import('./archive-engine.js');
  const eligible = await scanEligibleColdStorageEntries();
  let transitioned = 0;
  for (const { entry } of eligible) {
    const res = await transitionToColdStorage(entry);
    if (res.success) transitioned++;
  }
  return { eligible: eligible.length, transitioned };
}, { autoApprove: true });

registerStep('autonomy_goal_health', async (step, ctx) => {
  const { getNodesByType, saveNode } = await import('./storage.js');
  const goals = await getNodesByType('goal');
  const stagnationMs = (ctx.healthCheckDays || 14) * MS_PER_DAY;
  const now = Date.now();
  let flagged = 0;
  for (const goal of goals) {
    const props = goal.properties || {};
    if (props.state !== 'active') continue;
    const lastMention = props.lastMentionedAt || goal.createdAt || 0;
    if (now - lastMention > stagnationMs) {
      props.state = 'at-risk';
      goal.updatedAt = now;
      await saveNode(goal).catch(e => { console.warn('[Autonomy] Goal state save failed:', e.message); });
      flagged++;
    }
  }
  return { flagged };
}, { autoApprove: true });

// ── Configuration ────────────────────────────────────────────────────────────

const TICK_INTERVAL_MS = 30_000;  // 30 seconds between ticks
const CLOSENESS_STALE_MS = 86_400_000; // 24 hours (inlined to avoid TDZ in Rollup)
const MAX_LOG_ENTRIES = 100;
const LOG_KEY = 'takus_autonomy_log';
const CLOSENESS_KEY = 'takus_last_closeness_recompute';

// ── State ────────────────────────────────────────────────────────────────────

let _running = false;
let _ticking = false; // Prevent concurrent tick execution
let _tickTimer = null;
let _idleHandle = null;
let _listeners = [];
let _stats = { embeddings: 0, similarity: 0, closeness: 0, knowledgeLevels: 0, goals: 0, goalLinks: 0, tasks: 0, errors: 0, lastTick: 0 };

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the autonomy engine.
 * Hooks into visibilitychange to pause/resume automatically.
 */
export function startAutonomy() {
  if (_running) return;
  _running = true;
  _log('engine_start', 'Autonomy engine started');

  // Resume interrupted step executions from IDB checkpoints (best-effort)
  _resumeInterruptedSteps().catch(e => { console.warn('[Autonomy] Step resumption failed:', e.message); });

  // Run first tick after a short delay to let the UI settle
  _tickTimer = setTimeout(_scheduleTick, 5_000);

  // Pause when page is hidden, resume when visible
  document.addEventListener('visibilitychange', _handleVisibility);
  _emit('start');
}

/**
 * Attempt to resume interrupted step executions from IDB checkpoints.
 * Called once on startup.
 */
async function _resumeInterruptedSteps() {
  try {
    const { resumeCheckpoints } = await import('./step-executor.js');
    const result = await resumeCheckpoints();
    if (result.resumed > 0) {
      _log('checkpoint_resume', `Resumed ${result.resumed} interrupted task(s), completed ${result.completed}`);
    }
  } catch { /* step-executor or storage not available */ }
}

/**
 * Stop the autonomy engine.
 */
export function stopAutonomy() {
  if (!_running) return;
  _running = false;
  if (_tickTimer) { clearTimeout(_tickTimer); _tickTimer = null; }
  if (_idleHandle && typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(_idleHandle);
    _idleHandle = null;
  }
  document.removeEventListener('visibilitychange', _handleVisibility);
  _log('engine_stop', 'Autonomy engine stopped');
  _emit('stop');
}

/**
 * Check if the engine is currently running.
 * @returns {boolean}
 */
export function isAutonomyRunning() {
  return _running;
}

/**
 * Get current autonomy statistics.
 * @returns {{ embeddings: number, similarity: number, closeness: number, tasks: number, errors: number, lastTick: number }}
 */
export function getAutonomyStats() {
  return { ..._stats };
}

/**
 * Subscribe to autonomy events.
 * @param {function(string, object): void} fn  Called with (eventType, data)
 * @returns {function} Unsubscribe function
 */
export function onAutonomyEvent(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

/**
 * Get the autonomy action log.
 * @returns {Array<{time: number, type: string, detail: string}>}
 */
export function getAutonomyLog() {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
  } catch { return []; }
}

// ── Tick Loop ────────────────────────────────────────────────────────────────

function _scheduleTick() {
  if (!_running || document.hidden) return;

  // Use requestIdleCallback if available, otherwise setTimeout
  if (typeof requestIdleCallback === 'function') {
    _idleHandle = requestIdleCallback(_tick, { timeout: 10_000 });
  } else {
    _idleHandle = setTimeout(_tick, 500);
  }
}

async function _tick() {
  if (!_running || document.hidden || _ticking) {
    _tickTimer = setTimeout(_scheduleTick, TICK_INTERVAL_MS);
    return;
  }

  _ticking = true;
  _stats.lastTick = Date.now();
  _emit('tick_start');

  try {
    // 1. Auto-embed unembedded transcripts
    await _autoEmbed();

    // 2. Auto-recompute stale closeness scores
    await _autoCloseness();

    // 3. Auto-recompute knowledge levels (runs every tick, fast if nothing changed)
    await _autoKnowledgeLevels();

    // 4. Auto-scan for archivable entries (flag-gated)
    await _autoArchiveScan();

    // 4b. Auto-scan for cold storage transition
    await _autoColdStorageScan();

    // 5. Auto-check goal health (flag stagnating goals as at-risk)
    await _autoGoalHealth();

    // 5b. Auto-link tasks → goals
    await _autoGoalTaskLinking();

    // 6. Proactive quota monitoring (every tick, lightweight)
    await _checkStorageQuota();

    // 7. Well-being check (break suggestions, goal/task/meeting overload)
    await _autoWellbeing();

  } catch (e) {
    _stats.errors++;
    console.warn('[Autonomy] Tick error:', e.message);
  }

  _emit('tick_end', _stats);
  _ticking = false;

  // Schedule next tick
  _tickTimer = setTimeout(_scheduleTick, TICK_INTERVAL_MS);
}

// ── Autonomous Actions ───────────────────────────────────────────────────────

/** Map of entryId → timestamp of last failed embed attempt (skip for 24h) */
const _embedBackoff = new Map();
const EMBED_BACKOFF_MS = 86_400_000; // 24 hours

/**
 * Find entries with transcripts but no embeddings, and auto-embed them.
 * Skips entries that failed embedding within the last 24 hours.
 */
async function _autoEmbed() {
  const aiConfig = getEffectiveAIConfig();
  const apiKey = aiConfig.apiKey;
  const provider = aiConfig.provider;
  if (!apiKey && !aiConfig.useProxy) return; // No API key and no proxy — can't embed

  let entries, allEmb;
  try {
    [entries, allEmb] = await Promise.all([getEntries(), getAllEmbeddings()]);
  } catch { return; }

  const embeddedIds = new Set(allEmb.filter(e => e.chunks?.length > 0).map(e => e.contentId));
  const now = Date.now();

  // Prune expired backoff entries (older than 24h) to prevent unbounded growth
  for (const [id, ts] of _embedBackoff) {
    if (now - ts > EMBED_BACKOFF_MS) _embedBackoff.delete(id);
  }

  // Find entries with transcripts that aren't yet embedded and aren't in backoff
  const unembedded = entries.filter(r =>
    r.textContent && r.textContent.length > 50 && !embeddedIds.has(r.id) && !_embedBackoff.has(r.id)
  );

  if (unembedded.length === 0) return;

  // Process one at a time to avoid API rate limits
  const entry = unembedded[0];
  try {
    const step = createStep('autonomy_embed', `Embed: ${entry.title || entry.id}`);
    const result = await executeStep(step, {
      transcript: entry.textContent,
      contentId: entry.id,
      apiKey,
      provider,
      aiConfig,
    });
    if (result.success && result.result?.chunks > 0) {
      _stats.embeddings++;
      _log('auto_embed', `Embedded transcript for "${entry.title || entry.id}" (${result.result.chunks} chunks)`);
      _emit('embed_complete', { contentId: entry.id, chunks: result.result.chunks });

      // Reload embeddings to include new ones for similarity
      const freshEmb = await getAllEmbeddings();
      const newChunks = freshEmb.find(e => e.contentId === entry.id)?.chunks || [];
      if (newChunks.length > 0) {
        await _autoSimilarity(entry.id, newChunks, freshEmb);
      }
    } else {
      // Embedding returned no chunks — back off to avoid infinite retry
      _embedBackoff.set(entry.id, now);
    }
  } catch (e) {
    _stats.errors++;
    _embedBackoff.set(entry.id, now); // Back off on failure
    console.warn('[Autonomy] Auto-embed failed:', e.message);
  }
}

/**
 * Compute similarity edges between a newly embedded entry and all others.
 */
async function _autoSimilarity(contentId, newChunks, allEmb) {
  try {
    const { addEdge } = await import('./storage.js');
    const { cosineSimilarity } = await import('./embeddings.js');

    // Average embedding for the new entry
    const newAvg = averageEmbedding(newChunks);
    if (!newAvg) return;

    for (const other of allEmb) {
      if (other.contentId === contentId || !other.chunks?.length) continue;
      const otherAvg = averageEmbedding(other.chunks);
      if (!otherAvg) continue;

      const sim = cosineSimilarity(newAvg, otherAvg);
      if (sim >= 0.70) {
        await addEdge({
          sourceType: 'entry',
          sourceId: contentId,
          targetType: 'entry',
          targetId: other.contentId,
          edgeType: 'SIMILAR_TO',
          metadata: { score: Math.round(sim * 1000) / 1000 },
        });
        _stats.similarity++;
      }
    }
    if (_stats.similarity > 0) {
      _log('auto_similarity', `Computed similarity edges for entry ${contentId}`);
    }
  } catch (e) {
    console.warn('[Autonomy] Similarity computation failed:', e.message);
  }
}

/**
 * Recompute closeness scores if they're stale (>24h since last run).
 */
async function _autoCloseness() {
  let lastRun = 0;
  try { lastRun = Number(localStorage.getItem(CLOSENESS_KEY)) || 0; } catch { /* non-critical */ }

  if (Date.now() - lastRun < CLOSENESS_STALE_MS) return;

  try {
    const step = createStep('autonomy_closeness', 'Recompute closeness scores');
    const execResult = await executeStep(step, {});
    const result = execResult.result || { updated: 0, crossed: [] };
    if (result.updated > 0) {
      _stats.closeness += result.updated;
      _log('auto_closeness', `Recomputed ${result.updated} contact scores, ${result.crossed.length} threshold crossings`);
      _emit('closeness_recomputed', result);
    }
  } catch (e) {
    console.warn('[Autonomy] Closeness recompute failed:', e.message);
  }
}

/**
 * Re-evaluate knowledge levels for all content items.
 * Fast if nothing changed — resolveAllLevels is pure computation.
 */
async function _autoKnowledgeLevels() {
  try {
    const step = createStep('autonomy_knowledge_levels', 'Recompute knowledge levels');
    const execResult = await executeStep(step, {});
    const result = execResult.result || { updated: 0 };
    if (result.updated > 0) {
      _stats.knowledgeLevels += result.updated;
      _log('auto_knowledge_levels', `Updated ${result.updated} content items`);
    }
  } catch (e) {
    console.warn('[Autonomy] Knowledge level recompute failed:', e.message);
  }
}

/**
 * Scan for entries eligible for archival (gated by archiveEngine flag).
 */
async function _autoArchiveScan() {
  try {
    const step = createStep('autonomy_archive_scan', 'Scan for archivable entries');
    const execResult = await executeStep(step, {});
    const result = execResult.result || { eligible: 0, skipped: false };
    if (result.skipped) return;
    if (result.eligible > 0) {
      _log('auto_archive_scan', `Found ${result.eligible} entries eligible for archival`);
    }
  } catch (e) {
    console.warn('[Autonomy] Archive scan failed:', e.message);
  }
}

/**
 * Scan for archived entries eligible for cold storage transition.
 */
async function _autoColdStorageScan() {
  try {
    const step = createStep('autonomy_cold_storage_scan', 'Scan for cold storage transition');
    const execResult = await executeStep(step, {});
    const result = execResult.result || { eligible: 0, transitioned: 0, skipped: false };
    if (result.skipped) return;
    if (result.transitioned > 0) {
      _log('auto_cold_storage_scan', `Transitioned ${result.transitioned} / ${result.eligible} entries to cold storage`);
    }
  } catch (e) {
    console.warn('[Autonomy] Cold storage scan failed:', e.message);
  }
}

/**
 * Check goal health — flag stagnating active goals as at-risk.
 * Lightweight: reads goal nodes, checks lastMentionedAt timestamps.
 * Uses the GoalApp's configurable threshold (default 14 days).
 */
async function _autoGoalHealth() {
  try {
    // Read GoalApp's user-configurable stagnation threshold
    let healthCheckDays = 14;
    try {
      const { getAppSettings } = await import('./app-manager.js');
      const goalSettings = await getAppSettings('goals');
      if (goalSettings?.healthCheckDays > 0) healthCheckDays = goalSettings.healthCheckDays;
    } catch { /* app manager not initialized — use default */ }

    const step = createStep('autonomy_goal_health', 'Check goal health');
    const execResult = await executeStep(step, { healthCheckDays });
    const result = execResult.result || { flagged: 0 };
    if (result.flagged > 0) {
      _stats.goals += result.flagged;
      _log('auto_goal_health', `Flagged ${result.flagged} goal(s) as at-risk (threshold: ${healthCheckDays}d)`);
      _emit('goals_at_risk', { flagged: result.flagged });
    }
  } catch (e) {
    console.warn('[Autonomy] Goal health check failed:', e.message);
  }
}

/**
 * Auto-link pending tasks to goals via keyword matching.
 * Runs the goal-linker's autoLinkTasks() to create CONTRIBUTES_TO edges.
 * Lightweight: pure local text matching, no API calls.
 */
async function _autoGoalTaskLinking() {
  try {
    const { autoLinkTasks } = await import('./goal-linker.js');
    const result = await autoLinkTasks();
    if (result.linked > 0) {
      _stats.goalLinks += result.linked;
      _log('auto_goal_links', `Linked ${result.linked} task(s) to goals`);
      _emit('goal_tasks_linked', result);
    }
  } catch (e) {
    console.warn('[Autonomy] Goal-task linking failed:', e.message);
  }
}

/**
 * Run well-being checks — break reminders, goal overload, task load, meeting fatigue.
 * Passes goals, tasks, and entries for comprehensive assessment.
 * Lightweight: pure local computation, no API calls.
 */
async function _autoWellbeing() {
  try {
    const { runWellbeingCheck } = await import('./wellbeing.js');
    const { getNodesByType } = await import('./storage.js');
    const { getAllTasks } = await import('./graph/task-store.js');

    const [goals, tasks, entries] = await Promise.all([
      getNodesByType('goal').catch(() => []),
      getAllTasks().catch(() => []),
      getEntries().catch(() => []),
    ]);

    // Load user settings for goals (e.g. max active goals)
    let maxActiveGoals = 7;
    try {
      const { getAppSettings } = await import('./app-manager.js');
      const goalSettings = await getAppSettings('goals');
      if (goalSettings?.maxActiveGoals > 0) {
        maxActiveGoals = goalSettings.maxActiveGoals;
      }
    } catch { /* app manager not initialized — use default */ }

    const result = runWellbeingCheck({
      goals,
      tasks,
      entries,
      maxActiveGoals,
    });
    if (result.suggestion) {
      _log('wellbeing', result.suggestion);
      _emit('wellbeing_suggestion', result);
      // Surface as a gentle toast — use explicit category for notification preference filtering
      try {
        const { notifyEphemeral } = await import('./notification-manager.js');
        const severity = result.taskOverload || result.meetingFatigue ? 'warning' : 'info';
        notifyEphemeral('🌿 Well-being', result.suggestion, severity);
      } catch { /* non-critical */ }
    }
  } catch (e) {
    // Well-being service may not be available — never block autonomy
    console.warn('[Autonomy] Well-being check failed:', e.message);
  }
}

// ── Quota Monitoring ─────────────────────────────────────────────────────────

const QUOTA_WARN_THRESHOLD = 0.80; // 80% usage
let _lastQuotaWarn = 0;
const QUOTA_WARN_COOLDOWN_MS = 21_600_000; // 6 hours (inlined to avoid TDZ in Rollup)

/**
 * Check storage quota and emit a warning if usage is high.
 * Triggers an archive scan to free space proactively.
 */
async function _checkStorageQuota() {
  if (!navigator.storage?.estimate) return;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (!quota || quota === 0) return;
    const ratio = usage / quota;
    if (ratio >= QUOTA_WARN_THRESHOLD && (Date.now() - _lastQuotaWarn) > QUOTA_WARN_COOLDOWN_MS) {
      _lastQuotaWarn = Date.now();
      const usedMB = Math.round(usage / 1_048_576);
      const totalMB = Math.round(quota / 1_048_576);
      const pct = Math.round(ratio * 100);
      _log('quota_warning', `Storage ${pct}% full (${usedMB}/${totalMB} MB)`);
      _emit('quota_warning', { usage, quota, ratio, usedMB, totalMB });
      // Proactively trigger archive scan
      await _autoArchiveScan();
    }
  } catch { /* storage.estimate() may fail in some contexts */ }
}

// ── Helpers ──────────────────────────────────────────────────────────────────


function _handleVisibility() {
  if (document.hidden) {
    // Page hidden — pause
    if (_tickTimer) { clearTimeout(_tickTimer); _tickTimer = null; }
    if (_idleHandle && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(_idleHandle);
      _idleHandle = null;
    }
  } else if (_running) {
    // Page visible again — resume after short delay
    _tickTimer = setTimeout(_scheduleTick, 2_000);
  }
}

function _emit(type, data = {}) {
  for (const fn of _listeners) {
    try { fn(type, data); } catch (e) { console.warn('[Autonomy] Listener error:', e); }
  }
}

function _log(type, detail) {
  try {
    const log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    log.unshift({ time: Date.now(), type, detail });
    // Keep only the last N entries
    if (log.length > MAX_LOG_ENTRIES) log.length = MAX_LOG_ENTRIES;
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch { /* localStorage may be full */ }
}

// ── Test Exports ─────────────────────────────────────────────────────────────
// @internal — these are only imported by test files. Vite tree-shakes them
// from the production bundle since no source module references them.
export {
  _autoWellbeing as testAutoWellbeing,
  _tick as testTick,
  _autoGoalTaskLinking as testAutoGoalTaskLinking,
  _autoGoalHealth as testAutoGoalHealth,
  _autoCloseness as testAutoCloseness,
  _autoEmbed as testAutoEmbed,
  _autoKnowledgeLevels as testAutoKnowledgeLevels,
};
