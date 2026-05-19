// Takus — Web Clipper Adapter
//
// Receives web clips from browser extensions, bookmarklets, or direct API calls.
// Enables users to capture web content into the knowledge graph.
//
// Inbound methods:
//   1. postMessage — from a Takus browser extension
//   2. clipFromUrl() — programmatic ingestion (bookmarklet, API)
//
// Phase C: Bidirectional Integration Framework

import { InboundAdapter } from '../inbound-adapter.js';

export class WebClipperAdapter extends InboundAdapter {
  constructor() {
    super({
      id: 'web-clipper',
      name: 'Web Clipper',
      icon: '✂️',
      description: 'Capture web pages, articles, and selections into your knowledge base.',
    });
    this._pendingClips = []; // Queue of clips received via postMessage
    this._messageHandler = null;
  }

  /**
   * Connect and start listening for postMessage clips.
   * @param {{ allowedOrigins?: string[] }} [config]
   */
  async connect(config = {}) {
    this._config = {
      allowedOrigins: config.allowedOrigins || ['*'],
    };

    // Install message listener for browser extension communication
    this._messageHandler = (event) => {
      // Origin validation
      if (this._config.allowedOrigins[0] !== '*') {
        if (!this._config.allowedOrigins.includes(event.origin)) return;
      }

      const data = event.data;
      if (data?.type !== 'takus:web-clip') return;

      this._pendingClips.push({
        url: data.url || '',
        title: data.title || '',
        content: data.content || data.selectedText || '',
        selectedText: data.selectedText || '',
        timestamp: data.timestamp || Date.now(),
        favicon: data.favicon || null,
        author: data.author || null,
      });
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('message', this._messageHandler);
    }

    this._connected = true;
  }

  /**
   * Disconnect and remove the message listener.
   */
  async disconnect() {
    if (this._messageHandler && typeof window !== 'undefined') {
      window.removeEventListener('message', this._messageHandler);
    }
    this._messageHandler = null;
    this._pendingClips = [];
    this._connected = false;
    this._config = null;
  }

  /**
   * Return queued clips and clear the buffer.
   * @returns {Promise<object[]>}
   */
  async poll() {
    const clips = [...this._pendingClips];
    this._pendingClips = [];
    return clips;
  }

  /**
   * Programmatically clip a URL's content.
   * Can be called from a bookmarklet, keyboard shortcut, or API.
   *
   * @param {{ url: string, title?: string, content?: string, selectedText?: string }} clip
   */
  clipFromUrl(clip) {
    if (!clip?.url && !clip?.content) {
      throw new Error('Either url or content is required');
    }
    this._pendingClips.push({
      url: clip.url || '',
      title: clip.title || _titleFromUrl(clip.url),
      content: clip.content || clip.selectedText || '',
      selectedText: clip.selectedText || '',
      timestamp: Date.now(),
      favicon: null,
      author: null,
    });
  }

  /**
   * Normalize a web clip into a NormalizedContent object.
   * @param {object} clip — Raw clip object
   * @returns {import('../inbound-adapter.js').NormalizedContent}
   */
  normalize(clip) {
    const url = clip.url || '';
    const title = clip.title || _titleFromUrl(url) || 'Web Clip';
    const content = clip.content || clip.selectedText || '';
    const urlHash = _hashString(url || content);

    // Build structured content
    const contentParts = [];
    if (url) contentParts.push(`Source: ${url}`);
    if (clip.author) contentParts.push(`Author: ${clip.author}`);
    if (contentParts.length) contentParts.push('');
    contentParts.push(content);

    return {
      title,
      content: contentParts.join('\n'),
      type: 'bookmark',
      source: 'web-clipper',
      sourceKey: `clip:${urlHash}:${clip.timestamp || Date.now()}`,
      metadata: {
        url,
        favicon: clip.favicon || null,
        author: clip.author || null,
        hasSelection: !!clip.selectedText,
        clippedAt: clip.timestamp || Date.now(),
      },
      tags: ['web-clip', ..._extractDomainTag(url)],
      timestamp: clip.timestamp || Date.now(),
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract a title from a URL (fallback when no title is provided).
 * @param {string} url
 * @returns {string}
 */
function _titleFromUrl(url) {
  if (!url) return 'Web Clip';
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '').split('/').pop() || '';
    const decoded = decodeURIComponent(path).replace(/[-_]/g, ' ');
    return decoded || u.hostname;
  } catch { /* non-critical */
    return url.slice(0, 80);
  }
}

/**
 * Simple string hash for deduplication keys.
 * @param {string} str
 * @returns {string}
 */
function _hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Extract domain as a tag (e.g., 'github.com').
 * @param {string} url
 * @returns {string[]}
 */
function _extractDomainTag(url) {
  if (!url) return [];
  try {
    return [new URL(url).hostname];
  } catch { /* non-critical */
    return [];
  }
}
