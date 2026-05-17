// Takus — Document Adapter (Knowledge OS: Content Ingestion)
//
// Enables ingestion of documents (PDF text, markdown, plain text, meeting notes,
// emails) into the Takus knowledge graph as first-class content entries.

import { generateId } from './id.js';
import { saveEntry, saveEmbeddings, addEdge } from './storage.js';
import { getSettings } from './settings-store.js';
import { notifyEphemeral } from './notification-manager.js';
import { meanVector } from './graph/vector-utils.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** Supported document types — maps to content-types.js taxonomy */
export const DocumentType = {
  TEXT: 'document',
  MARKDOWN: 'markdown',
  MEETING_NOTES: 'document',
  PDF_TEXT: 'document',
  EMAIL: 'email',
  NOTE: 'note',
  BOOKMARK: 'bookmark',
};

/** Maximum document size (characters) before truncation */
const MAX_DOC_LENGTH = 100_000;

// ── Core Ingest ────────────────────────────────────────────────────────────

/**
 * Ingest a document into Takus as a content entry.
 * The document text is stored as the transcript, and an AI summary
 * is generated if an API key is configured.
 *
 * @param {object} doc
 * @param {string} doc.title - Document title
 * @param {string} doc.content - Full text content
 * @param {string} [doc.type] - DocumentType (defaults to 'document')
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

  // Resolve content type from document type
  const contentType = doc.type || DocumentType.TEXT;

  // Create a content entry
  const entry = {
    id: generateId('doc'),
    title: doc.title || 'Imported Document',
    date: Date.now(),
    duration: 0,
    size: new Blob([content]).size,
    type: contentType,
    state: 'active',
    aiTranscript: content, // Document text stored as transcript
    aiProvider: null,
    participants: [],
    tags: doc.tags || [],
    sourceType: contentType,
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
    await saveEntry(entry);

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
        sourceType: 'entry',
        sourceId: docId,
        targetType: 'entry',
        targetId: entry.recordingId,
        edgeType: 'SIMILAR_TO',
        metadata: { score: Math.round(sim * 100) / 100, method: 'cosine-mean' },
      });
    }
  }
}

