// Takus — ZIP Export (Phase 7b)
// Builds a ZIP archive from recordings metadata + video blobs entirely in-browser.
// Uses a minimal ZIP builder — no external library required.

import { getRecordings, getRecordingBlob } from './storage.js';
import { formatDuration, formatSize } from './recorder.js';
import { isStepDone, getTaskTitle } from './task-helpers.js';
import { notifyEphemeral } from './notification-manager.js';

/**
 * Export the full library as a ZIP containing:
 * - takus-metadata.json  (all recording metadata)
 * - recordings/{id}/original.webm  (video blob, if available)
 * - recordings/{id}/summary.md     (AI summary, if available)
 * - recordings/{id}/transcript.vtt (VTT transcript, if available)
 * - recordings/{id}/tasks.md       (tasks with steps/objectives, if available)
 *
 * Shows a progress toast while assembling.
 * Uses `showSaveFilePicker` when available, falls back to Blob download.
 *
 * @param {HTMLElement} statusEl  Optional element to show progress text
 */
export async function exportZip(statusEl) {
  const recordings = await getRecordings().catch(() => []);
  if (!recordings.length) {
    notifyEphemeral('Nothing to export', 'No recordings in the library.', 'info');
    return;
  }

  const totalItems = recordings.length;
  let processed = 0;

  const _progress = (msg) => {
    if (statusEl) statusEl.textContent = msg;
  };

  _progress(`Preparing ${totalItems} recordings…`);

  // Build file entries
  const files = [];

  // 1. Metadata JSON (exclude observerLog for privacy/size)
  const meta = {
    version: 2,
    exportedAt: Date.now(),
    exportType: 'full-backup',
    recordings: recordings.map(({ observerLog: _obs, ...r }) => r),
  };
  files.push({
    name: 'takus-metadata.json',
    data: _encode(JSON.stringify(meta, null, 2)),
  });

  // 2. Per-recording files
  for (const rec of recordings) {
    processed++;
    _progress(`Packing ${processed}/${totalItems}: ${rec.title || 'Untitled'}…`);

    const prefix = `recordings/${rec.id}`;

    // Video blob
    try {
      const blob = await getRecordingBlob(rec.id);
      if (blob && blob.size > 0) {
        const buf = await blob.arrayBuffer();
        files.push({ name: `${prefix}/original.webm`, data: new Uint8Array(buf) });
      }
    } catch { /* blob not available — skip silently */ }

    // AI summary
    if (rec.aiSummary) {
      const header = `# ${rec.title || 'Untitled'}\n\n_${new Date(rec.date).toLocaleString()} · ${formatDuration(rec.duration)} · ${rec.type || 'recording'}_\n\n---\n\n`;
      files.push({ name: `${prefix}/summary.md`, data: _encode(header + rec.aiSummary) });
    }

    // VTT transcript
    if (rec.aiVtt) {
      files.push({ name: `${prefix}/transcript.vtt`, data: _encode(rec.aiVtt) });
    }

    // Plain transcript (only if no VTT)
    if (rec.aiTranscript && !rec.aiVtt) {
      files.push({ name: `${prefix}/transcript.txt`, data: _encode(rec.aiTranscript) });
    }

    // Tasks (Phase 15)
    const allTasks = [...(rec.tasks?.takusTasks || []), ...(rec.tasks?.meTasks || [])];
    if (allTasks.length) {
      const taskLines = [`# Tasks — ${rec.title || 'Untitled'}`, ''];
      // Group by objective
      const byObjective = {};
      for (const t of allTasks) {
        const obj = t.objective || 'Uncategorized';
        if (!byObjective[obj]) byObjective[obj] = [];
        byObjective[obj].push(t);
      }
      for (const [obj, tasks] of Object.entries(byObjective)) {
        if (obj !== 'Uncategorized') taskLines.push(`## 🎯 ${obj}`, '');
        for (const t of tasks) {
          const icon = t.status === 'done' ? '✅' : t.status === 'ignored' ? '🚫' : '⏳';
          const title = getTaskTitle(t);
          taskLines.push(`### ${icon} ${title}`);
          if (t.action) taskLines.push(`**Type:** ${t.action}`);
          if (t.contextTimestamp) taskLines.push(`**Timestamp:** ${t.contextTimestamp}`);
          if (t.integrations?.length) taskLines.push(`**Integrations:** ${t.integrations.join(', ')}`);
          if (t.steps?.length) {
            taskLines.push('', '**Steps:**');
            for (const s of t.steps) {
              taskLines.push(`- [${isStepDone(s) ? 'x' : ' '}] ${s.text}`);
            }
          }
          if (t.output) taskLines.push('', `**Output:** ${t.output}`);
          if (t.ignoredReason) taskLines.push('', `**Reason:** ${t.ignoredReason}`);
          taskLines.push('');
        }
      }
      files.push({ name: `${prefix}/tasks.md`, data: _encode(taskLines.join('\n')) });
    }
  }

  _progress('Building ZIP archive…');

  // Build the ZIP
  const zipBlob = _buildZip(files);

  // Download
  const filename = `takus-full-backup-${new Date().toISOString().slice(0, 10)}.zip`;

  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(zipBlob);
      await writable.close();
      _progress('');
      notifyEphemeral('Full backup saved', `${files.length} files exported`, 'success');
      return;
    } catch (e) {
      // User cancelled file picker or API not supported — fall through to download
      if (e.name === 'AbortError') { _progress(''); return; }
    }
  }

  // Fallback: traditional download
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 120000);

  _progress('');
  notifyEphemeral('Full backup downloaded', `${files.length} files in ${formatSize(zipBlob.size)}`, 'success');
}

// ── Minimal ZIP builder ─────────────────────────────────────────────────────────
// Implements ZIP format (store method, no compression — video is already compressed)
// Spec: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT

function _encode(str) {
  return new TextEncoder().encode(str);
}

function _buildZip(files) {
  const centralDir = [];
  const localParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = _encode(file.name);
    const data = file.data;

    // Local file header (30 + name + data)
    const local = new ArrayBuffer(30 + nameBytes.length + data.length);
    const lv = new DataView(local);
    lv.setUint32(0, 0x04034b50, true);   // signature
    lv.setUint16(4, 20, true);           // version needed
    lv.setUint16(6, 0, true);            // flags
    lv.setUint16(8, 0, true);            // compression: store
    lv.setUint16(10, 0, true);           // mod time
    lv.setUint16(12, 0, true);           // mod date
    lv.setUint32(14, _crc32(data), true); // CRC-32
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);           // extra field len

    const lu = new Uint8Array(local);
    lu.set(nameBytes, 30);
    lu.set(data, 30 + nameBytes.length);
    localParts.push(lu);

    // Central directory entry (46 + name)
    const central = new ArrayBuffer(46 + nameBytes.length);
    const cv = new DataView(central);
    cv.setUint32(0, 0x02014b50, true);   // signature
    cv.setUint16(4, 20, true);           // version made by
    cv.setUint16(6, 20, true);           // version needed
    cv.setUint16(8, 0, true);            // flags
    cv.setUint16(10, 0, true);           // compression: store
    cv.setUint16(12, 0, true);           // mod time
    cv.setUint16(14, 0, true);           // mod date
    cv.setUint32(16, _crc32(data), true); // CRC-32
    cv.setUint32(20, data.length, true); // compressed size
    cv.setUint32(24, data.length, true); // uncompressed size
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);           // extra field len
    cv.setUint16(32, 0, true);           // comment len
    cv.setUint16(34, 0, true);           // disk number
    cv.setUint16(36, 0, true);           // internal attrs
    cv.setUint32(38, 0, true);           // external attrs
    cv.setUint32(42, offset, true);      // local header offset

    const cu = new Uint8Array(central);
    cu.set(nameBytes, 46);
    centralDir.push(cu);

    offset += lu.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const c of centralDir) centralDirSize += c.length;

  // End of central directory (22 bytes)
  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);    // signature
  ev.setUint16(4, 0, true);             // disk number
  ev.setUint16(6, 0, true);             // disk with central dir
  ev.setUint16(8, files.length, true);  // entries on disk
  ev.setUint16(10, files.length, true); // total entries
  ev.setUint32(12, centralDirSize, true);
  ev.setUint32(16, centralDirOffset, true);
  ev.setUint16(20, 0, true);            // comment length

  return new Blob([...localParts, ...centralDir, new Uint8Array(eocd)], { type: 'application/zip' });
}

// CRC-32 table (pre-computed for IEEE 802.3 polynomial)
let _crcTable = null;
function _ensureCrcTable() {
  if (_crcTable) return;
  _crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    _crcTable[n] = c;
  }
}

function _crc32(data) {
  _ensureCrcTable();
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = _crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
