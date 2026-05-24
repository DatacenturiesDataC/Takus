
// Enables data restore: import entries, tasks, goals, and contacts
// from JSON or ZIP backups produced by export-engine.js / zip-export.js.

import { saveEntry, getEntry, saveContact, getContact, saveNode, getNode } from './storage.js';
import { validateEntry, validateContact } from './schema-validator.js';
import { createTask } from './graph/task-store.js';

/**
 * Import data from a JSON export string.
 * Accepts bundles from both exportData() (version 1) and ZIP metadata (version 2).
 *
 * @param {string} jsonString - The JSON string to import
 * @returns {Promise<{ imported: number, skipped: number, errors: string[] }>}
 */
export async function importFromJSON(jsonString) {
  const result = { imported: 0, skipped: 0, errors: [] };

  // ── Parse ─────────────────────────────────────────────────────────────────
  let bundle;
  try {
    bundle = JSON.parse(jsonString);
  } catch (e) {
    result.errors.push(`Invalid JSON: ${e.message}`);
    return result;
  }

  // ── Validate export format ────────────────────────────────────────────────
  if (!bundle || typeof bundle !== 'object') {
    result.errors.push('Import file is not a valid export bundle.');
    return result;
  }
  if (bundle.version === undefined || bundle.version === null) {
    result.errors.push('Missing "version" field — not a Takus export file.');
    return result;
  }
  if (!Array.isArray(bundle.entries)) {
    result.errors.push('Missing "entries" array — not a valid Takus export.');
    return result;
  }

  // ── Import entries ────────────────────────────────────────────────────────
  for (const raw of bundle.entries) {
    try {
      const entry = validateEntry(raw);
      if (!entry) {
        result.errors.push(`Entry skipped: failed validation (id: ${raw?.id || 'unknown'})`);
        result.skipped++;
        continue;
      }

      // Duplicate check by ID
      const existing = await getEntry(entry.id);
      if (existing) {
        result.skipped++;
        continue;
      }

      await saveEntry(entry);
      result.imported++;
    } catch (e) {
      result.errors.push(`Entry "${raw?.id || 'unknown'}": ${e.message}`);
    }
  }

  // ── Import tasks (as graph nodes) ─────────────────────────────────────────
  if (Array.isArray(bundle.tasks)) {
    for (const task of bundle.tasks) {
      try {
        if (!task.id) continue;

        // Check if this task node already exists
        const existing = await getNode(task.id);
        if (existing) {
          result.skipped++;
          continue;
        }

        // Re-create task via task-store (creates node + edge)
        await createTask({
          id: task.id,
          title: task.title || 'Untitled Task',
          status: task.status || 'pending',
          assignee: task.assignee || 'me',
          action: task.action || 'TAKUS_TASK',
          objective: task.objective || null,
          output: task.output || null,
          ignoredReason: task.ignoredReason || null,
          contextTimestamp: task.contextTimestamp || null,
          deadline: task.deadline || null,
          urgency: task.urgency || 'normal',
          steps: task.steps || [],
          sequence: task.sequence || null,
          integrations: task.integrations || [],
          priorityOverride: task.priorityOverride || null,
        }, task._contentId || task.sourceContentId || null);

        result.imported++;
      } catch (e) {
        result.errors.push(`Task "${task.id}": ${e.message}`);
      }
    }
  }

  // ── Import goals (as graph nodes) ─────────────────────────────────────────
  if (Array.isArray(bundle.goals)) {
    for (const goal of bundle.goals) {
      try {
        if (!goal.id) continue;

        const existing = await getNode(goal.id);
        if (existing) {
          result.skipped++;
          continue;
        }

        await saveNode({
          id: goal.id,
          type: 'goal',
          state: goal.state || 'active',
          appId: 'goals',
          properties: {
            title: goal.title || 'Untitled Goal',
            description: goal.description || null,
            state: goal.state || 'aspiration',
            targetDate: goal.targetDate || null,
          },
          createdAt: goal.createdAt || Date.now(),
          updatedAt: goal.updatedAt || Date.now(),
        });

        result.imported++;
      } catch (e) {
        result.errors.push(`Goal "${goal.id}": ${e.message}`);
      }
    }
  }

  // ── Import contacts ───────────────────────────────────────────────────────
  if (Array.isArray(bundle.contacts)) {
    for (const raw of bundle.contacts) {
      try {
        const contact = validateContact(raw);
        if (!contact) {
          result.skipped++;
          continue;
        }

        const existing = await getContact(contact.id);
        if (existing) {
          result.skipped++;
          continue;
        }

        await saveContact(contact);
        result.imported++;
      } catch (e) {
        result.errors.push(`Contact "${raw?.id || 'unknown'}": ${e.message}`);
      }
    }
  }

  return result;
}

/**
 * Import data from a ZIP backup file.
 * Extracts takus-metadata.json from the ZIP and delegates to importFromJSON.
 * Skips video blobs (too large for restore).
 *
 * @param {File|Blob} file - The ZIP file to import
 * @returns {Promise<{ imported: number, skipped: number, errors: string[] }>}
 */
export async function importFromZIP(file) {
  try {
    const buffer = await file.arrayBuffer();
    const metadataJson = _extractFileFromZip(new Uint8Array(buffer), 'takus-metadata.json');

    if (!metadataJson) {
      return { imported: 0, skipped: 0, errors: ['ZIP does not contain takus-metadata.json'] };
    }

    const text = new TextDecoder().decode(metadataJson);
    return importFromJSON(text);
  } catch (e) {
    return { imported: 0, skipped: 0, errors: [`Failed to read ZIP: ${e.message}`] };
  }
}

// ── Minimal ZIP reader ──────────────────────────────────────────────────────
// Extracts a single named file from a ZIP archive (store method, no compression).

function _extractFileFromZip(zipData, targetName) {
  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);
  let offset = 0;

  while (offset + 30 <= zipData.length) {
    // Check local file header signature
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break; // Not a local file header

    const compressedSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameBytes = zipData.slice(offset + 30, offset + 30 + nameLen);
    const name = new TextDecoder().decode(nameBytes);

    const dataStart = offset + 30 + nameLen + extraLen;

    if (name === targetName) {
      return zipData.slice(dataStart, dataStart + compressedSize);
    }

    offset = dataStart + compressedSize;
  }

  return null;
}
