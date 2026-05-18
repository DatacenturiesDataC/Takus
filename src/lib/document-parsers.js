// Takus — Document Parsers (Knowledge OS: Rich Document Ingestion)
//
// CDN-loaded parsers for binary document formats (PDF, DOCX).
// Follows the same lazy-loading pattern as ffmpeg-engine.js:
//   - Libraries loaded from CDN on first use
//   - Singleton initialization to avoid re-fetching
//   - Graceful fallbacks with clear error messages
//
// No npm dependency — keeps the bundle lean for Netlify deployment.

import { notifyEphemeral } from './notification-manager.js';

// ── CDN URLs ────────────────────────────────────────────────────────────────

const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.124/pdf.min.mjs';
const PDFJS_WORKER_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.124/pdf.worker.min.mjs';
const MAMMOTH_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js';

// ── State ───────────────────────────────────────────────────────────────────

let _pdfjsLib = null;
let _pdfjsLoading = null;
let _mammothLib = null;
let _mammothLoading = null;

// ── PDF Extraction ──────────────────────────────────────────────────────────

/**
 * Load pdf.js from CDN (lazy, singleton).
 * @returns {Promise<object>} The pdfjsLib module
 */
async function _loadPdfJs() {
  if (_pdfjsLib) return _pdfjsLib;
  if (_pdfjsLoading) return _pdfjsLoading;

  _pdfjsLoading = (async () => {
    try {
      // pdf.js 4.x ships as ESM — dynamic import works directly
      const pdfjs = await import(/* @vite-ignore */ PDFJS_CDN);
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN;
      _pdfjsLib = pdfjs;
      return pdfjs;
    } catch (e) {
      _pdfjsLoading = null;
      throw new Error(`Failed to load PDF parser: ${e.message}. Check your internet connection.`);
    }
  })();

  return _pdfjsLoading;
}

/**
 * Extract plain text from a PDF file.
 * Processes each page sequentially and concatenates text content.
 *
 * @param {File|Blob|ArrayBuffer} input - PDF file, Blob, or ArrayBuffer
 * @returns {Promise<{ text: string, pageCount: number, metadata: object }>}
 */
export async function extractTextFromPDF(input) {
  // Validate input before loading CDN library
  let data;
  if (input instanceof ArrayBuffer) {
    data = input;
  } else if ((typeof Blob !== 'undefined' && input instanceof Blob) || (typeof File !== 'undefined' && input instanceof File)) {
    data = await input.arrayBuffer();
  } else {
    throw new Error('PDF input must be a File, Blob, or ArrayBuffer');
  }

  const pdfjs = await _loadPdfJs();

  const pdf = await pdfjs.getDocument({ data }).promise;
  const pageTexts = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map(item => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) pageTexts.push(pageText);
  }

  // Extract metadata
  let metadata = {};
  try {
    const meta = await pdf.getMetadata();
    metadata = {
      title: meta.info?.Title || null,
      author: meta.info?.Author || null,
      subject: meta.info?.Subject || null,
      creator: meta.info?.Creator || null,
      producer: meta.info?.Producer || null,
      creationDate: meta.info?.CreationDate || null,
    };
  } catch { /* metadata extraction is best-effort */ }

  const text = pageTexts.join('\n\n');

  if (!text.trim()) {
    notifyEphemeral(
      'PDF has no extractable text',
      'This PDF may contain only scanned images. OCR is not yet supported.',
      'info',
    );
  }

  return {
    text,
    pageCount: pdf.numPages,
    metadata,
  };
}

// ── DOCX Extraction ─────────────────────────────────────────────────────────

/**
 * Load mammoth.js from CDN (lazy, singleton).
 * mammoth.js is a UMD library — loaded via script tag.
 * @returns {Promise<object>} The mammoth module
 */
async function _loadMammoth() {
  if (_mammothLib) return _mammothLib;
  if (_mammothLoading) return _mammothLoading;

  _mammothLoading = (async () => {
    try {
      // mammoth.js is UMD — load via script element
      await new Promise((resolve, reject) => {
        if (typeof window !== 'undefined' && window.mammoth) {
          resolve();
          return;
        }
        const script = document.createElement('script');
        script.src = MAMMOTH_CDN;
        script.crossOrigin = 'anonymous';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load DOCX parser from CDN'));
        document.head.appendChild(script);
      });

      if (!window.mammoth) {
        throw new Error('mammoth.js loaded but window.mammoth is not defined');
      }

      _mammothLib = window.mammoth;
      return _mammothLib;
    } catch (e) {
      _mammothLoading = null;
      throw new Error(`Failed to load DOCX parser: ${e.message}. Check your internet connection.`);
    }
  })();

  return _mammothLoading;
}

/**
 * Extract plain text and optional HTML from a DOCX file.
 *
 * @param {File|Blob|ArrayBuffer} input - DOCX file, Blob, or ArrayBuffer
 * @returns {Promise<{ text: string, html: string, messages: string[] }>}
 */
export async function extractTextFromDOCX(input) {
  // Validate input before loading CDN library
  let arrayBuffer;
  if (input instanceof ArrayBuffer) {
    arrayBuffer = input;
  } else if ((typeof Blob !== 'undefined' && input instanceof Blob) || (typeof File !== 'undefined' && input instanceof File)) {
    arrayBuffer = await input.arrayBuffer();
  } else {
    throw new Error('DOCX input must be a File, Blob, or ArrayBuffer');
  }

  const mammoth = await _loadMammoth();

  // Extract raw text (preferred for AI processing)
  const textResult = await mammoth.extractRawText({ arrayBuffer });

  // Also extract HTML for richer rendering if needed
  let html = '';
  const messages = [];
  try {
    const htmlResult = await mammoth.convertToHtml({ arrayBuffer });
    html = htmlResult.value || '';
    if (htmlResult.messages?.length) {
      for (const msg of htmlResult.messages) {
        messages.push(`${msg.type}: ${msg.message}`);
      }
    }
  } catch { /* HTML extraction is best-effort */ }

  const text = textResult.value || '';

  if (!text.trim()) {
    notifyEphemeral(
      'DOCX has no text content',
      'The document appears to be empty or contains only images.',
      'info',
    );
  }

  return { text, html, messages };
}

// ── Capability Detection ────────────────────────────────────────────────────

/**
 * Check whether a file extension is supported for rich parsing.
 * @param {string} ext - File extension (lowercase, no dot)
 * @returns {boolean}
 */
export function isRichDocumentExtension(ext) {
  return ext === 'pdf' || ext === 'docx';
}
