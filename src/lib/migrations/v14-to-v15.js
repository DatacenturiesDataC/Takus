// Takus — Data Migration: v14 → v15 (App Platform Foundation)
// One-time migration that runs on first load after upgrade.
// Copies existing data into the unified `nodes` store and creates default Passport.
//
// Non-destructive: original stores (entries, contacts) remain untouched.
// Migration state tracked in settings to prevent re-execution.

import { getSetting, saveSetting, saveNode, getNode } from '../storage.js';
import { generateId } from '../id.js';

const MIGRATION_KEY = 'migration_v15_complete';

/**
 * Run the v14 → v15 migration if not yet completed.
 * Safe to call multiple times — it's idempotent.
 *
 * @returns {Promise<{ migrated: boolean, stats: object }>}
 */
export async function runMigrationV15() {
  const alreadyDone = await getSetting(MIGRATION_KEY);
  if (alreadyDone) return { migrated: false, stats: {} };

  console.info('[Migration] Starting v14 → v15 (App Platform Foundation)...');
  const stats = { entries: 0, contacts: 0, passport: false, errors: 0 };

  try {
    // 1. Create default Passport node
    await _createDefaultPassport(stats);

    // 2. Mirror entries into nodes store
    await _migrateEntries(stats);

    // 3. Mirror contacts into nodes store
    await _migrateContacts(stats);

    // Mark complete
    await saveSetting(MIGRATION_KEY, {
      completedAt: Date.now(),
      stats,
    });

    console.info('[Migration] v14 → v15 complete:', stats);
    return { migrated: true, stats };

  } catch (err) {
    console.error('[Migration] v14 → v15 failed:', err);
    stats.errors++;
    // Don't mark as complete so it retries next time
    return { migrated: false, stats };
  }
}

// ── Internal migration steps ──────────────────────────────────────────────

async function _createDefaultPassport(stats) {
  // Check if Passport already exists (from a previous partial run)
  const existingPassport = await getSetting('takus_passport');
  if (existingPassport?.id) {
    // Also write to nodes store
    const passportNode = {
      id: existingPassport.id,
      type: 'identity',
      state: 'active',
      appId: 'passport',
      properties: { ...existingPassport },
      createdAt: existingPassport.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    await saveNode(passportNode);
    stats.passport = true;
    return;
  }

  // Create fresh Passport
  const passportId = generateId('passport');
  const passportData = {
    id: passportId,
    instanceName: 'My Takus',
    ownerName: '',
    birthday: '',
    birthplace: '',
    creatorName: '',
    bio: '',
    avatar: '🧠',
    preferredTone: 'professional',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await saveSetting('takus_passport', passportData);
  await saveNode({
    id: passportId,
    type: 'identity',
    state: 'active',
    appId: 'passport',
    properties: passportData,
    createdAt: passportData.createdAt,
    updatedAt: passportData.updatedAt,
  });

  stats.passport = true;
}

async function _migrateEntries(stats) {
  try {
    // Direct IDB access to avoid storage.js circular deps
    const { getEntries } = await import('../storage.js');
    const entries = await getEntries();

    for (const entry of entries) {
      try {
        // Check if already migrated
        const existing = await getNode(entry.id);
        if (existing) continue;

        await saveNode({
          id: entry.id,
          type: 'entry',
          state: entry.state || 'active',
          appId: 'recorder',
          properties: {
            title: entry.title,
            date: entry.date,
            duration: entry.duration,
            contentType: entry.type,
            // Keep a reference — don't duplicate large fields
            hasAiSummary: !!entry.aiSummary,
            hasTranscript: !!entry.textContent,
            hasTasks: !!(entry.tasks?.takusTasks?.length || entry.tasks?.meTasks?.length),
            participantCount: entry.participants?.length || 0,
          },
          createdAt: entry.date || Date.now(),
          updatedAt: Date.now(),
        });
        stats.entries++;
      } catch (err) {
        console.warn(`[Migration] Skipped entry ${entry.id}:`, err.message);
        stats.errors++;
      }
    }
  } catch (err) {
    console.warn('[Migration] Could not migrate entries:', err.message);
    stats.errors++;
  }
}

async function _migrateContacts(stats) {
  try {
    const { getContacts } = await import('../storage.js');
    const contacts = await getContacts();

    for (const contact of contacts) {
      try {
        const existing = await getNode(contact.id);
        if (existing) continue;

        await saveNode({
          id: contact.id,
          type: 'person',
          state: 'active',
          appId: 'people',
          properties: {
            name: contact.name,
            email: contact.email,
            closenessScore: contact.closenessScore,
            isManualClose: contact.isManualClose,
            organization: contact.organization || '',
            role: contact.role || '',
          },
          createdAt: contact.createdAt || Date.now(),
          updatedAt: contact.updatedAt || Date.now(),
        });
        stats.contacts++;
      } catch (err) {
        console.warn(`[Migration] Skipped contact ${contact.id}:`, err.message);
        stats.errors++;
      }
    }
  } catch (err) {
    console.warn('[Migration] Could not migrate contacts:', err.message);
    stats.errors++;
  }
}

/**
 * Check if the v15 migration has been completed.
 * @returns {Promise<boolean>}
 */
export async function isMigrationV15Complete() {
  const result = await getSetting(MIGRATION_KEY);
  return !!result;
}

/**
 * Force re-run migration (for development/debugging).
 * @returns {Promise<{ migrated: boolean, stats: object }>}
 */
export async function forceMigrationV15() {
  await saveSetting(MIGRATION_KEY, null);
  return runMigrationV15();
}
