import { saveEntry, getContacts, saveContact, getAllNodes, saveNode, getAllEdges, addEdge } from './storage.js';
import { notifyEphemeral } from './notification-manager.js';

/**
 * Export all recordings as a JSON backup file.
 * Version 2: includes contacts, graph nodes, and edges for full knowledge graph portability.
 * Strips observer logs for privacy.
 *
 * @param {Array} recordings  Array of recording objects
 */
export async function exportLibrary(recordings) {
  // Gather knowledge graph data alongside recordings
  const [contacts, nodes, edges] = await Promise.all([
    getContacts().catch(() => []),
    getAllNodes().catch(() => []),
    getAllEdges().catch(() => []),
  ]);

  const exportData = {
    version: 2,
    exportedAt: Date.now(),
    recordings: recordings.map(({ observerLog: _obs, ...r }) => r),
    contacts,
    nodes,
    edges,
  };
  _downloadJSON(exportData, `takus-backup-${_dateStamp()}.json`);
  const extras = [contacts.length && `${contacts.length} contacts`, nodes.length && `${nodes.length} nodes`].filter(Boolean).join(', ');
  notifyEphemeral('Library exported', `${recordings.length} recording${recordings.length !== 1 ? 's' : ''}${extras ? ` + ${extras}` : ''} saved`, 'success');
}

/**
 * Export a subset of selected recordings as JSON.
 *
 * @param {Array}  recordings  All recordings
 * @param {Set}    selectedIds Set of selected recording IDs
 */
export function exportSelected(recordings, selectedIds) {
  if (!selectedIds.size) { notifyEphemeral('No recordings selected', '', 'info'); return; }
  const selected = recordings.filter(r => selectedIds.has(r.id));
  const exportData = {
    version: 1,
    exportedAt: Date.now(),
    recordings: selected.map(({ observerLog: _obs, ...r }) => r),
  };
  _downloadJSON(exportData, `takus-selected-${_dateStamp()}.json`);
  notifyEphemeral('Exported', `${selected.length} recording(s) saved`, 'success');
}

/**
 * Import recordings from a JSON backup file.
 * Merges with existing library, skipping duplicates.
 * Version 2 files also restore contacts, graph nodes, and edges.
 *
 * @param {File}  file        File input from user
 * @param {Array} existing    Existing recordings (for dedup)
 * @returns {Promise<{imported: number, skipped: number}>}
 */
export async function importLibrary(file, existing) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Invalid file — expected a valid JSON backup. Check the file format and try again.');
  }
  if (!Array.isArray(data.recordings)) throw new Error('Not a valid Takus export file');

  const existingIds = new Set(existing.map(r => r.id));
  let imported = 0, skipped = 0;

  for (const rec of data.recordings) {
    if (!rec.id || !rec.date) { skipped++; continue; }
    if (existingIds.has(rec.id)) { skipped++; continue; }
    await saveEntry(rec).catch(e => console.warn('[Import] Save failed:', e.message));
    imported++;
  }

  // Restore knowledge graph data (v2 format)
  let graphRestored = 0;
  if (data.version >= 2) {
    const existingContacts = await getContacts().catch(() => []);
    const contactIds = new Set(existingContacts.map(c => c.id));
    for (const c of (data.contacts || [])) {
      if (c.id && !contactIds.has(c.id)) {
        await saveContact(c).catch(() => {});
        graphRestored++;
      }
    }
    for (const n of (data.nodes || [])) {
      if (n.id) {
        await saveNode(n).catch(() => {});
        graphRestored++;
      }
    }
    for (const e of (data.edges || [])) {
      if (e.sourceId && e.targetId) {
        await addEdge(e).catch(() => {});
        graphRestored++;
      }
    }
  }

  const graphMsg = graphRestored > 0 ? ` + ${graphRestored} graph items` : '';
  notifyEphemeral('Import complete', `${imported} recording${imported !== 1 ? 's' : ''} added${skipped ? `, ${skipped} skipped` : ''}${graphMsg}`, 'success');
  return { imported, skipped };
}

/**
 * Trigger a ZIP backup with video blobs (delegated to zip-export.js).
 *
 * @param {HTMLElement} btn  The button element (for spinner state)
 */
export async function exportZipBackup(btn) {
  if (btn.disabled) return;
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = `<div class="spinner" style="width:11px;height:11px;border-width:2px;"></div>`;
  try {
    const { exportZip } = await import('./zip-export.js');
    await exportZip(btn);
  } catch (err) {
    console.warn('[ZIP]', err);
    notifyEphemeral('Backup failed', err.message || 'Could not create ZIP archive.', 'error');
  } finally {
    btn.innerHTML = orig;
    btn.disabled = false;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function _dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
