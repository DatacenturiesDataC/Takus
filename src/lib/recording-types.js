// Takus — Recording Types
// Centralized recording type definitions, labels, and accent colours.
// Extracted from type-picker.js so lib/ modules can reference type
// metadata without depending on a component.

import { icons } from './icons.js';

/**
 * @typedef {object} RecordingType
 * @property {string} id
 * @property {string} key - Keyboard shortcut key
 * @property {string} label
 * @property {Function} icon - (size) => SVG string
 * @property {string} description
 * @property {string} accent - CSS colour
 * @property {string} accentDim - CSS colour (low-opacity background)
 */

/** @type {RecordingType[]} */
export const TYPES = [
  {
    id: 'meeting',
    key: 'm',
    label: 'Meeting',
    icon: (s) => icons.calendar(s),
    description: 'Syncs with your calendar, extracts participants, and generates structured meeting notes with action items.',
    accent: '#7c3aed',
    accentDim: 'rgba(124,58,237,0.15)',
  },
  {
    id: 'screen',
    key: 's',
    label: 'Screen Recording',
    icon: (s) => icons.monitor(s),
    description: 'Capture demos, tutorials or walkthroughs. AI summarises what was shown and the key steps demonstrated.',
    accent: '#0ea5e9',
    accentDim: 'rgba(14,165,233,0.15)',
  },
  {
    id: 'presentation',
    key: 'p',
    label: 'Presentation',
    icon: (s) => icons.layout(s),
    description: 'Record your slide deck. AI extracts the key points, section structure and audience takeaways.',
    accent: '#10b981',
    accentDim: 'rgba(16,185,129,0.15)',
  },
  {
    id: 'update',
    key: 'u',
    label: 'Status Update',
    icon: (s) => icons.zap(s),
    description: 'Quick async update for your team. AI produces a TL;DR, ticket references and a shareable summary.',
    accent: '#f59e0b',
    accentDim: 'rgba(245,158,11,0.15)',
  },
];

/**
 * Human-readable label for a recording type id.
 * @param {string} typeId
 * @returns {string}
 */
export function typeLabel(typeId) {
  return TYPES.find(t => t.id === typeId)?.label || typeId || 'Recording';
}

/**
 * Accent colour for badge display.
 * @param {string} typeId
 * @returns {string}
 */
export function typeAccent(typeId) {
  return TYPES.find(t => t.id === typeId)?.accent || 'var(--color-text-muted)';
}
