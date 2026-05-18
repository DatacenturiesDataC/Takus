// Takus — Content Types (Knowledge OS)
// Centralized content type definitions, labels, and accent colours.
// Covers entries, documents, emails, notes, and all future content.

import { icons } from './icons.js';

/**
 * @typedef {object} ContentType
 * @property {string} id
 * @property {'entry'|'document'} category - Content category
 * @property {string} [key] - Keyboard shortcut key (entry types only)
 * @property {string} label
 * @property {Function} icon - (size) => SVG string
 * @property {string} description
 * @property {string} accent - CSS colour
 * @property {string} accentDim - CSS colour (low-opacity background)
 */

/** @type {ContentType[]} */
export const CONTENT_TYPES = [
  // ── Capture types (media entries) ───────────────────────────────────────
  {
    id: 'meeting',
    category: 'entry',
    key: 'm',
    label: 'Meeting',
    icon: (s) => icons.calendar(s),
    description: 'Syncs with your calendar, extracts participants, and generates structured meeting notes with action items.',
    accent: '#7c3aed',
    accentDim: 'rgba(124,58,237,0.15)',
  },
  {
    id: 'screen',
    category: 'entry',
    key: 's',
    label: 'Screen Capture',
    icon: (s) => icons.monitor(s),
    description: 'Capture demos, tutorials or walkthroughs. AI summarises what was shown and the key steps demonstrated.',
    accent: '#0ea5e9',
    accentDim: 'rgba(14,165,233,0.15)',
  },
  {
    id: 'presentation',
    category: 'entry',
    key: 'p',
    label: 'Presentation',
    icon: (s) => icons.layout(s),
    description: 'Record your slide deck. AI extracts the key points, section structure and audience takeaways.',
    accent: '#10b981',
    accentDim: 'rgba(16,185,129,0.15)',
  },
  {
    id: 'update',
    category: 'entry',
    key: 'u',
    label: 'Status Update',
    icon: (s) => icons.zap(s),
    description: 'Quick async update for your team. AI produces a TL;DR, ticket references and a shareable summary.',
    accent: '#f59e0b',
    accentDim: 'rgba(245,158,11,0.15)',
  },

  // ── Document types ───────────────────────────────────────────────────────
  {
    id: 'document',
    category: 'document',
    label: 'Document',
    icon: (s) => icons.info(s),
    description: 'Imported document. AI extracts key points, references, and action items.',
    accent: '#6366f1',
    accentDim: 'rgba(99,102,241,0.15)',
  },
  {
    id: 'markdown',
    category: 'document',
    label: 'Markdown Note',
    icon: (s) => icons.edit(s),
    description: 'Markdown note or README. AI organises, summarises, and extracts structured insights.',
    accent: '#8b5cf6',
    accentDim: 'rgba(139,92,246,0.15)',
  },
  {
    id: 'email',
    category: 'document',
    label: 'Email',
    icon: (s) => icons.send(s),
    description: 'Email thread. AI extracts action items, commitments, and follow-up requirements.',
    accent: '#ec4899',
    accentDim: 'rgba(236,72,153,0.15)',
  },
  {
    id: 'note',
    category: 'document',
    label: 'Note',
    icon: (s) => icons.edit(s),
    description: 'Free-form note. AI organises and enhances with structure and cross-references.',
    accent: '#14b8a6',
    accentDim: 'rgba(20,184,166,0.15)',
  },
  {
    id: 'bookmark',
    category: 'document',
    label: 'Bookmark',
    icon: (s) => icons.link(s),
    description: 'Saved link or web content. AI extracts key information and related context.',
    accent: '#f97316',
    accentDim: 'rgba(249,115,22,0.15)',
  },
  {
    id: 'chat',
    category: 'document',
    label: 'Chat Message',
    icon: (s) => icons.send(s),
    description: 'Imported chat message (Slack, Teams). AI extracts decisions, action items, and context.',
    accent: '#06b6d4',
    accentDim: 'rgba(6,182,212,0.15)',
  },
];

// ── LocalStorage Keys (capture preferences) ──────────────────────────────────
export const LAST_TYPE_KEY = 'takus_last_capture_type';
export const LAST_TEMPLATE_KEY = 'takus_last_capture_template';

/**
 * Get only capture/media types (for the type picker during recording).
 * @returns {ContentType[]}
 */
export function getCaptureTypes() {
  return CONTENT_TYPES.filter(t => t.category === 'entry');
}

/**
 * Get only document types.
 * @returns {ContentType[]}
 */
export function getDocumentTypes() {
  return CONTENT_TYPES.filter(t => t.category === 'document');
}

/**
 * Human-readable label for a content type id.
 * @param {string} typeId
 * @returns {string}
 */
export function typeLabel(typeId) {
  return CONTENT_TYPES.find(t => t.id === typeId)?.label || typeId || 'Content';
}

/**
 * Accent colour for badge display.
 * @param {string} typeId
 * @returns {string}
 */
export function typeAccent(typeId) {
  return CONTENT_TYPES.find(t => t.id === typeId)?.accent || 'var(--color-text-muted)';
}

/**
 * Get the content category for a type id.
 * @param {string} typeId
 * @returns {'entry'|'document'}
 */
export function getCategory(typeId) {
  return CONTENT_TYPES.find(t => t.id === typeId)?.category || 'entry';
}

/**
 * Get icon renderer for a content type.
 * @param {string} typeId
 * @returns {Function} (size) => SVG string
 */
export function typeIcon(typeId) {
  return CONTENT_TYPES.find(t => t.id === typeId)?.icon || icons.info;
}
