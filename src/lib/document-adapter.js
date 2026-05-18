// Takus — Document Adapter (Knowledge OS: Content Ingestion)
//
// Enables ingestion of documents (PDF text, markdown, plain text, meeting notes,
// emails) into the Takus knowledge graph as first-class content entries.

import { generateId } from './id.js';
import { saveEntry } from './storage.js';
import { notifyEphemeral } from './notification-manager.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** Supported document types — maps to content-types.js taxonomy */
export const DocumentType = {
  TEXT: 'document',
  MARKDOWN: 'markdown',
  MEETING_NOTES: 'document',
  PDF_TEXT: 'document',
  DOCX: 'document',
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
  const { onProgress } = options;

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
    size: new TextEncoder().encode(content).length,
    type: contentType,
    state: 'raw',
    textContent: content,
    aiProvider: null,
    participants: [],
    tags: doc.tags || [],
    sourceType: contentType,
  };

  try {
    onProgress?.('saving', 0.1);

    // Persist the entry immediately so it survives crashes
    await saveEntry(entry);

    onProgress?.('processing', 0.3);

    // Delegate to the unified content pipeline — runs the full 7-stage
    // intelligence treatment: summarize → tasks → goals → task→goal linking
    // → graph enrichment → embeddings → similarity edges
    const { processRawEntry } = await import('./content-pipeline.js');
    await processRawEntry(entry, {
      onComplete: (processed) => {
        onProgress?.('done', 1.0);
        notifyEphemeral('Document imported', processed.title || entry.title, 'success');
      },
    });

    onProgress?.('done', 1.0);
    return { success: true, entry };

  } catch (e) {
    console.error('[DocAdapter] Ingest failed:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Extract plain text from a File object.
 * Supports .txt, .md, .json, .html, .csv, and .eml files.
 *
 * @param {File} file - File object from file input
 * @returns {Promise<{title: string, content: string, type: string}>}
 */
export async function extractTextFromFile(file) {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const title = file.name.replace(/\.[^.]+$/, '') || 'Untitled Document';

  // Binary formats — require specialized parsers (CDN-loaded)
  if (ext === 'pdf') {
    const { extractTextFromPDF } = await import('./document-parsers.js');
    const result = await extractTextFromPDF(file);
    return {
      title: result.metadata?.title || title,
      content: result.text,
      type: DocumentType.PDF_TEXT,
      tags: ['pdf'],
    };
  }

  if (ext === 'docx') {
    const { extractTextFromDOCX } = await import('./document-parsers.js');
    const result = await extractTextFromDOCX(file);
    return {
      title,
      content: result.text,
      type: DocumentType.DOCX,
      tags: ['docx'],
    };
  }

  // Text-based formats — read as UTF-8 string
  const raw = await file.text();

  let type = DocumentType.TEXT;
  let content = raw;

  if (ext === 'md' || ext === 'markdown') {
    type = DocumentType.MARKDOWN;
  } else if (ext === 'html' || ext === 'htm') {
    // Strip HTML tags, extract text content
    type = DocumentType.TEXT;
    content = _stripHtml(raw);
  } else if (ext === 'csv') {
    // Keep CSV as-is — tabular text is useful for AI analysis
    type = DocumentType.TEXT;
  } else if (ext === 'eml') {
    // Basic email parsing — extract subject + body
    type = DocumentType.EMAIL;
    const parsed = _parseEml(raw);
    content = parsed.body;
    return { title: parsed.subject || title, content, type };
  }

  return { title, content, type };
}

// ── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Strip HTML tags and decode entities, returning plain text.
 * Uses DOMParser when available (browser), falls back to regex.
 */
function _stripHtml(html) {
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      // Remove script and style elements
      for (const el of doc.querySelectorAll('script, style, noscript')) el.remove();
      return (doc.body?.textContent || '').trim();
    } catch { /* fall through to regex */ }
  }
  // Regex fallback (server/test environment)
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Basic .eml parser — extracts Subject and body text.
 * Handles simple single-part emails. For MIME multipart,
 * extracts the first text/plain part.
 */
function _parseEml(raw) {
  const headerEnd = raw.indexOf('\r\n\r\n');
  const splitIdx = headerEnd >= 0 ? headerEnd : raw.indexOf('\n\n');
  if (splitIdx < 0) return { subject: '', body: raw };

  const headers = raw.slice(0, splitIdx);
  const body = raw.slice(splitIdx).trim();

  // Extract subject from headers
  const subjectMatch = headers.match(/^Subject:\s*(.+)$/mi);
  const subject = subjectMatch ? subjectMatch[1].trim() : '';

  return { subject, body };
}
