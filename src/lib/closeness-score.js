// Takus — Closeness Score Engine (Phase 16: Knowledge Source Levels)
// Computes a 0–100 closeness score for each contact based on interaction signals.

import { getInteractionsForContact } from './storage.js';
import { MS_PER_DAY, MS_PER_HOUR } from './utils.js';

/**
 * Linear interpolation mapping an input value to a 0–100 range
 * based on a set of breakpoints.
 * @param {number} value
 * @param {Array<[number, number]>} breakpoints  Sorted [input, output] pairs
 * @returns {number}
 */
function interpolate(value, breakpoints) {
  if (value <= breakpoints[0][0]) return breakpoints[0][1];
  for (let i = 1; i < breakpoints.length; i++) {
    const [x0, y0] = breakpoints[i - 1];
    const [x1, y1] = breakpoints[i];
    if (value <= x1) {
      const t = (value - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return breakpoints[breakpoints.length - 1][1];
}

/**
 * Aggregate raw interaction signals for a contact over a given window.
 *
 * @param {string} contactId
 * @param {Array}  interactions  All interactions from storage
 * @param {number} daysBack     How many days of history to consider (default 30)
 * @returns {{ directMessages: number, meetings: number, sharedTasks: number, mentions: number, lastInteractionTime: number|null }}
 */
export function aggregateSignals(contactId, interactions, daysBack = 30) {
  const cutoff = Date.now() - daysBack * MS_PER_DAY;
  const recent = interactions
    .filter(i => i.contactId === contactId && i.timestamp >= cutoff);

  const signals = {
    directMessages: 0,
    meetings: 0,
    sharedTasks: 0,
    mentions: 0,
    lastInteractionTime: null,
  };

  for (const i of recent) {
    switch (i.type) {
      case 'direct_message': signals.directMessages++; break;
      case 'meeting':        signals.meetings++;        break;
      case 'shared_task':    signals.sharedTasks++;      break;
      case 'mention':        signals.mentions++;         break;
    }
    if (!signals.lastInteractionTime || i.timestamp > signals.lastInteractionTime) {
      signals.lastInteractionTime = i.timestamp;
    }
  }

  return signals;
}

/**
 * Compute the closeness score for a single contact.
 *
 * The score is a weighted sum of normalized interaction signals plus boosters,
 * clamped to 0–100.
 *
 * @param {object} contact       Contact object with { id, isManualClose, org?, role? }
 * @param {Array}  interactions  All interactions from getInteractionsForContact
 * @param {object} options       Optional config overrides
 * @returns {number}  Closeness score (0–100)
 */
export function computeClosenessScore(contact, interactions, options = {}) {
  const signals = aggregateSignals(contact.id, interactions, options.daysBack || 30);

  // Signal normalization via linear interpolation
  const dmScore = interpolate(signals.directMessages, [[0, 0], [10, 25], [30, 50], [50, 100]]);
  const meetScore = interpolate(signals.meetings, [[0, 0], [2, 40], [5, 80], [8, 100]]);
  const taskScore = interpolate(signals.sharedTasks, [[0, 0], [1, 30], [3, 70], [5, 100]]);
  const mentionScore = interpolate(signals.mentions, [[0, 0], [2, 50], [5, 100]]);
  const manualScore = contact.isManualClose ? 100 : 0;

  // Weighted sum
  let total = dmScore * 0.35
    + meetScore * 0.25
    + taskScore * 0.20
    + mentionScore * 0.10
    + manualScore * 0.10;

  // Boosters (optional, capped at 100)
  if (contact.org && contact.org === options.userOrg) total += 5;
  if (signals.lastInteractionTime && (Date.now() - signals.lastInteractionTime) < 48 * MS_PER_HOUR) total += 5;
  if (contact.role === 'manager' || contact.role === 'report') total += 10;

  return Math.min(100, Math.max(0, Math.round(total)));
}

/**
 * Determine if a contact is "close" based on their closeness score.
 * @param {number} score
 * @param {number} threshold  Default 65
 * @returns {boolean}
 */
export function isCloseContact(score, threshold = 65) {
  return score >= threshold;
}

/**
 * Batch-recompute closeness scores for all contacts.
 * Returns an array of { contactId, oldScore, newScore, changed }.
 *
 * @param {Array} contacts       All contact objects
 * @param {Array} allInteractions  All interactions from getAllInteractions()
 * @param {object} options
 * @returns {Array<{ contactId: string, oldScore: number, newScore: number, changed: boolean }>}
 */
export function recomputeAllScores(contacts, allInteractions, options = {}) {
  return contacts.map(contact => {
    const contactInteractions = allInteractions.filter(i => i.contactId === contact.id);
    const newScore = computeClosenessScore(contact, contactInteractions, options);
    const oldScore = contact.closenessScore || 0;
    return {
      contactId: contact.id,
      oldScore,
      newScore,
      changed: newScore !== oldScore,
    };
  });
}
