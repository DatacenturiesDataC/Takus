// Takus — Autonomy Engine (Knowledge OS: Intelligence Layer)
// Background loop that continuously processes pending knowledge work:
//   1. Auto-embed unembedded transcripts
//   2. Auto-compute similarity edges
//   3. Auto-recompute stale closeness scores
//   4. Auto-execute pending Takus-assigned task steps
//
// Uses requestIdleCallback + visibilitychange to never block UI or recording.
// All actions are logged to localStorage for auditability.

import { getRecordings, getAllEmbeddings, saveEmbeddings, getContacts, getContentItems, getAllEngagementEvents, saveContentItem } from './storage.js';
import { getSettings } from './settings-store.js';
import { embedTranscript } from './embeddings.js';
import { recomputeScores } from './closeness-worker.js';
import { registerStep, executeStep, createStep } from './step-executor.js';

// ── Register autonomy steps in the step-executor registry ────────────────────

registerStep('autonomy_embed', async (step, ctx) => {
  const chunks = await embedTranscript(ctx.transcript, ctx.recordingId, ctx.apiKey, ctx.provider);
  if (chunks?.length > 0) await saveEmbeddings(ctx.recordingId, chunks);
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
      updated++;
    }
  }
  return { updated };
}, { autoApprove: true });

registerStep('autonomy_archive_scan', async () => {
  const { isEnabled } = await import('./feature-flags.js');
  if (!await isEnabled('archiveEngine')) return { skipped: true };
  const { scanEligibleRecordings } = await import('./archive-engine.js');
  const eligible = await scanEligibleRecordings();
  return { eligible: eligible.length };
}, { autoApprove: true });

// ── Configuration ────────────────────────────────────────────────────────────

const TICK_INTERVAL_MS = 30_000;  // 30 seconds between ticks
const CLOSENESS_STALE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_LOG_ENTRIES = 100;
const LOG_KEY = 'takus_autonomy_log';
const CLOSENESS_KEY = 'takus_last_closeness_recompute';

// ── State ────────────────────────────────────────────────────────────────────

let _running = false;
let _tickTimer = null;
let _idleHandle = null;
let _listeners = [];
let _stats = { embeddings: 0, similarity: 0, closeness: 0, knowledgeLevels: 0, tasks: 0, errors: 0, lastTick: 0 };

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the autonomy engine.
 * Hooks into visibilitychange to pause/resume automatically.
 */
export function startAutonomy() {
  if (_running) return;
  _running = true;
  _log('engine_start', 'Autonomy engine started');

  // Run first tick after a short delay to let the UI settle
  _tickTimer = setTimeout(_scheduleTick, 5_000);

  // Pause when page is hidden, resume when visible
  document.addEventListener('visibilitychange', _handleVisibility);
  _emit('start');
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
  if (!_running || document.hidden) {
    _tickTimer = setTimeout(_scheduleTick, TICK_INTERVAL_MS);
    return;
  }

  _stats.lastTick = Date.now();
  _emit('tick_start');

  try {
    // 1. Auto-embed unembedded transcripts
    await _autoEmbed();

    // 2. Auto-recompute stale closeness scores
    await _autoCloseness();

    // 3. Auto-recompute knowledge levels (runs every tick, fast if nothing changed)
    await _autoKnowledgeLevels();

    // 4. Auto-scan for archivable recordings (flag-gated)
    await _autoArchiveScan();

  } catch (e) {
    _stats.errors++;
    console.warn('[Autonomy] Tick error:', e.message);
  }

  _emit('tick_end', _stats);

  // Schedule next tick
  _tickTimer = setTimeout(_scheduleTick, TICK_INTERVAL_MS);
}

// ── Autonomous Actions ───────────────────────────────────────────────────────

/**
 * Find recordings with transcripts but no embeddings, and auto-embed them.
 */
async function _autoEmbed() {
  const settings = getSettings();
  const apiKey = settings.aiProvider === 'gemini' ? settings.geminiKey : settings.openaiKey;
  if (!apiKey) return; // No API key — can't embed

  let recordings, allEmb;
  try {
    [recordings, allEmb] = await Promise.all([getRecordings(), getAllEmbeddings()]);
  } catch { return; }

  const embeddedIds = new Set(allEmb.filter(e => e.chunks?.length > 0).map(e => e.recordingId));

  // Find recordings with transcripts that aren't yet embedded
  const unembedded = recordings.filter(r =>
    r.aiTranscript && r.aiTranscript.length > 50 && !embeddedIds.has(r.id)
  );

  if (unembedded.length === 0) return;

  // Process one at a time to avoid API rate limits
  const rec = unembedded[0];
  try {
    const step = createStep('autonomy_embed', `Embed: ${rec.title || rec.id}`);
    const result = await executeStep(step, {
      transcript: rec.aiTranscript,
      recordingId: rec.id,
      apiKey,
      provider: settings.aiProvider,
    });
    if (result.success && result.result?.chunks > 0) {
      _stats.embeddings++;
      _log('auto_embed', `Embedded transcript for "${rec.title || rec.id}" (${result.result.chunks} chunks)`);
      _emit('embed_complete', { recordingId: rec.id, chunks: result.result.chunks });

      // Reload embeddings to include new ones for similarity
      const freshEmb = await getAllEmbeddings();
      const newChunks = freshEmb.find(e => e.recordingId === rec.id)?.chunks || [];
      if (newChunks.length > 0) {
        await _autoSimilarity(rec.id, newChunks, freshEmb);
      }
    }
  } catch (e) {
    _stats.errors++;
    console.warn('[Autonomy] Auto-embed failed:', e.message);
  }
}

/**
 * Compute similarity edges between a newly embedded recording and all others.
 */
async function _autoSimilarity(recordingId, newChunks, allEmb) {
  try {
    const { addEdge } = await import('./storage.js');
    const { cosineSimilarity } = await import('./embeddings.js');

    // Average embedding for the new recording
    const newAvg = _averageEmbedding(newChunks);
    if (!newAvg) return;

    for (const other of allEmb) {
      if (other.recordingId === recordingId || !other.chunks?.length) continue;
      const otherAvg = _averageEmbedding(other.chunks);
      if (!otherAvg) continue;

      const sim = cosineSimilarity(newAvg, otherAvg);
      if (sim >= 0.78) {
        await addEdge({
          sourceType: 'recording',
          sourceId: recordingId,
          targetType: 'recording',
          targetId: other.recordingId,
          edgeType: 'SIMILAR_TO',
          metadata: { score: Math.round(sim * 1000) / 1000 },
        });
        _stats.similarity++;
      }
    }
    if (_stats.similarity > 0) {
      _log('auto_similarity', `Computed similarity edges for recording ${recordingId}`);
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
  try { lastRun = Number(localStorage.getItem(CLOSENESS_KEY)) || 0; } catch {}

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
 * Scan for recordings eligible for archival (gated by archiveEngine flag).
 */
async function _autoArchiveScan() {
  try {
    const step = createStep('autonomy_archive_scan', 'Scan for archivable recordings');
    const execResult = await executeStep(step, {});
    const result = execResult.result || { eligible: 0, skipped: false };
    if (result.skipped) return;
    if (result.eligible > 0) {
      _log('auto_archive_scan', `Found ${result.eligible} recordings eligible for archival`);
    }
  } catch (e) {
    console.warn('[Autonomy] Archive scan failed:', e.message);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _averageEmbedding(chunks) {
  const embeddings = chunks.filter(c => c.embedding?.length > 0).map(c => c.embedding);
  if (embeddings.length === 0) return null;
  const dim = embeddings[0].length;
  const avg = new Array(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) avg[i] += emb[i];
  }
  for (let i = 0; i < dim; i++) avg[i] /= embeddings.length;
  return avg;
}

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
    try { fn(type, data); } catch {}
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
