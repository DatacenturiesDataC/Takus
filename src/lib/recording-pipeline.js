// Takus — Recording Pipeline (extracted from app-shell.js)
// Post-recording orchestration: AI processing, cloud sync, embedding generation,
// urgent update routing, and artefact upload.

import { getSettings } from './settings-store.js';
import { typeLabel } from './recording-types.js';
import { shortDate, shortTime } from './utils.js';
import { saveRecording, addEdge, getAllEmbeddings, saveEmbeddings } from './storage.js';
import { extractAudio } from './ffmpeg-engine.js';
import { generateTranscriptionAndSummary, extractTasks } from './ai-engine.js';
import { embedTranscript, cosineSimilarity } from './embeddings.js';
import { analyzeFillerWords, computeQualityScore, isUrgentUpdate, buildUrgentUpdateSlackPayload } from './analytics.js';
import { getIntegrationConfig } from './integration-config.js';
import { postToSlack } from './integrations/slack.js';
import { toast } from '../components/toast.js';

/**
 * Run the full AI processing pipeline on a recording blob.
 *
 * This is a fire-and-forget async function — errors are caught and
 * reported via toast, never thrown.
 *
 * @param {Blob} blob           The recording blob (original or watermarked)
 * @param {object} historyEntry The history entry object (mutated in place)
 * @param {object} options
 * @param {string}  options.recordingType  Type of recording (meeting, screen, etc.)
 * @param {Function} options.getCloudProvider  Returns the active cloud provider or null
 * @param {Promise}  options.uploadDone  Resolves when upload finishes (or immediately if no upload)
 * @param {Function} options.onPhase  Called with (label, pct, sub) during each processing phase
 * @param {Function} options.onComplete  Called when processing finishes (to refresh UI)
 */
export async function processAI(blob, historyEntry, options = {}) {
  const aiSettings = getSettings();
  const provider = aiSettings.aiProvider || 'openai';
  const apiKey = provider === 'gemini' ? aiSettings.geminiKey : aiSettings.openaiKey;
  if (!apiKey) return;

  const recType = historyEntry.type || options.recordingType || 'screen';
  toast.info('AI processing', 'Generating transcript & summary…');
  const phase = options.onPhase || (() => {});
  try {
    phase('Extracting audio…', 10, 'Preparing recording for AI');
    const audioBlob = await extractAudio(blob);

    phase('Transcribing audio…', 30, 'Sending to AI provider');
    const { transcript, summary, vtt } = await generateTranscriptionAndSummary(audioBlob, apiKey, recType, provider);

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

    phase('Extracting action items…', 55, 'Analyzing tasks & follow-ups');
    const taskResult = await extractTasks(
      transcript,
      historyEntry.observerLog,
      recType,
      apiKey,
      provider,
    ).catch(() => ({ takusTasks: [], meTasks: [] }));
    historyEntry.tasks = taskResult;

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

    // Browser-side analytics (zero network cost)
    phase('Computing analytics…', 75, 'Scoring quality & filler words');
    const fillerAnalysis = analyzeFillerWords(transcript, historyEntry.duration);
    historyEntry.analytics = {
      fillerWords: fillerAnalysis,
      score: computeQualityScore({ ...historyEntry, aiTranscript: transcript }),
    };

    await saveRecording(historyEntry).catch(e => console.warn('[Pipeline] Save failed:', e.message));

    // Create knowledge graph edges (best-effort, non-blocking)
    _createRecordingEdges(historyEntry).catch(() => {});

    // Upload AI artefacts to the cloud drive folder for cross-device sync
    syncAIArtefactsToCloud(historyEntry, options.getCloudProvider).catch(e =>
      console.warn('[AI] Cloud artefact sync failed:', e.message)
    );

    if (isUrgentUpdate(historyEntry)) {
      autoRouteUrgentUpdate(historyEntry);
    }

    // Generate transcript embeddings for Ask — non-blocking, best-effort
    if (transcript) {
      phase('Generating embeddings…', 90, 'Building semantic search index');
      embedTranscriptInBackground(transcript, historyEntry.id, apiKey, provider);
    }

    const label = typeLabel(recType);
    toast.success('AI complete', `${label} summary is ready`);
    if (getSettings().desktopNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification('Takus — AI Complete', { body: `${historyEntry.title || 'Untitled'} summary ready`, icon: new URL('/favicon.ico', document.baseURI).href }); } catch {}
    }

    // Notify the caller so it can refresh UI panels
    if (options.onComplete) options.onComplete(historyEntry);
  } catch (e) {
    console.warn('[AI] Processing failed:', e);
    toast.error('AI processing failed', e.message);
  }
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
    toast.warning('Urgent update posted to Slack', historyEntry.title);
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
  const srcMean = _meanVector(newChunks);
  if (!srcMean) return;

  for (const entry of allEmb) {
    if (entry.recordingId === recordingId || !entry.chunks?.length) continue;
    const otherMean = _meanVector(entry.chunks);
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

/** Compute mean embedding vector from chunks. */
function _meanVector(chunks) {
  const valid = chunks.filter(c => c.embedding?.length > 0);
  if (!valid.length) return null;
  const dim = valid[0].embedding.length;
  const mean = new Float32Array(dim);
  for (const c of valid) for (let i = 0; i < dim; i++) mean[i] += c.embedding[i];
  for (let i = 0; i < dim; i++) mean[i] /= valid.length;
  return mean;
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
