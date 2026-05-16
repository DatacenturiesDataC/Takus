// Takus — Recording Pipeline (extracted from app-shell.js)
// Post-recording orchestration: AI processing, cloud sync, embedding generation,
// urgent update routing, and artefact upload.

import { getSettings } from './settings-store.js';
import { typeLabel } from './recording-types.js';
import { shortDate, shortTime, deviceName } from './utils.js';
import { getTaskTitle } from './task-helpers.js';
import { saveRecording, addEdge, getAllEmbeddings, saveEmbeddings, saveInteraction, saveContentItem } from './storage.js';
import { meanVector } from './graph/vector-utils.js';
import { extractAudio } from './ffmpeg-engine.js';
import { generateTranscriptionAndSummary, extractTasks } from './ai-engine.js';
import { embedTranscript, cosineSimilarity } from './embeddings.js';
import { analyzeFillerWords, computeQualityScore, isUrgentUpdate, buildUrgentUpdateSlackPayload } from './analytics.js';
import { getIntegrationConfig } from './integration-config.js';
import { postToSlack } from './integrations/slack.js';
import { notifyEphemeral } from './notification-manager.js';
import { generateId } from './id.js';

/**
 * Create a standardized history entry for a recording.
 * Extracted from AppShell so any app can produce history entries
 * with a consistent shape.
 *
 * @param {object} params
 * @param {string} [params.title] - Recording title (defaults to type + date)
 * @param {string} [params.type] - Recording type (meeting, screen, etc.)
 * @param {number} [params.duration] - Duration in ms
 * @param {number} [params.size] - Blob size in bytes
 * @param {object} [params.observerLog] - Observer diagnostics
 * @returns {object} A history entry ready for persistence
 */
export function createHistoryEntry({ title, type = 'screen', duration = 0, size = 0, observerLog = null } = {}) {
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
    aiTranscript: null,
    aiVtt: null,
    aiProvider: null,
    tasks: null,
    observerLog,
  };
}

/**
 * Finalize a recording after the user approves it.
 * Handles: watermarking → local blob save → history persistence → AI kickoff.
 *
 * Extracted from AppShell._onRecordingApproved to consolidate the
 * post-recording pipeline into a single function.
 *
 * @param {Blob} blob - Original recording blob
 * @param {object} historyEntry - History entry (created via createHistoryEntry)
 * @param {object} options
 * @param {string} [options.watermarkText] - Watermark text to burn in
 * @param {function} [options.onPhase] - Progress callback (label, pct, sub)
 * @param {object} [options.processOptions] - Options passed to processAI
 * @returns {Promise<{ processedBlob: Blob, historyEntry: object }>}
 */
export async function finalizeRecording(blob, historyEntry, options = {}) {
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
      onPhase?.('Processing recording…', 0, 'Hang tight…');
    }
  }

  // Save blob locally (best-effort, silent on quota error)
  try {
    const { saveRecordingBlob } = await import('./storage.js');
    saveRecordingBlob(historyEntry.id, processedBlob).catch(() => {});
  } catch {}

  // Persist history entry immediately so it survives crashes
  saveRecording(historyEntry).catch(() => {});

  // Mark as having recorded (dismisses first-run onboarding)
  try { localStorage.setItem('takus_welcomed', '1'); } catch {}

  // Kick off AI processing in the background
  if (options.processOptions) {
    processAI(processedBlob, historyEntry, options.processOptions);
  }

  return { processedBlob, historyEntry };
}

/**
 * Run the full AI processing pipeline on a recording blob.
 *
 * Phase 44: Pipeline-as-Steps — each processing stage is modeled as a
 * named step with status tracking for observability and error isolation.
 *
 * @param {Blob} blob           The recording blob (original or watermarked)
 * @param {object} historyEntry The history entry object (mutated in place)
 * @param {object} options
 * @param {string}  options.recordingType  Type of recording (meeting, screen, etc.)
 * @param {Function} options.getCloudProvider  Returns the active cloud provider or null
 * @param {Promise}  options.uploadDone  Resolves when upload finishes (or immediately if no upload)
 * @param {Function} options.onPhase  Called with (label, pct, sub) during each processing phase
 * @param {Function} options.onStepUpdate  Called with (pipelineRun) on every step status change
 * @param {Function} options.onComplete  Called when processing finishes (to refresh UI)
 */
export async function processAI(blob, historyEntry, options = {}) {
  const aiSettings = getSettings();
  const provider = aiSettings.aiProvider || 'openai';
  const apiKey = provider === 'gemini' ? aiSettings.geminiKey : aiSettings.openaiKey;
  if (!apiKey) return;

  const recType = historyEntry.type || options.recordingType || 'screen';
  notifyEphemeral('AI processing', 'Generating transcript & summary…', 'info');
  const phase = options.onPhase || (() => {});

  // Create pipeline run manifest
  const run = createPipelineRun(recType);
  historyEntry.pipelineRun = run;
  const emitStep = () => options.onStepUpdate?.(run);


  try {
    // Step 1: Extract audio
    _markStep(run, 'extract_audio', 'running'); emitStep();
    phase('Extracting audio…', 10, 'Preparing recording for AI');
    const audioBlob = await extractAudio(blob);
    _markStep(run, 'extract_audio', 'done'); emitStep();

    // Step 2: Transcribe + summarize
    _markStep(run, 'transcribe', 'running'); emitStep();
    phase('Transcribing audio…', 30, 'Sending to AI provider');
    const { transcript, summary, vtt } = await generateTranscriptionAndSummary(audioBlob, apiKey, recType, provider);
    _markStep(run, 'transcribe', 'done'); emitStep();

    historyEntry.aiTranscript = transcript;
    historyEntry.aiSummary = summary;
    historyEntry.aiVtt = vtt;
    historyEntry.aiProvider = provider;

    // Auto-generate title from AI summary if still using a default title
    const isDefaultTitle = !historyEntry.title || historyEntry.title === 'Untitled Recording' || /^(Meeting|Screen Recording|Presentation|Status Update|Recording) —/.test(historyEntry.title);
    if (isDefaultTitle) {
      const aiTitle = extractTitleFromSummary(summary, recType);
      if (aiTitle) historyEntry.title = aiTitle;
    }

    // Step 3: Extract tasks
    _markStep(run, 'extract_tasks', 'running'); emitStep();
    phase('Extracting action items…', 55, 'Analyzing tasks & follow-ups');
    const taskResult = await extractTasks(
      transcript,
      historyEntry.observerLog,
      recType,
      apiKey,
      provider,
    ).catch(() => ({ takusTasks: [], meTasks: [] }));
    historyEntry.tasks = taskResult;
    _markStep(run, 'extract_tasks', 'done'); emitStep();

    // Wait for the upload to finish so we have historyEntry.driveLink
    // before creating the meeting notes doc.
    if (options.uploadDone) {
      await options.uploadDone.catch(() => {}); // Don't fail AI if upload failed
    }

    // Meeting notes doc is only relevant for meeting recordings
    if (recType === 'meeting') {
      const cloudProvider = options.getCloudProvider?.();
      if (cloudProvider?.auth?.isConnected && cloudProvider.notes) {
        try {
          const docLink = await cloudProvider.notes.createMeetingDoc(historyEntry.title, summary, transcript, historyEntry.driveLink, historyEntry.tasks);
          historyEntry.aiDocLink = docLink;
        } catch (docErr) {
          console.warn('[AI] Could not create meeting notes:', docErr);
        }
      }
    }

    // Step 4: Analytics
    _markStep(run, 'analytics', 'running'); emitStep();
    phase('Computing analytics…', 75, 'Scoring quality & filler words');
    const fillerAnalysis = analyzeFillerWords(transcript, historyEntry.duration);
    historyEntry.analytics = {
      fillerWords: fillerAnalysis,
      score: computeQualityScore({ ...historyEntry, aiTranscript: transcript }),
    };
    _markStep(run, 'analytics', 'done'); emitStep();

    await saveRecording(historyEntry).catch(e => console.warn('[Pipeline] Save failed:', e.message));

    // Promote extracted tasks to standalone graph nodes (Phase 21: task store)
    _promoteTasksToNodes(historyEntry).catch(() => {});

    // Step 5: Goal detection
    if (transcript) {
      _markStep(run, 'goal_detection', 'running'); emitStep();
      phase('Detecting goals…', 80, 'Identifying goals & commitments');
      await _detectGoalsFromTranscript(transcript, historyEntry, apiKey, provider).catch(() => {});
      _markStep(run, 'goal_detection', 'done'); emitStep();
    } else {
      _markStep(run, 'goal_detection', 'done'); // Skip — no transcript
    }

    // Link tasks → goals via SUPPORTS edges (best-effort)
    _linkTasksToGoals(historyEntry).catch(() => {});

    // Step 6: Graph enrichment (edges, interactions, content items)
    _markStep(run, 'graph_enrich', 'running'); emitStep();
    _createRecordingEdges(historyEntry).catch(() => {});
    _writeParticipantInteractions(historyEntry).catch(() => {});
    _writeContentItem(historyEntry).catch(() => {});
    syncAIArtefactsToCloud(historyEntry, options.getCloudProvider).catch(e =>
      console.warn('[AI] Cloud artefact sync failed:', e.message)
    );
    if (isUrgentUpdate(historyEntry)) {
      autoRouteUrgentUpdate(historyEntry);
    }
    _markStep(run, 'graph_enrich', 'done'); emitStep();

    // Step 7: Embeddings
    if (transcript) {
      _markStep(run, 'embeddings', 'running'); emitStep();
      phase('Generating embeddings…', 90, 'Building semantic search index');
      embedTranscriptInBackground(transcript, historyEntry.id, apiKey, provider);
      _markStep(run, 'embeddings', 'done'); emitStep();
    } else {
      _markStep(run, 'embeddings', 'done'); // Skip — no transcript
    }

    // Finalize pipeline run
    run.status = 'done';
    run.completedAt = Date.now();
    run.durationMs = run.completedAt - run.startedAt;
    historyEntry.pipelineRun = run;
    emitStep();

    const label = typeLabel(recType);
    notifyEphemeral('AI complete', `${label} summary is ready`, 'success');
    if (getSettings().desktopNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification('Takus — AI Complete', { body: `${historyEntry.title || 'Untitled'} summary ready`, icon: new URL('/favicon.ico', document.baseURI).href }); } catch {}
    }

    // Persist final state with pipeline run
    await saveRecording(historyEntry).catch(() => {});

    // Notify the caller so it can refresh UI panels
    if (options.onComplete) options.onComplete(historyEntry);
  } catch (e) {
    console.warn('[AI] Processing failed:', e);
    // Mark the currently running step as failed
    const failedStep = run.steps.find(s => s.status === 'running');
    if (failedStep) {
      failedStep.status = 'failed';
      failedStep.error = e.message;
      failedStep.completedAt = Date.now();
    }
    run.status = 'failed';
    run.completedAt = Date.now();
    run.durationMs = run.completedAt - run.startedAt;
    run.error = e.message;
    historyEntry.pipelineRun = run;
    emitStep();

    notifyEphemeral('AI processing failed', e.message, 'error');
    // Revert to raw if processing was from inbox
    if (historyEntry.state === 'processing') {
      historyEntry.state = 'raw';
      await saveRecording(historyEntry).catch(() => {});
    }
  }
}

/**
 * Process a raw/inbox recording — transitions from 'raw' → 'processing' → 'active'.
 * Called when the user explicitly clicks "Process" on an inbox item.
 *
 * @param {object} recording - Recording entry in 'raw' state
 * @param {object} options - Same options as processAI
 * @returns {Promise<void>}
 */
export async function processRawRecording(recording, options = {}) {
  if (recording.state !== 'raw') {
    console.warn('[Pipeline] processRawRecording called on non-raw recording:', recording.state);
    return;
  }

  // Transition to processing
  recording.state = 'processing';
  await saveRecording(recording).catch(() => {});

  // Get the video blob from IDB
  const { getRecordingBlob } = await import('./storage.js');
  const blob = await getRecordingBlob(recording.id);
  if (!blob) {
    notifyEphemeral('Processing failed', 'Video blob not found in storage', 'error');
    recording.state = 'raw';
    await saveRecording(recording).catch(() => {});
    return;
  }

  // Run the full AI pipeline with a wrapper that transitions to 'active' on success
  const originalOnComplete = options.onComplete;
  await processAI(blob, recording, {
    ...options,
    onComplete: async (entry) => {
      entry.state = 'active';
      await saveRecording(entry).catch(() => {});
      originalOnComplete?.(entry);
    },
  });
}

/**
 * Evaluate Auto-Run rules on a new recording to decide whether to
 * process immediately or hold in the inbox.
 *
 * Called at the end of a recording capture. If any rule matches, the
 * recording is processed immediately (state stays 'active'). Otherwise,
 * the recording is marked as 'raw' and held in the inbox.
 *
 * Now integrated with the Inbox Service for lifecycle tracking and events.
 *
 * @param {Blob} blob - Recording blob
 * @param {object} historyEntry - Recording entry (mutated in place)
 * @param {object} options - processAI options
 * @param {boolean} [options.inboxMode] - If true, apply inbox rules. If false/undefined, process immediately (default behavior).
 * @returns {Promise<void>}
 */
export async function evaluateAutoRun(blob, historyEntry, options = {}) {
  // If inbox mode is not enabled, process immediately (current default behavior)
  if (!options.inboxMode) {
    return processAI(blob, historyEntry, options);
  }

  // Route through Inbox Service for lifecycle tracking
  try {
    const { submitToInbox } = await import('./inbox.js');
    const { action, item, matchedRule } = submitToInbox({
      id: historyEntry.id,
      appId: 'recorder',
      type: historyEntry.type || 'recording',
      title: historyEntry.title,
      createdAt: historyEntry.date ? new Date(historyEntry.date).getTime() : Date.now(),
      metadata: { duration: historyEntry.duration, source: historyEntry.source },
    });

    if (action === 'auto-process') {
      console.debug('[Pipeline] Auto-Run match:', matchedRule?.label || matchedRule?.id);
      return processAI(blob, historyEntry, options);
    }
  } catch {
    // Inbox Service not available — fall back to direct auto-runs evaluation
    try {
      const { evaluateAutoRuns } = await import('./auto-runs.js');
      const { shouldProcess, matchedRule } = evaluateAutoRuns(historyEntry);
      if (shouldProcess) {
        console.debug('[Pipeline] Auto-Run match (fallback):', matchedRule?.label || matchedRule?.id);
        return processAI(blob, historyEntry, options);
      }
    } catch { /* auto-runs module failed, fall through to inbox hold */ }
  }

  // No rule matched — hold in inbox
  historyEntry.state = 'raw';
  await saveRecording(historyEntry).catch(() => {});
  notifyEphemeral('Recording saved', 'Held in inbox — click "Process" when ready', 'info');
}

/**
 * Re-upload AI artefacts (summary.md, transcript.vtt, metadata.json)
 * to the existing drive folder after AI processing completes.
 */
export async function syncAIArtefactsToCloud(historyEntry, getCloudProvider) {
  const provider = getCloudProvider?.();
  if (!provider?.auth?.isConnected || !provider.storage) return;
  if (typeof provider.storage.uploadSmallFile !== 'function') return;

  const folderId = historyEntry.driveFolderId;
  if (!folderId) return;

  // Google Drive needs upsert to avoid duplicates; OneDrive PUT is naturally idempotent
  const upload = typeof provider.storage.upsertSmallFile === 'function'
    ? provider.storage.upsertSmallFile.bind(provider.storage)
    : provider.storage.uploadSmallFile.bind(provider.storage);

  if (historyEntry.aiSummary) {
    await upload(folderId, 'summary.md', historyEntry.aiSummary, 'text/markdown').catch(() => {});
  }
  if (historyEntry.aiVtt) {
    await upload(folderId, 'transcript.vtt', historyEntry.aiVtt, 'text/vtt').catch(() => {});
  }
  const metadata = {
    id: historyEntry.id,
    title: historyEntry.title || 'Untitled',
    date: historyEntry.date,
    duration: historyEntry.duration || 0,
    size: historyEntry.size || 0,
    type: historyEntry.type || 'screen',
    aiProvider: historyEntry.aiProvider || null,
    participants: historyEntry.participants || [],
    archiveStatus: 'active',
    version: 2,
  };
  await upload(folderId, 'metadata.json', JSON.stringify(metadata, null, 2), 'application/json').catch(() => {});

  // Phase C: Sync tasks to cloud for cross-device persistence
  if (historyEntry.tasks) {
    const tasks = historyEntry.tasks;
    const taskPayload = {
      version: 1,
      recordingId: historyEntry.id,
      takusTasks: tasks.takusTasks || [],
      meTasks: tasks.meTasks || [],
      exportedAt: new Date().toISOString(),
    };
    await upload(folderId, 'tasks.json', JSON.stringify(taskPayload, null, 2), 'application/json').catch(() => {});
  }
}

/**
 * Route an urgent update recording to configured Slack webhook.
 */
export async function autoRouteUrgentUpdate(historyEntry) {
  try {
    const slackCfg = await getIntegrationConfig('slack');
    if (!slackCfg.configured) return;
    const payload = buildUrgentUpdateSlackPayload(historyEntry);
    await postToSlack(slackCfg.webhookUrl, payload);
    notifyEphemeral('Urgent update posted to Slack', historyEntry.title, 'warning');
  } catch (e) {
    console.warn('[Auto-route] Slack post failed:', e.message);
  }
}

/**
 * Generate transcript embeddings in the background (best-effort).
 */
export async function embedTranscriptInBackground(transcript, recordingId, apiKey, provider) {
  try {
    const chunks = await embedTranscript(transcript, recordingId, apiKey, provider);
    if (chunks.length) {
      await saveEmbeddings(recordingId, chunks);
      // Auto-create SIMILAR_TO edges against existing recordings
      _computeSimilarityEdges(recordingId, chunks).catch(() => {});
    }
  } catch (e) {
    console.warn('[Embeddings] Background generation failed:', e.message);
  }
}

/**
 * Compare new recording's embeddings against all existing recordings.
 * Creates SIMILAR_TO edges for pairs above the similarity threshold.
 * Best-effort, non-blocking.
 */
async function _computeSimilarityEdges(recordingId, newChunks) {
  const THRESHOLD = 0.45;
  const allEmb = await getAllEmbeddings().catch(() => []);
  const srcMean = meanVector(newChunks);
  if (!srcMean) return;

  for (const entry of allEmb) {
    if (entry.recordingId === recordingId || !entry.chunks?.length) continue;
    const otherMean = meanVector(entry.chunks);
    if (!otherMean) continue;
    const sim = cosineSimilarity(srcMean, otherMean);
    if (sim >= THRESHOLD) {
      await addEdge({
        sourceType: 'recording',
        sourceId: recordingId,
        targetType: 'recording',
        targetId: entry.recordingId,
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
async function _writeParticipantInteractions(historyEntry) {
  const participants = historyEntry.participants || [];
  if (!participants.length) return;

  const rid = historyEntry.id;
  const timestamp = historyEntry.date || Date.now();

  for (const p of participants) {
    const email = typeof p === 'string' ? p : p.email;
    if (!email) continue;
    await saveInteraction({
      id: `${rid}_${email}`,
      contactId: email,
      recordingId: rid,
      type: 'PARTICIPATED_IN',
      timestamp,
      metadata: {
        recordingTitle: historyEntry.title || 'Untitled',
        recordingType: historyEntry.type || 'screen',
        duration: historyEntry.duration || 0,
      },
    }).catch(() => {});
  }
}

/**
 * Create knowledge graph edges for a recording after AI processing.
 * Links the recording to its participants (contacts) and extracted tasks.
 * Best-effort — never throws.
 */
async function _createRecordingEdges(historyEntry) {
  const rid = historyEntry.id;

  // 1. PARTICIPATED_IN — link recording → each participant
  const participants = historyEntry.participants || [];
  for (const p of participants) {
    const email = typeof p === 'string' ? p : p.email;
    if (!email) continue;
    await addEdge({
      sourceType: 'recording',
      sourceId: rid,
      targetType: 'contact',
      targetId: email,
      edgeType: 'PARTICIPATED_IN',
      metadata: { name: typeof p === 'string' ? null : p.name },
    });
  }

  // 2. HAS_TASK — link recording → each extracted task
  const tasks = historyEntry.tasks || {};
  for (const t of [...(tasks.takusTasks || []), ...(tasks.meTasks || [])]) {
    if (!t.id) continue;
    await addEdge({
      sourceType: 'recording',
      sourceId: rid,
      targetType: 'task',
      targetId: t.id,
      edgeType: 'HAS_TASK',
    });
  }

  // 3. MENTIONED_IN — link contacts mentioned in the transcript
  const transcript = (historyEntry.aiTranscript || '').toLowerCase();
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
            targetType: 'recording',
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

async function _writeContentItem(recording) {
  const participants = recording.calendarEvent?.attendees
    || recording.metadata?.participants
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
    id: recording.id,
    type: recording.type || 'screen',
    ownerId,
    participants: participantIds,
    contactId: null, // Recording is always created by the current user
    knowledgeLevel: ownerId !== 'local-user' ? 'L0' : 'L1',
    title: recording.title || '',
    createdAt: recording.date || new Date().toISOString(),
  });
}

// ── Task Promotion ───────────────────────────────────────────────────────────
// After AI extraction, promote tasks into standalone graph nodes so the
// unified task store (Phase 21) surfaces them natively. Embedded tasks in
// rec.tasks remain intact for backward compatibility.

async function _promoteTasksToNodes(recording) {
  try {
    const { createTask } = await import('./graph/task-store.js');
    const tasks = recording.tasks || {};
    const recId = recording.id;
    const recTitle = recording.title || 'Untitled';
    const recDate = recording.date;
    const recType = recording.type || 'screen';

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
      }, recId).catch(() => {}); // Skip duplicates silently
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
      }, recId).catch(() => {}); // Skip duplicates silently
    }
  } catch (err) {
    console.warn('[Pipeline] Task promotion to nodes failed:', err.message);
  }
}

/**
 * Extract goals from a transcript and persist them as graph nodes.
 * Platform-agnostic: uses extractGoals() which works on any text source.
 * New goals start as 'aspiration'; matches update lastMentionedAt on existing goals.
 */
async function _detectGoalsFromTranscript(transcript, recording, apiKey, provider) {
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
        // Link recording → existing goal
        await addEdge({
          sourceType: 'recording', sourceId: recording.id,
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
          source: 'recording',
        }, { appId: 'goals' });

        await saveNode(goalNode).catch(() => {});

        // Link recording → new goal
        await addEdge({
          sourceType: 'recording', sourceId: recording.id,
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
async function _linkTasksToGoals(recording) {
  try {
    const tasks = recording.tasks || {};
    const allTasks = [...(tasks.takusTasks || []), ...(tasks.meTasks || [])];
    if (!allTasks.length) return;

    const { getNodesByType } = await import('./storage.js');
    const goals = await getNodesByType('goal').catch(() => []);
    const openGoals = goals.filter(g => {
      const s = g.properties?.state || 'aspiration';
      return s !== 'achieved' && s !== 'abandoned';
    });
    if (!openGoals.length) return;

    for (const task of allTasks) {
      const taskText = `${task.objective || ''} ${getTaskTitle(task, '')} ${task.action || ''}`.toLowerCase();
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

// ── Pipeline-as-Steps (Phase 44) ──────────────────────────────────────────

/** Pipeline step definitions — ordered, labeled, with progress percentages */
const PIPELINE_STEPS = [
  { id: 'extract_audio',  label: 'Extract Audio',      pct: 10 },
  { id: 'transcribe',     label: 'Transcribe & Summarize', pct: 30 },
  { id: 'extract_tasks',  label: 'Extract Tasks',       pct: 55 },
  { id: 'analytics',      label: 'Compute Analytics',   pct: 75 },
  { id: 'goal_detection', label: 'Detect Goals',        pct: 80 },
  { id: 'graph_enrich',   label: 'Enrich Knowledge Graph', pct: 85 },
  { id: 'embeddings',     label: 'Generate Embeddings', pct: 95 },
];

/**
 * Create a pipeline run manifest.
 * Each step tracks: id, label, status, startedAt, completedAt, error.
 *
 * @param {string} recordingType - The recording type (meeting, screen, etc.)
 * @returns {object} Pipeline run manifest
 */
export function createPipelineRun(recordingType) {
  return {
    id: generateId('pipe'),
    recordingType,
    status: 'running',     // running | done | failed
    startedAt: Date.now(),
    completedAt: null,
    durationMs: null,
    error: null,
    steps: PIPELINE_STEPS.map(def => ({
      id: def.id,
      label: def.label,
      pct: def.pct,
      status: 'pending',   // pending | running | done | failed
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
 * @param {string} status - New status: 'running' | 'done' | 'failed'
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
 * Retry a failed pipeline run for a recording. (Phase 46)
 * Re-runs the full AI pipeline from the beginning. The previous
 * pipelineRun is archived on the recording for audit trail.
 *
 * Platform-agnostic: works for any recording type.
 *
 * @param {string} recordingId - ID of the recording to retry
 * @param {object} [options] - processAI options (onPhase, onStepUpdate, onComplete)
 * @returns {Promise<void>}
 */
export async function retryFailedStep(recordingId, options = {}) {
  const { getRecordings, getRecordingBlob } = await import('./storage.js');
  const recordings = await getRecordings();
  const recording = recordings.find(r => r.id === recordingId);
  if (!recording) {
    console.warn('[Pipeline] retryFailedStep: recording not found:', recordingId);
    return;
  }

  // Archive the previous pipeline run
  if (recording.pipelineRun) {
    recording.pipelineRunHistory = recording.pipelineRunHistory || [];
    recording.pipelineRunHistory.push(recording.pipelineRun);
    recording.pipelineRun = null;
  }

  // Get the blob (may be null if blob was cleaned up)
  const blob = await getRecordingBlob(recordingId).catch(() => null);
  if (!blob) {
    notifyEphemeral('Retry failed', 'Recording media not available locally.', 'error');
    return;
  }

  notifyEphemeral('Retrying pipeline', 'Re-processing recording…', 'info');
  await processAI(blob, recording, options);
}
