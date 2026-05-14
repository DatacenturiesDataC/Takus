// Takus — Feature Flags (Knowledge OS: Labs)
// Simple feature flag system stored in IDB settings.
// Allows dormant features to be activated by users via Settings → Labs.
//
// Flags default to off for experimental features and on for stable features.
// No network calls — purely local preference.

import { getSetting, saveSetting } from './storage.js';

const STORAGE_KEY = 'feature_flags';

/**
 * @typedef {object} FlagDef
 * @property {boolean} default   Default state
 * @property {string}  label     Human-readable label
 * @property {string}  desc      Short description
 * @property {'stable'|'beta'|'experimental'} tier
 */

/** @type {Record<string, FlagDef>} */
const FLAGS = {
  autoRecord: {
    default: false,
    label: 'Calendar-Driven Auto-Recording',
    desc: 'Automatically start recording when a calendar meeting begins.',
    tier: 'experimental',
  },
  archiveEngine: {
    default: false,
    label: 'Intelligent Archival',
    desc: 'Auto-detect archival-eligible recordings and generate condensed packages.',
    tier: 'experimental',
  },
  adaptiveAI: {
    default: true,
    label: 'Adaptive AI Prompts',
    desc: 'AI prompts learn from your task and summary preferences.',
    tier: 'stable',
  },
  blindSpots: {
    default: true,
    label: 'Blind Spot Detection',
    desc: 'Surface patterns you may be ignoring in the Insights panel.',
    tier: 'stable',
  },
  dissent: {
    default: true,
    label: 'Dissent & Open Questions',
    desc: 'Include a section in meeting summaries flagging disagreements and assumptions.',
    tier: 'stable',
  },
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Check if a feature flag is enabled.
 *
 * @param {string} flagName  Key from FLAGS
 * @returns {Promise<boolean>}
 */
export async function isEnabled(flagName) {
  const flag = FLAGS[flagName];
  if (!flag) return false;

  const overrides = await _loadOverrides();
  if (flagName in overrides) return overrides[flagName];
  return flag.default;
}

/**
 * Set a feature flag value.
 *
 * @param {string}  flagName
 * @param {boolean} value
 * @returns {Promise<void>}
 */
export async function setFlag(flagName, value) {
  if (!(flagName in FLAGS)) return;
  const overrides = await _loadOverrides();
  overrides[flagName] = !!value;
  await saveSetting(STORAGE_KEY, overrides);
}

/**
 * Get all flags with their current state and metadata.
 *
 * @returns {Promise<Array<{name: string, enabled: boolean, label: string, desc: string, tier: string, isDefault: boolean}>>}
 */
export async function getAllFlags() {
  const overrides = await _loadOverrides();
  return Object.entries(FLAGS).map(([name, def]) => ({
    name,
    enabled: name in overrides ? overrides[name] : def.default,
    label: def.label,
    desc: def.desc,
    tier: def.tier,
    isDefault: !(name in overrides),
  }));
}

/**
 * Reset all flags to their defaults.
 * @returns {Promise<void>}
 */
export async function resetFlags() {
  await saveSetting(STORAGE_KEY, {});
}

// ── Internal ────────────────────────────────────────────────────────────────

async function _loadOverrides() {
  try {
    const raw = await getSetting(STORAGE_KEY);
    return (raw && typeof raw === 'object') ? raw : {};
  } catch {
    return {};
  }
}
