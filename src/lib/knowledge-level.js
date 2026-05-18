
// Assigns a knowledge level to content items based on ownership,
// participation, contact proximity, and engagement signals.

import { isCloseContact } from './closeness-score.js';

/**
 * Knowledge level priority (L0 = highest, L4 = lowest):
 *
 *   L0 — Owned by me (user is the creator/organizer)
 *   L1 — Involved me (user is a participant, mentioned, or cc'd)
 *   L2 — From my contacts (created by someone in user's contact list)
 *   L3 — Surfaced by close contact (L2 + author has closeness ≥ 65 + active engagement)
 *   L4 — Public & unassociated (everything else)
 */

/** @typedef {'L0'|'L1'|'L2'|'L3'|'L4'} KnowledgeLevel */

/**
 * Assign a knowledge level to a content item.
 *
 * Priority: L0 > L1 > L3 > L2 > L4
 * Note: L3 beats L2 because endorsed close-contact content is more relevant.
 *
 * @param {object} contentItem
 * @param {string} contentItem.ownerId    Creator/organizer of the content
 * @param {Array<string>} contentItem.participants  Array of user IDs/emails involved
 * @param {string|null} contentItem.contactId  The author's contact ID (null if unknown)
 * @param {string} currentUserId           The current user's identifier
 * @param {Map<string, object>} contactMap  Map of contactId → contact object (with closenessScore)
 * @param {Set<string>} engagedContentIds   Set of content IDs that have engagement events from close contacts
 * @returns {KnowledgeLevel}
 */
export function assignKnowledgeLevel(contentItem, currentUserId, contactMap, engagedContentIds = new Set()) {
  // L0: Owned by me
  if (contentItem.ownerId === currentUserId) return 'L0';

  // L1: I'm a participant
  if (contentItem.participants?.includes(currentUserId)) return 'L1';

  // Check if the author is in my contacts
  const authorContact = contentItem.contactId ? contactMap.get(contentItem.contactId) : null;

  if (authorContact) {
    // L3: Surfaced by close contact with active engagement
    if (isCloseContact(authorContact.closenessScore) && engagedContentIds.has(contentItem.id)) {
      return 'L3';
    }
    // L2: From my contacts (but not close or no engagement)
    return 'L2';
  }

  // L4: Public & unassociated
  return 'L4';
}

/**
 * Batch re-evaluate knowledge levels for all content items.
 * Useful when contact closeness scores change (crossing the 65 threshold).
 *
 * @param {Array} contentItems    All content items from storage
 * @param {string} currentUserId
 * @param {Map<string, object>} contactMap
 * @param {Set<string>} engagedContentIds
 * @returns {Array<{ id: string, oldLevel: KnowledgeLevel, newLevel: KnowledgeLevel, changed: boolean }>}
 */
export function resolveAllLevels(contentItems, currentUserId, contactMap, engagedContentIds = new Set()) {
  return contentItems.map(item => {
    const newLevel = assignKnowledgeLevel(item, currentUserId, contactMap, engagedContentIds);
    const oldLevel = item.knowledgeLevel || 'L4';
    return {
      id: item.id,
      oldLevel,
      newLevel,
      changed: newLevel !== oldLevel,
    };
  });
}

/**
 * Get a human-readable label for a knowledge level.
 * @param {KnowledgeLevel} level
 * @returns {{ label: string, description: string, color: string }}
 */
export function getKnowledgeLevelInfo(level) {
  const levels = {
    L0: { label: 'Owned',     description: 'Created by you',                          color: 'var(--color-primary-light)' },
    L1: { label: 'Involved',  description: 'You participated in this',                color: 'var(--color-info)' },
    L2: { label: 'Contact',   description: 'From someone in your contacts',           color: 'var(--color-success)' },
    L3: { label: 'Surfaced',  description: 'Surfaced by a close contact',             color: 'var(--color-warning)' },
    L4: { label: 'Public',    description: 'Public or from an unknown source',        color: 'var(--color-text-muted)' },
  };
  return levels[level] || levels.L4;
}

/**
 * Sort content items by knowledge level relevance (L0 first → L4 last),
 * then by recency within each level.
 * @param {Array} items
 * @returns {Array}
 */
export function sortByRelevance(items) {
  const levelOrder = { L0: 0, L1: 1, L3: 2, L2: 3, L4: 4 };
  return [...items].sort((a, b) => {
    const la = levelOrder[a.knowledgeLevel] ?? 4;
    const lb = levelOrder[b.knowledgeLevel] ?? 4;
    if (la !== lb) return la - lb;
    return (b.date || 0) - (a.date || 0); // newest first within same level
  });
}
