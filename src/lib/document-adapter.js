// Takus — Document Adapter (Phase 3: Non-Recording Content Ingestion)
//
// Enables ingestion of documents (PDF text, markdown, plain text, meeting notes)
// into the Takus knowledge graph without requiring a recording.
// Each document becomes a recording-like entry with state: 'active'.

import { generateId } from './id.js';
import { saveRecording, saveEmbeddings, addEdge } from './storage.js';
import { getSettings } from './settings-store.js';
import { notifyEphemeral } from './notification-manager.js';
import { meanVector } from './graph/vector-utils.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** Supported document types */
export const DocumentType = {
  TEXT: 'text',
  MARKDOWN: 'markdown',
  MEETING_NOTES: 'meeting-notes',
  PDF_TEXT: 'pdf-text',
};

/** Maximum document size (characters) before truncation */
const MAX_DOC_LENGTH = 100_000;

// ── Core Ingest ────────────────────────────────────────────────────────────

/**
 * Ingest a document into Takus as a recording-like entry.
 * The document text is stored as the transcript, and an AI summary
 * is generated if an API key is configured.
 *
 * @param {object} doc
 * @param {string} doc.title - Document title
 * @param {string} doc.content - Full text content
 * @param {string} [doc.type] - DocumentType (defaults to 'text')
 * @param {string[]} [doc.tags] - Optional tags
 * @param {object} [options]
 * @param {boolean} [options.generateSummary] - Whether to run AI summarization (default: true)
 * @param {boolean} [options.generateEmbeddings] - Whether to generate embeddings (default: true)
 * @param {function(string, number): void} [options.onProgress] - Progress callback
 * @returns {Promise<{success: boolean, entry?: object, error?: string}>}
 */
export async function ingestDocument(doc, options = {}) {
  const { generateSummary = true, generateEmbeddings = true, onProgress } = options;

  if (!doc?.content || typeof doc.content !== 'string') {
    return { success: false, error: 'Document content is required' };
  }

  const content = doc.content.length > MAX_DOC_LENGTH
    ? doc.content.slice(0, MAX_DOC_LENGTH) + '\n\n[Truncated — original was ' + doc.content.length + ' characters]'
    : doc.content;

  // Create a recording-like entry
  const entry = {
    id: generateId('doc'),
    title: doc.title || 'Imported Document',
    date: Date.now(),
    duration: 0,
    size: new Blob([content]).size,
    type: 'update', // Closest recording type for documents
    state: 'active',
    aiTranscript: content, // Document text stored as transcript
    aiProvider: null,
    participants: [],
    tags: doc.tags || [],
    sourceType: doc.type || DocumentType.TEXT,
    isDocument: true, // Flag to distinguish from recordings
  };

  try {
    onProgress?.('saving', 0.1);

    // Generate AI summary if configured
    if (generateSummary) {
      const settings = getSettings();
      const provider = settings.aiProvider || 'openai';
      const apiKey = provider === 'gemini' ? settings.geminiKey : settings.openaiKey;

      if (apiKey) {
        onProgress?.('summarizing', 0.3);
        try {
          const { generateTranscriptionAndSummary } = await import('./ai-engine.js');
          // Use the text-only summarization path (audio extraction is skipped)
          const audioBlob = new Blob([content], { type: 'text/plain' });
          const { summary } = await generateTranscriptionAndSummary(audioBlob, apiKey, 'update', provider);
          entry.aiSummary = summary;
          entry.aiProvider = provider;
        } catch (e) {
          console.warn('[DocAdapter] Summarization failed:', e.message);
          // Continue without summary — the document text is still stored
        }
      }
    }

    // Save to IDB
    onProgress?.('indexing', 0.6);
    await saveRecording(entry);

    // Generate embeddings for semantic search
    if (generateEmbeddings) {
      const settings = getSettings();
      const provider = settings.aiProvider || 'openai';
      const apiKey = provider === 'gemini' ? settings.geminiKey : settings.openaiKey;

      if (apiKey) {
        onProgress?.('embedding', 0.8);
        try {
          const { embedTranscript, cosineSimilarity } = await import('./embeddings.js');
          const { getAllEmbeddings } = await import('./storage.js');
          const chunks = await embedTranscript(content, entry.id, apiKey, provider);
          if (chunks.length) {
            await saveEmbeddings(entry.id, chunks);
            // Create similarity edges
            _linkSimilarContent(entry.id, chunks).catch(() => {});
          }
        } catch (e) {
          console.warn('[DocAdapter] Embedding failed:', e.message);
        }
      }
    }

    onProgress?.('done', 1.0);
    notifyEphemeral('Document imported', entry.title, 'success');
    return { success: true, entry };

  } catch (e) {
    console.error('[DocAdapter] Ingest failed:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Extract plain text from a File object.
 * Supports .txt, .md, and .json files.
 *
 * @param {File} file - File object from file input
 * @returns {Promise<{title: string, content: string, type: string}>}
 */
export async function extractTextFromFile(file) {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const text = await file.text();

  let type = DocumentType.TEXT;
  if (ext === 'md' || ext === 'markdown') type = DocumentType.MARKDOWN;
  else if (ext === 'json') type = DocumentType.TEXT;

  const title = file.name.replace(/\.[^.]+$/, '') || 'Untitled Document';

  return { title, content: text, type };
}

// ── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Create SIMILAR_TO edges between the new document and existing content.
 * Best-effort, non-blocking.
 */
async function _linkSimilarContent(docId, newChunks) {
  const THRESHOLD = 0.45;
  const { getAllEmbeddings } = await import('./storage.js');
  const { cosineSimilarity } = await import('./embeddings.js');
  const allEmb = await getAllEmbeddings().catch(() => []);

  const srcMean = meanVector(newChunks);
  if (!srcMean) return;

  for (const entry of allEmb) {
    if (entry.recordingId === docId || !entry.chunks?.length) continue;
    const otherMean = meanVector(entry.chunks);
    if (!otherMean) continue;
    const sim = cosineSimilarity(srcMean, otherMean);
    if (sim >= THRESHOLD) {
      await addEdge({
        sourceType: 'recording',
        sourceId: docId,
        targetType: 'recording',
        targetId: entry.recordingId,
        edgeType: 'SIMILAR_TO',
        metadata: { score: Math.round(sim * 100) / 100, method: 'cosine-mean' },
      });
    }
  }
}

