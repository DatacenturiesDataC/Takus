// Takus — Content Pipeline (Knowledge OS)
// Post-capture orchestration: AI processing, cloud sync, embedding generation,
// urgent update routing, and artefact upload.

import { getSettings, saveAndCache } from './settings-store.js';
import { typeLabel } from './content-types.js';
import { shortDate, shortTime, deviceName } from './utils.js';
import { saveEntry, addEdge, getAllEmbeddings, saveEmbeddings, saveInteraction, saveContentItem } from './storage.js';
import { meanVector } from './graph/vector-utils.js';
import { extractAudio } from './ffmpeg-engine.js';
import { generateTranscriptionAndSummary, extractTasks } from './ai-engine.js';
import { embedTranscript, cosineSimilarity } from './embeddings.js';
import { analyzeFillerWords, computeQualityScore, isUrgentUpdate, buildUrgentUpdateSlackPayload } from './analytics.js';
import { getIntegrationConfig } from './integration-config.js';
import { postToSlack } from './integrations/slack.js';
import { notifyEphemeral } from './notification-manager.js';
import { generateId } from './id.js';

// ── Concurrency Guard ────────────────────────────────────────────────────────
// Prevents processContent from running twice on the same entry.
const _processingEntries = new Set();

/**
 * Create a standardized history entry for an entry.
 * Extracted from AppShell so any app can produce history entries
 * with a consistent shape.
 *
 * @param {object} params
 * @param {string} [params.title] - Entry title (defaults to type + date)
 * @param {string} [params.type] - Entry type (meeting, screen, etc.)
 * @param {number} [params.duration] - Duration in ms
 * @param {number} [params.size] - Blob size in bytes
 * @param {object} [params.observerLog] - Observer diagnostics
 * @returns {object} An entry ready for persistence
 */
export function createEntry({ title, type = 'screen', duration = 0, size = 0, observerLog = null } = {}) {
  const typeName = typeLabel(type);
  const now = new Date();
  return {
    id: generateId('rec'),
    title: title || `${typeName} — ${shortDate(now)} ${shortTime(now)}`,
    date: Date.now(),
    duration,
    size,
    type,
    device: deviceName(),
    driveLink: null,
    aiSummary: null,
    textContent: null,
    aiVtt: null,
    aiProvider: null,
    observerLog,
  };
}
/**
 * Finalize an entry after the user approves it.
 * Handles: watermarking → local blob save → history persistence → AI kickoff.
 *
 * Extracted from AppShell to consolidate the post-capture pipeline
 * into a single function.
 *
 * @param {Blob} blob - Original media blob
 * @param {object} entry - Entry object (created via createEntry)
 * @param {object} options
 * @param {string} [options.watermarkText] - Watermark text to burn in
 * @param {function} [options.onPhase] - Progress callback (label, pct, sub)
 * @param {object} [options.processOptions] - Options passed to processContent
 * @returns {Promise<{ processedBlob: Blob, entry: object }>}
 */
export async function finalizeCapture(blob, entry, options = {}) {
  const { watermarkText, onPhase } = options;
  let processedBlob = blob;

  // Apply watermark if configured
  if (watermarkText) {
    onPhase?.('Applying watermark…', 5, 'Processing video…');
    try {
      const { addWatermark } = await import('./ffmpeg-engine.js');
      processedBlob = await addWatermark(blob, watermarkText, (progress) => {
        const pct = Math.round(5 + progress * 90);
        onPhase?.(null, pct, `Watermarking… ${pct}%`);
      });
      onPhase?.('Watermark applied', 100, 'Done');
    } catch (e) {
      console.warn('[Pipeline] Watermark failed:', e);
      notifyEphemeral('Watermark failed', 'Skipping watermark application.', 'error');
      onPhase?.('Processing entry…', 0, 'Hang tight…');
    }
  }

  // Save blob locally
  try {
    const { saveMediaBlob } = await import('./storage.js');
    saveMediaBlob(entry.id, processedBlob).catch(e => {
      console.error('[Pipeline] Media blob save failed:', e.message);
      notifyEphemeral('Save warning', 'Recording media could not be saved locally.', 'error');
    });
  } catch { /* storage import failed — non-critical in embed mode */ }

  // Persist history entry immediately so it survives crashes
  saveEntry(entry).catch(e => {
    console.error('[Pipeline] CRITICAL: Entry save failed:', e.message);
    notifyEphemeral('Save failed', 'Your entry could not be saved. Please try again.', 'error');
  });

  // Mark as having recorded (dismisses first-run onboarding)
  try { localStorage.setItem('takus_welcomed', '1'); } catch { /* non-critical */ }

  // Kick off AI processing in the background
  if (options.processOptions) {
    processContent(entry, { blob: processedBlob, ...options.processOptions });
  }

  return { processedBlob, entry };
}

/**
 * Run the unified intelligence pipeline on any entry.
 *
 * All content types flow through the same 7 steps:
 *   1. pre_process    — Format-specific text extraction (media: audio→transcribe, text: skip)
 *   2. summarize      — AI summarization of text
 *   3. extract_tasks  — Task & action item extraction
 *   4. analytics      — Quality scoring & filler words (media only, skipped for text)
 *   5. goal_detection — Goal & commitment detection
 *   6. graph_enrich   — Knowledge graph edges, content items, cloud sync
 *   7. embeddings     — Vector embeddings & similarity edges
 *
 * @param {object} entry       The entry object (mutated in place)
 * @param {object} options
 * @param {Blob}     [options.blob]            Media blob (required for media entries)
 * @param {Function} [options.getCloudProvider] Returns the active cloud provider or null
 * @param {Promise}  [options.uploadDone]       Resolves when upload finishes
 * @param {Function} [options.onPhase]          Called with (label, pct, sub)
 * @param {Function} [options.onStepUpdate]     Called with (pipelineRun) on step changes
 * @param {Function} [options.onComplete]       Called when processing finishes
 */
export async function processContent(entry, options = {}) {
  // Concurrency guard — prevent double processing of the same entry
  if (_processingEntries.has(entry.id)) {
    console.warn('[Pipeline] Already processing entry:', entry.id);
    return;
  }
  _processingEntries.add(entry.id);

  let aiSettings = getSettings();
  let provider = aiSettings.aiProvider || 'openai';
  let apiKey = provider === 'gemini' ? aiSettings.geminiKey : aiSettings.openaiKey;
  if (!apiKey) {
    // Show an inline key-configuration dialog instead of silently skipping
    const result = await _showApiKeyGate();
    if (!result) {
      _processingEntries.delete(entry.id);
      return; // User dismissed — entry saved but AI skipped
    }
    // Re-read settings after user configured key
    aiSettings = getSettings();
    provider = aiSettings.aiProvider || 'openai';
    apiKey = provider === 'gemini' ? aiSettings.geminiKey : aiSettings.openaiKey;
    if (!apiKey) {
      _processingEntries.delete(entry.id);
      return;
    }
  }

  const { getCategory } = await import('./content-types.js');
  const category = getCategory(entry.type);
  const isMedia = category !== 'document';
  const contentType = entry.type || 'screen';

  notifyEphemeral('AI processing', isMedia ? 'Generating transcript & summary…' : 'Processing content…', 'info');
  const phase = options.onPhase || (() => {});

  const run = createPipelineRun(contentType);
  entry.pipelineRun = run;
  const emitStep = () => options.onStepUpdate?.(run);

  try {
    // ── Step 1: Pre-Process (format-specific) ──────────────────────────
    _markStep(run, 'pre_process', 'running'); emitStep();

    if (isMedia) {
      const blob = options.blob;
      if (!blob) throw new Error('Media blob required for media entries');
      phase('Extracting audio…', 5, 'Preparing entry for AI');
      const audioBlob = await extractAudio(blob);
      phase('Transcribing audio…', 15, 'Sending to AI provider');
      const { transcript, summary, vtt } = await generateTranscriptionAndSummary(audioBlob, apiKey, contentType, provider);
      entry.textContent = transcript;
      entry.aiSummary = summary;
      entry.aiVtt = vtt;
      entry.aiProvider = provider;
      _markStep(run, 'pre_process', 'done'); emitStep();
    } else {
      _markStep(run, 'pre_process', 'skipped'); emitStep();
    }

    const text = entry.textContent || '';

    // ── Step 2: Summarize ──────────────────────────────────────────────
    _markStep(run, 'summarize', 'running'); emitStep();
    if (!isMedia && apiKey && text.length > 20) {
      try {
        const { summarizeText } = await import('./ai-engine.js');
        const { summary } = await summarizeText(text, apiKey, entry.type, provider);
        entry.aiSummary = summary;
        entry.aiProvider = provider;
      } catch (e) {
        console.warn('[Pipeline] Text summarization failed:', e.message);
      }
    }
    const isDefaultTitle = !entry.title || entry.title === 'Untitled' || entry.title === 'Imported Document' || /^(Meeting|Screen Capture|Presentation|Status Update|Voice Note|Document|Email|Note|Bookmark|Markdown|Chat Message|Content) —/.test(entry.title);
    if (isDefaultTitle && entry.aiSummary) {
      const aiTitle = extractTitleFromSummary(entry.aiSummary, contentType);
      if (aiTitle) entry.title = aiTitle;
    }
    _markStep(run, 'summarize', 'done'); emitStep();

    // ── Step 3: Extract Tasks ──────────────────────────────────────────
    _markStep(run, 'extract_tasks', 'running'); emitStep();
    phase('Extracting action items…', 50, 'Analyzing tasks & follow-ups');
    let taskResult = { takusTasks: [], meTasks: [] };
    if (text.length > 20) {
      taskResult = await extractTasks(text, entry.observerLog, contentType, apiKey, provider)
        .catch(() => ({ takusTasks: [], meTasks: [] }));
    }
    _markStep(run, 'extract_tasks', 'done'); emitStep();

    if (options.uploadDone) await options.uploadDone.catch(() => {});

    if (contentType === 'meeting') {
      const cloudProvider = options.getCloudProvider?.();
      if (cloudProvider?.auth?.isConnected && cloudProvider.notes) {
        try {
          const docLink = await cloudProvider.notes.createMeetingDoc(entry.title, entry.aiSummary, text, entry.driveLink, taskResult);
          entry.aiDocLink = docLink;
        } catch (docErr) { console.warn('[AI] Could not create meeting notes:', docErr); }
      }
    }

    // ── Step 4: Analytics (media only) ─────────────────────────────────
    if (isMedia) {
      _markStep(run, 'analytics', 'running'); emitStep();
      phase('Computing analytics…', 65, 'Scoring quality & filler words');
      const fillerAnalysis = analyzeFillerWords(text, entry.duration);
      entry.analytics = { fillerWords: fillerAnalysis, score: computeQualityScore({ ...entry, textContent: text }) };
      _markStep(run, 'analytics', 'done'); emitStep();
    } else {
      _markStep(run, 'analytics', 'skipped'); emitStep();
    }

    await saveEntry(entry).catch(e => console.warn('[Pipeline] Save failed:', e.message));
    _createTaskNodes(taskResult, entry).catch(e => console.warn('[Pipeline] Task node creation failed:', e.message));

    // ── Step 5: Goal Detection ─────────────────────────────────────────
    _markStep(run, 'goal_detection', 'running'); emitStep();
    phase('Detecting goals…', 75, 'Identifying goals & commitments');
    if (text.length > 20) {
      await _detectGoalsFromTranscript(text, entry, apiKey, provider).catch(e => console.warn('[Pipeline] Goal detection failed:', e.message));
    }
    _markStep(run, 'goal_detection', 'done'); emitStep();
    _linkTasksToGoals(entry).catch(e => console.warn('[Pipeline] Task-goal linking failed:', e.message));

    // ── Step 6: Graph Enrichment ───────────────────────────────────────
    _markStep(run, 'graph_enrich', 'running'); emitStep();
    await Promise.all([
      _createContentEdges(entry).catch(() => {}),
      _writeParticipantInteractions(entry).catch(() => {}),
      _writeContentItem(entry).catch(() => {}),
    ]);
    syncAIArtefactsToCloud(entry, options.getCloudProvider).catch(e => console.warn('[AI] Cloud artefact sync failed:', e.message));
    if (isUrgentUpdate(entry)) autoRouteUrgentUpdate(entry);
    _markStep(run, 'graph_enrich', 'done'); emitStep();

    // ── Step 7: Embeddings ─────────────────────────────────────────────
    if (text.length > 50) {
      _markStep(run, 'embeddings', 'running'); emitStep();
      phase('Generating embeddings…', 95, 'Building semantic search index');
      await embedTranscriptInBackground(text, entry.id, apiKey, provider);
      _markStep(run, 'embeddings', 'done'); emitStep();
    } else {
      _markStep(run, 'embeddings', 'skipped'); emitStep();
    }

    // Finalize pipeline run
    run.status = 'done';
    run.completedAt = Date.now();
    run.durationMs = run.completedAt - run.startedAt;
    entry.pipelineRun = run;
    emitStep();

    const label = typeLabel(contentType);
    notifyEphemeral('AI complete', `${label} summary is ready`, 'success');

    entry.state = 'active';
    await saveEntry(entry).catch(e => {
      console.error('[Pipeline] AI results save failed:', e.message);
      notifyEphemeral('Save warning', 'AI results processed but could not be saved.', 'error');
    });
    if (options.onComplete) options.onComplete(entry);
  } catch (e) {
    console.warn('[AI] Processing failed:', e);
    const failedStep = run.steps.find(s => s.status === 'running');
    if (failedStep) { failedStep.status = 'failed'; failedStep.error = e.message; failedStep.completedAt = Date.now(); }
    run.status = 'failed';
    run.completedAt = Date.now();
    run.durationMs = run.completedAt - run.startedAt;
    run.error = e.message;
    entry.pipelineRun = run;
    emitStep();
    notifyEphemeral('AI processing failed', e.message, 'error');
    if (entry.state === 'processing') {
      entry.state = 'raw';
      await saveEntry(entry).catch(() => {});
    }
  } finally {
    _processingEntries.delete(entry.id);
  }
}
/**
 * Process a raw/inbox entry — transitions from 'raw' → 'processing' → 'active'.
 * Thin wrapper around processContent() with state guard.
 *
 * @param {object} entry - Entry in 'raw' state
 * @param {object} options - processContent options
 * @returns {Promise<void>}
 */
export async function processRawEntry(entry, options = {}) {
  if (entry.state !== 'raw') {
    console.warn('[Pipeline] processRawEntry called on non-raw entry:', entry.state);
    return;
  }

  // Transition to processing
  entry.state = 'processing';
  await saveEntry(entry).catch(() => {});

  // For media entries, load the blob from storage
  const { getCategory } = await import('./content-types.js');
  const category = getCategory(entry.type);

  if (category !== 'document') {
    const { getMediaBlob } = await import('./storage.js');
    const blob = await getMediaBlob(entry.id);
    if (!blob) {
      notifyEphemeral('Processing failed', 'Media not found in storage', 'error');
      entry.state = 'raw';
      await saveEntry(entry).catch(() => {});
      return;
    }
    options.blob = blob;
  }

  await processContent(entry, options);
}

/**
 * Ingest external content into the Knowledge OS.
 * This is the canonical entry point for all inbound adapters
 * and external knowledge sources.
 *
 * Creates an entry → routes through inbox/auto-runs →
 * runs the full intelligence pipeline (processContent).
 *
 * @param {import('./inbound-adapter.js').NormalizedContent} content
 * @returns {Promise<{ entry: object, action: 'auto-process'|'hold' }>}
 */
export async function ingestContent(content) {
  if (!content?.content || typeof content.content !== 'string') {
    throw new Error('ingestContent requires a content string');
  }

  const { saveEntry } = await import('./storage.js');
  const { submitToInbox } = await import('./inbox.js');

  // Create a content entry from the normalized data
  const entry = {
    id: generateId(content.type === 'email' ? 'eml' : content.type === 'chat' ? 'chat' : 'doc'),
    title: content.title || 'Untitled',
    date: content.timestamp || Date.now(),
    duration: 0,
    size: new TextEncoder().encode(content.content).length,
    type: content.type || 'document',
    state: 'raw',
    textContent: content.content,
    aiSummary: null,
    aiProvider: null,
    participants: [],
    tags: content.tags || [],
    source: content.source || null,
    sourceKey: content.sourceKey || null,
    sourceMetadata: content.metadata || {},
  };

  // Persist before inbox evaluation (entry exists even if held)
  await saveEntry(entry);

  // Route through inbox — auto-run rules decide process-or-hold
  const { action } = submitToInbox({
    id: entry.id,
    appId: content.source || 'inbound',
    type: entry.type,
    title: entry.title,
    metadata: content.metadata || {},
  });

  if (action === 'auto-process') {
    // Process immediately through the full intelligence pipeline
    entry.state = 'processing';
    await saveEntry(entry);
    processContent(entry, {
      onComplete: async (processed) => {
        await saveEntry(processed).catch(() => {});
      },
    }).catch(e => {
      console.warn('[Pipeline] Ingest processing failed:', e.message);
    });
  }

  return { entry, action };
}

/**
 * Evaluate Auto-Run rules on a new entry to decide whether to
 * process immediately or hold in the inbox.
 *
 * @param {Blob} blob - Media blob
 * @param {object} entry - Entry (mutated in place)
 * @param {object} options - processContent options
 * @param {boolean} [options.inboxMode] - If true, apply inbox rules.
 * @returns {Promise<void>}
 */
export async function evaluateAutoRun(blob, entry, options = {}) {
  const contentOpts = { blob, ...options };

  if (!options.inboxMode) {
    return processContent(entry, contentOpts);
  }

  try {
    const { submitToInbox } = await import('./inbox.js');
    const { action, item, matchedRule } = submitToInbox({
      id: entry.id,
      appId: 'recorder',
      type: entry.type || 'entry',
      title: entry.title,
      createdAt: entry.date ? new Date(entry.date).getTime() : Date.now(),
      metadata: { duration: entry.duration, source: entry.source },
    });

    if (action === 'auto-process') {
      console.debug('[Pipeline] Auto-Run match:', matchedRule?.label || matchedRule?.id);
      return processContent(entry, contentOpts);
    }
  } catch { /* non-critical */
    try {
      const { evaluateAutoRuns } = await import('./auto-runs.js');
      const { shouldProcess, matchedRule } = evaluateAutoRuns(entry);
      if (shouldProcess) {
        console.debug('[Pipeline] Auto-Run match (fallback):', matchedRule?.label || matchedRule?.id);
        return processContent(entry, contentOpts);
      }
    } catch { /* auto-runs module failed, fall through to inbox hold */ }
  }

  entry.state = 'raw';
  await saveEntry(entry).catch(() => {});
  notifyEphemeral('Entry saved', 'Held in inbox — click "Process" when ready', 'info');
}

/**
 * Re-upload AI artefacts (summary.md, transcript.vtt, metadata.json)
 * to the existing drive folder after AI processing completes.
 */
export async function syncAIArtefactsToCloud(entry, getCloudProvider) {
  const provider = getCloudProvider?.();
  if (!provider?.auth?.isConnected || !provider.storage) return;
  if (typeof provider.storage.uploadSmallFile !== 'function') return;

  const folderId = entry.driveFolderId;
  if (!folderId) return;

  // Google Drive needs upsert to avoid duplicates; OneDrive PUT is naturally idempotent
  const upload = typeof provider.storage.upsertSmallFile === 'function'
    ? provider.storage.upsertSmallFile.bind(provider.storage)
    : provider.storage.uploadSmallFile.bind(provider.storage);

  if (entry.aiSummary) {
    await upload(folderId, 'summary.md', entry.aiSummary, 'text/markdown').catch(() => {});
  }
  if (entry.aiVtt) {
    await upload(folderId, 'transcript.vtt', entry.aiVtt, 'text/vtt').catch(() => {});
  }
  const metadata = {
    id: entry.id,
    title: entry.title || 'Untitled',
    date: entry.date,
    duration: entry.duration || 0,
    size: entry.size || 0,
    type: entry.type || 'screen',
    aiProvider: entry.aiProvider || null,
    participants: entry.participants || [],
    archiveStatus: 'active',
    version: 2,
  };
  await upload(folderId, 'metadata.json', JSON.stringify(metadata, null, 2), 'application/json').catch(() => {});

  // Tasks are persisted as graph nodes — no embedded entry.tasks to sync
}

/**
 * Route an urgent update entry to configured Slack webhook.
 */
export async function autoRouteUrgentUpdate(entry) {
  try {
    const slackCfg = await getIntegrationConfig('slack');
    if (!slackCfg.configured) return;
    const payload = buildUrgentUpdateSlackPayload(entry);
    await postToSlack(slackCfg.webhookUrl, payload);
    notifyEphemeral('Urgent update posted to Slack', entry.title, 'warning');
  } catch (e) {
    console.warn('[Auto-route] Slack post failed:', e.message);
  }
}

/**
 * Generate transcript embeddings in the background (best-effort).
 */
export async function embedTranscriptInBackground(transcript, contentId, apiKey, provider) {
  try {
    const chunks = await embedTranscript(transcript, contentId, apiKey, provider);
    if (chunks.length) {
      await saveEmbeddings(contentId, chunks);
      // Auto-create SIMILAR_TO edges against existing entries
      _computeSimilarityEdges(contentId, chunks).catch(() => {});
    }
  } catch (e) {
    console.warn('[Embeddings] Background generation failed:', e.message);
  }
}

/**
 * Compare new entry's embeddings against all existing entries.
 * Creates SIMILAR_TO edges for pairs above the similarity threshold.
 * Best-effort, non-blocking.
 */
async function _computeSimilarityEdges(contentId, newChunks) {
  const THRESHOLD = 0.70;
  const allEmb = await getAllEmbeddings().catch(() => []);
  const srcMean = meanVector(newChunks);
  if (!srcMean) return;

  for (const entry of allEmb) {
    if (entry.contentId === contentId || !entry.chunks?.length) continue;
    const otherMean = meanVector(entry.chunks);
    if (!otherMean) continue;
    const sim = cosineSimilarity(srcMean, otherMean);
    if (sim >= THRESHOLD) {
      await addEdge({
        sourceType: 'entry',
        sourceId: contentId,
        targetType: 'entry',
        targetId: entry.contentId,
        edgeType: 'SIMILAR_TO',
        metadata: { score: Math.round(sim * 100) / 100, method: 'cosine-mean' },
      });
    }
  }
}
/**
 * Extract a short title from AI-generated summary markdown.
 * Strategy: take the first heading (# Title), or the first non-empty line.
 * Falls back to a type-based timestamp title.
 */
export function extractTitleFromSummary(summary, type) {
  if (!summary) return null;

  // Try: first markdown heading (## or #)
  const headingMatch = summary.match(/^#{1,3}\s+(.+)/m);
  if (headingMatch) {
    let title = headingMatch[1].trim()
      .replace(/\*\*/g, '')        // remove bold markers
      .replace(/[*_~`]/g, '')      // remove other md formatting
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // [text](url) → text
    if (title.length > 80) title = title.slice(0, 77) + '…';
    if (title.length >= 5) return title;
  }

  // Try: first non-empty, non-heading line that's a sentence
  const lines = summary.split('\n').filter(l => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('|'));
  const firstLine = lines[0]?.trim().replace(/^[-*]\s+/, '').replace(/\*\*/g, '');
  if (firstLine && firstLine.length >= 5) {
    return firstLine.length > 80 ? firstLine.slice(0, 77) + '…' : firstLine;
  }

  // Fallback: type-based timestamp title
  return `${typeLabel(type)} — ${shortDate(new Date())} ${shortTime(new Date())}`;
}

/**
 * Write PARTICIPATED_IN interactions to IDB for each participant.
 * Populates the `interactions` store so closeness scoring has real data.
 * Best-effort — never throws.
 */
async function _writeParticipantInteractions(entry) {
  const participants = entry.participants || [];
  if (!participants.length) return;

  const rid = entry.id;
  const timestamp = entry.date || Date.now();

  // Map content type → closeness interaction type so aggregateSignals() counts it.
  // closeness-score recognizes: 'meeting', 'direct_message', 'shared_task', 'mention'
  const interactionType = _mapContentTypeToInteraction(entry.type);

  for (const p of participants) {
    const email = typeof p === 'string' ? p : p.email;
    if (!email) continue;
    await saveInteraction({
      id: `${rid}_${email}`,
      contactId: email,
      contentId: rid,
      type: interactionType,
      timestamp,
      metadata: {
        entryTitle: entry.title || 'Untitled',
        contentType: entry.type || 'screen',
        duration: entry.duration || 0,
      },
    }).catch(() => {});
  }
}

/**
 * Map a content type to a closeness-score interaction type.
 * closeness-score.aggregateSignals() recognizes:
 *   'meeting', 'direct_message', 'shared_task', 'mention'
 *
 * @param {string} contentType - Entry type (e.g. 'meeting', 'email', 'chat')
 * @returns {string} Interaction type recognized by closeness scoring
 */
function _mapContentTypeToInteraction(contentType) {
  switch (contentType) {
    case 'meeting':
    case 'presentation':
    case 'status_update':
      return 'meeting';
    case 'email':
    case 'chat':
      return 'direct_message';
    default:
      return 'meeting'; // Conservative: any co-participation signals a meeting-level interaction
  }
}

/**
 * Create knowledge graph edges for an entry after AI processing.
 * Links the entry to its participants (contacts) and extracted tasks.
 * Best-effort — never throws.
 */
async function _createContentEdges(entry) {
  const rid = entry.id;

  // 1. PARTICIPATED_IN — link entry → each participant
  const participants = entry.participants || [];
  for (const p of participants) {
    const email = typeof p === 'string' ? p : p.email;
    if (!email) continue;
    await addEdge({
      sourceType: 'entry',
      sourceId: rid,
      targetType: 'contact',
      targetId: email,
      edgeType: 'PARTICIPATED_IN',
      metadata: { name: typeof p === 'string' ? null : p.name },
    });
  }

  // 2. HAS_TASK — task edges are now created in _createTaskNodes() via DERIVED_FROM

  // 3. MENTIONED_IN — link contacts mentioned in the transcript
  const transcript = (entry.textContent || '').toLowerCase();
  if (transcript.length > 20) {
    try {
      const { getContacts } = await import('./storage.js');
      const contacts = await getContacts();
      const participantEmails = new Set(participants.map(p =>
        (typeof p === 'string' ? p : p.email || '').toLowerCase()
      ));
      for (const c of contacts) {
        // Skip contacts who are already PARTICIPATED_IN
        if (c.email && participantEmails.has(c.email.toLowerCase())) continue;
        // Check if the contact's name appears in the transcript
        const name = (c.name || '').toLowerCase().trim();
        if (name.length >= 3 && transcript.includes(name)) {
          await addEdge({
            sourceType: 'contact',
            sourceId: c.id,
            targetType: 'entry',
            targetId: rid,
            edgeType: 'MENTIONED_IN',
            metadata: { matchedName: c.name },
          });
        }
      }
    } catch { /* best-effort */ }
  }
}

// ── Content Item Writer ──────────────────────────────────────────────────────
// Creates a content_item in IDB so the closeness-worker can compute
// knowledge levels (L0–L4). Without this, the content_items store stays empty
// and assignKnowledgeLevel() always returns L4.

async function _writeContentItem(entry) {
  const participants = entry.calendarEvent?.attendees
    || entry.metadata?.participants
    || [];
  const participantIds = participants.map(p =>
    typeof p === 'string' ? p : (p.email || p.name || '')
  ).filter(Boolean);

  // Determine ownerId: use the user's email from cloud auth, or 'local-user'
  let ownerId = 'local-user';
  try {
    const { CloudProviderManager } = await import('./cloud-provider.js');
    const cpm = CloudProviderManager.getInstance();
    const provider = cpm.getProvider();
    if (provider?.auth?.userEmail) {
      ownerId = provider.auth.userEmail;
    }
  } catch { /* local-only mode */ }

  await saveContentItem({
    id: entry.id,
    type: entry.type || 'screen',
    ownerId,
    participants: participantIds,
    contactId: null, // Entry is always created by the current user
    knowledgeLevel: ownerId !== 'local-user' ? 'L0' : 'L1',
    title: entry.title || '',
    createdAt: entry.date || Date.now(),
  });
}

// ── Task Promotion ───────────────────────────────────────────────────────────
// After AI extraction, promote tasks into standalone graph nodes so the
// Create task graph nodes directly from extracted task data.
// Tasks are first-class graph nodes — no longer embedded on entries.

async function _createTaskNodes(taskResult, entry) {
  try {
    const { createTask } = await import('./graph/task-store.js');
    const tasks = taskResult || {};
    const entryId = entry.id;

    for (const t of (tasks.takusTasks || [])) {
      await createTask({
        id: t.id,
        title: t.title || t.action || 'Untitled Task',
        action: t.action,
        payload: t.payload,
        status: t.status || 'pending',
        assignee: 'takus',
        contextTimestamp: t.contextTimestamp,
        steps: t.steps || [],
        objective: t.objective || null,
        dependsOn: t.dependsOn || [],
        sequence: t.sequence ?? null,
        integrations: t.integrations || [],
        deadline: t.deadline || null,
        note: t.note || null,
      }, entryId).catch(() => {}); // Skip duplicates silently
    }

    for (const t of (tasks.meTasks || [])) {
      await createTask({
        id: t.id,
        title: t.note || t.title || 'Personal follow-up',
        action: 'ME_TASK',
        status: t.status || 'pending',
        assignee: 'me',
        contextTimestamp: t.contextTimestamp,
        steps: t.steps || [],
        objective: t.objective || null,
        dependsOn: t.dependsOn || [],
        note: t.note || null,
      }, entryId).catch(() => {}); // Skip duplicates silently
    }
  } catch (err) {
    console.warn('[Pipeline] Task node creation failed:', err.message);
  }
}

/**
 * Extract goals from a transcript and persist them as graph nodes.
 * Platform-agnostic: uses extractGoals() which works on any text source.
 * New goals start as 'aspiration'; matches update lastMentionedAt on existing goals.
 */
async function _detectGoalsFromTranscript(transcript, entry, apiKey, provider) {
  try {
    const { extractGoals } = await import('./ai-engine.js');
    const { getNodesByType, saveNode } = await import('./storage.js');
    const existingGoals = await getNodesByType('goal').catch(() => []);

    const result = await extractGoals(transcript, existingGoals, apiKey, provider);
    if (!result.goals?.length) return;

    for (const goal of result.goals) {
      if (goal.matchedGoalId) {
        // Update existing goal — bump lastMentionedAt and add edge
        const existing = existingGoals.find(g => g.id === goal.matchedGoalId);
        if (existing) {
          existing.properties.lastMentionedAt = Date.now();
          existing.properties.mentionCount = (existing.properties.mentionCount || 0) + 1;
          if (goal.evidence) {
            existing.properties.progressNotes = existing.properties.progressNotes || [];
            existing.properties.progressNotes.push(goal.evidence);
          }
          existing.updatedAt = Date.now();
          await saveNode(existing).catch(() => {});
        }
        // Link entry → existing goal
        await addEdge({
          sourceType: 'entry', sourceId: entry.id,
          targetType: 'goal', targetId: goal.matchedGoalId,
          edgeType: 'CONTRIBUTES_TO',
          metadata: { evidence: goal.evidence, detectedAt: Date.now() },
        }).catch(() => {});
      } else {
        // New goal — create as aspiration
        const { createNode } = await import('./graph/node-registry.js');
        const goalNode = createNode('goal', {
          title: goal.title,
          description: goal.description || '',
          state: 'aspiration',
          targetDate: null,
          createdAt: Date.now(),
          lastMentionedAt: Date.now(),
          mentionCount: 1,
          progressNotes: goal.evidence ? [goal.evidence] : [],
          source: 'entry',
        }, { appId: 'goals' });

        await saveNode(goalNode).catch(() => {});

        // Link entry → new goal
        await addEdge({
          sourceType: 'entry', sourceId: entry.id,
          targetType: 'goal', targetId: goalNode.id,
          edgeType: 'CONTRIBUTES_TO',
          metadata: { evidence: goal.evidence, detectedAt: Date.now() },
        }).catch(() => {});
      }
    }

    notifyEphemeral('Goals detected', `${result.goals.length} goal(s) identified`, 'info');
  } catch (err) {
    console.warn('[Pipeline] Goal detection failed:', err.message);
  }
}

/**
 * Link extracted tasks to goals via SUPPORTS edges.
 * Keyword matching between task objective/title and goal titles.
 * Platform-agnostic: pure local text matching, no API calls.
 */
async function _linkTasksToGoals(entry) {
  try {
    const { getTasksByContent } = await import('./graph/task-store.js');
    const allTasks = await getTasksByContent(entry.id);
    if (!allTasks.length) return;

    const { getNodesByType } = await import('./storage.js');
    const goals = await getNodesByType('goal').catch(() => []);
    const openGoals = goals.filter(g => {
      const s = g.properties?.state || 'aspiration';
      return s !== 'achieved' && s !== 'abandoned';
    });
    if (!openGoals.length) return;

    for (const task of allTasks) {
      const taskText = `${task.objective || ''} ${task.title || ''} ${task.action || ''}`.toLowerCase();
      if (taskText.trim().length < 5) continue;

      const words = taskText.split(/\s+/).filter(w => w.length >= 4);
      if (!words.length) continue;

      for (const goal of openGoals) {
        const goalTitle = (goal.properties?.title || '').toLowerCase();
        const goalDesc = (goal.properties?.description || '').toLowerCase();
        const goalText = `${goalTitle} ${goalDesc}`;
        const matchCount = words.filter(w => goalText.includes(w)).length;

        // Require at least 2 matching keywords to avoid false positives
        if (matchCount >= 2) {
          await addEdge({
            sourceType: 'task', sourceId: task.id,
            targetType: 'goal', targetId: goal.id,
            edgeType: 'SUPPORTS',
            metadata: { matchStrength: matchCount, linkedAt: Date.now() },
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn('[Pipeline] Task-goal linking failed:', err.message);
  }
}

// ── Pipeline-as-Steps ──────────────────────────────────────────

/**
 * Unified pipeline step definitions.
 * All content types flow through the same 7 steps.
 * Format-specific steps (pre_process, analytics) are conditional.
 */
const PIPELINE_STEPS = [
  { id: 'pre_process',    label: 'Pre-Process Content',     pct: 15 },
  { id: 'summarize',      label: 'Summarize',               pct: 35 },
  { id: 'extract_tasks',  label: 'Extract Tasks',           pct: 50 },
  { id: 'analytics',      label: 'Compute Analytics',       pct: 65 },
  { id: 'goal_detection', label: 'Detect Goals',            pct: 75 },
  { id: 'graph_enrich',   label: 'Enrich Knowledge Graph',  pct: 85 },
  { id: 'embeddings',     label: 'Generate Embeddings',     pct: 95 },
];

/**
 * Create a pipeline run manifest.
 * All content types use the same 7-step manifest.
 *
 * @param {string} contentType - The entry type (meeting, screen, document, etc.)
 * @returns {object} Pipeline run manifest
 */
export function createPipelineRun(contentType) {
  return {
    id: generateId('pipe'),
    contentType,
    status: 'running',
    startedAt: Date.now(),
    completedAt: null,
    durationMs: null,
    error: null,
    steps: PIPELINE_STEPS.map(def => ({
      id: def.id,
      label: def.label,
      pct: def.pct,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      error: null,
    })),
  };
}

/**
 * Transition a step's status in a pipeline run.
 * @param {object} run - Pipeline run manifest
 * @param {string} stepId - Step ID
 * @param {string} status - New status: 'running' | 'done' | 'failed' | 'skipped'
 * @param {string} [error] - Error message (if failed)
 */
function _markStep(run, stepId, status, error) {
  const step = run.steps.find(s => s.id === stepId);
  if (!step) return;
  step.status = status;
  if (status === 'running') step.startedAt = Date.now();
  if (status === 'done' || status === 'failed') step.completedAt = Date.now();
  if (error) step.error = error;
}

/**
 * Get a human-readable label for a pipeline step.
 * @param {string} stepId
 * @returns {string}
 */
export function getPipelineStepLabel(stepId) {
  const def = PIPELINE_STEPS.find(s => s.id === stepId);
  return def?.label || stepId;
}

/**
 * Retry a failed pipeline run for an entry.
 * Re-runs the full pipeline from the beginning. The previous
 * pipelineRun is archived on the entry for audit trail.
 *
 * @param {string} contentId - ID of the entry to retry
 * @param {object} [options] - processContent options
 * @returns {Promise<void>}
 */
export async function retryFailedStep(contentId, options = {}) {
  const { getEntry, getMediaBlob } = await import('./storage.js');
  const entry = await getEntry(contentId);
  if (!entry) {
    console.warn('[Pipeline] retryFailedStep: entry not found:', contentId);
    return;
  }

  // Archive the previous pipeline run
  if (entry.pipelineRun) {
    entry.pipelineRunHistory = entry.pipelineRunHistory || [];
    entry.pipelineRunHistory.push(entry.pipelineRun);
    entry.pipelineRun = null;
  }

  // Load media blob if needed (processContent handles the rest)
  const { getCategory } = await import('./content-types.js');
  const category = getCategory(entry.type);

  if (category !== 'document') {
    const blob = await getMediaBlob(contentId).catch(() => null);
    if (!blob) {
      notifyEphemeral('Retry failed', 'Media not available locally.', 'error');
      return;
    }
    options.blob = blob;
  }

  notifyEphemeral('Retrying pipeline', 'Re-processing entry…', 'info');
  entry.state = 'processing';
  await saveEntry(entry).catch(e => {
    console.error('[Pipeline] Retry state save failed:', e.message);
  });
  await processContent(entry, options);
}

// ── API Key Gate Dialog ──────────────────────────────────────────────────────
// Shown when AI processing is triggered without a configured API key.
// Lets the user add their key right here instead of navigating to Settings.

async function _showApiKeyGate() {
  return new Promise(resolve => {
    let provider = 'gemini';
    let key = '';
    let testing = false;
    let error = '';

    const dialog = document.createElement('dialog');
    dialog.className = 'takus-dialog';
    dialog.style.maxWidth = '440px';

    function renderDialog() {
      const isGemini = provider === 'gemini';
      const keyLink = isGemini
        ? 'https://aistudio.google.com/apikey'
        : 'https://platform.openai.com/api-keys';
      const keyLabel = isGemini ? 'Google AI Studio' : 'OpenAI Dashboard';

      dialog.innerHTML = `
        <div class="takus-dialog-form" style="gap:var(--space-4);">
          <div style="text-align:center;margin-bottom:var(--space-2);">
            <div style="font-size:28px;margin-bottom:var(--space-2);">🤖</div>
            <h3 style="font-size:var(--font-lg);font-weight:var(--weight-bold);color:var(--color-text-primary);margin:0;">AI Key Required</h3>
            <p style="font-size:var(--font-sm);color:var(--color-text-secondary);margin-top:var(--space-2);line-height:1.5;">
              Your entry was saved! Add an API key to enable<br>
              transcription, summaries, and task extraction.
            </p>
          </div>

          <div style="display:flex;justify-content:center;gap:var(--space-2);">
            <button class="gate-provider-btn btn ${isGemini ? 'btn-primary' : 'btn-ghost'} btn-sm" data-provider="gemini"
              style="${!isGemini ? 'border:1px solid var(--color-border);' : ''}">
              Gemini <span style="font-size:10px;opacity:0.7;">(free)</span>
            </button>
            <button class="gate-provider-btn btn ${!isGemini ? 'btn-primary' : 'btn-ghost'} btn-sm" data-provider="openai"
              style="${isGemini ? 'border:1px solid var(--color-border);' : ''}">
              OpenAI
            </button>
          </div>

          <div>
            <label style="font-size:var(--font-xs);color:var(--color-text-secondary);display:block;margin-bottom:var(--space-1);">
              ${isGemini ? 'Gemini' : 'OpenAI'} API Key
            </label>
            <div style="display:flex;gap:var(--space-2);">
              <input type="password" id="gate-key-input" class="input" value="${key}"
                placeholder="${isGemini ? 'AIza...' : 'sk-...'}"
                style="flex:1;font-family:monospace;font-size:var(--font-xs);" autocomplete="off" />
              <button id="gate-test-btn" class="btn btn-primary btn-sm" style="min-width:70px;" ${testing ? 'disabled' : ''}>
                ${testing ? '…' : 'Save'}
              </button>
            </div>
            ${error ? `<div style="margin-top:var(--space-1);font-size:var(--font-xs);color:var(--color-error);">⚠ ${error}</div>` : ''}
            <div style="margin-top:var(--space-2);font-size:var(--font-xs);color:var(--color-text-disabled);">
              Get a free key → <a href="${keyLink}" target="_blank" rel="noopener"
                style="color:var(--color-primary-light);text-decoration:underline;">${keyLabel}</a>
            </div>
          </div>

          <div class="takus-dialog-actions" style="border-top:1px solid var(--color-border);padding-top:var(--space-3);">
            <button id="gate-skip-btn" class="btn btn-ghost btn-sm">Skip for now</button>
          </div>
        </div>`;

      // Bind events
      dialog.querySelectorAll('.gate-provider-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          provider = btn.dataset.provider;
          key = '';
          error = '';
          renderDialog();
        });
      });

      const input = dialog.querySelector('#gate-key-input');
      input?.addEventListener('input', (e) => { key = e.target.value.trim(); });
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); dialog.querySelector('#gate-test-btn')?.click(); }
      });

      dialog.querySelector('#gate-test-btn')?.addEventListener('click', async () => {
        if (!key || testing) return;
        testing = true;
        error = '';
        renderDialog();

        try {
          const valid = await _quickValidateKey(key, provider);
          testing = false;
          if (valid) {
            saveAndCache('aiProvider', provider);
            saveAndCache(provider === 'gemini' ? 'geminiKey' : 'openaiKey', key);
            dialog.close();
            resolve(true);
          } else {
            error = 'Invalid key. Check and try again.';
            renderDialog();
          }
        } catch (e) {
          testing = false;
          error = e.message || 'Validation failed.';
          renderDialog();
        }
      });

      dialog.querySelector('#gate-skip-btn')?.addEventListener('click', () => {
        dialog.close();
        notifyEphemeral('AI skipped', 'Your entry is saved. Add an API key in Settings to process it later.', 'info');
        resolve(false);
      });

      setTimeout(() => input?.focus(), 50);
    }

    dialog.addEventListener('close', () => { dialog.remove(); });
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault(); // Don't let Escape auto-close without going through skip
      dialog.close();
      resolve(false);
    });

    document.body.appendChild(dialog);
    renderDialog();
    dialog.showModal();
  });
}

/** Quick API key validation — same logic as setup wizard */
async function _quickValidateKey(key, provider) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    if (provider === 'gemini') {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
        { headers: { 'x-goog-api-key': key }, signal: controller.signal },
      );
      return res.ok;
    } else {
      const res = await fetch(
        'https://api.openai.com/v1/models?limit=1',
        { headers: { 'Authorization': `Bearer ${key}` }, signal: controller.signal },
      );
      return res.ok;
    }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}


