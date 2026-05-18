// Takus — Drag & Drop File Handler
// Extracted from app-shell.js for clean separation of concerns.

import { icons } from './icons.js';
import { formatSize } from './recorder.js';
import { notifyEphemeral } from './notification-manager.js';

const VALID_EXTENSIONS = ['webm', 'mp4', 'm4a', 'wav', 'mp3', 'mov'];
const DOC_EXTENSIONS = ['txt', 'md', 'markdown', 'json', 'text', 'html', 'htm', 'csv', 'eml', 'pdf', 'docx'];
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB

/**
 * Install global drag-and-drop file upload handling.
 * @param {object} context
 * @param {object} context.sm           StateMachine instance
 * @param {object} context.States       States enum
 * @param {Function} context.onFileDrop Called with the validated File when user drops a supported file
 */
export function initDragDrop(context) {
  const { sm, States, onFileDrop } = context;

  let dragCounter = 0;
  let overlay = null;

  const showOverlay = () => {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'drop-overlay';
    overlay.innerHTML = `
      <div class="drop-zone">
        ${icons.upload(40)}
        <p>Drop to upload</p>
        <p style="font-size:var(--font-xs);color:var(--color-text-disabled);margin-top:calc(-1 * var(--space-2));">.webm, .mp4, .mov, .m4a, .wav, .mp3, .txt, .md, .pdf, .docx, .html, .csv, .eml · Max 2 GB</p>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay?.classList.add('active'));
  };

  const hideOverlay = () => {
    dragCounter = 0;
    if (!overlay) return;
    overlay.classList.remove('active');
    setTimeout(() => { overlay?.remove(); overlay = null; }, 200);
  };

  document.addEventListener('dragenter', (e) => {
    if (!sm.is(States.IDLE)) return;
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) showOverlay();
  });

  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) hideOverlay();
  });

  document.addEventListener('dragover', (e) => {
    if (!sm.is(States.IDLE)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    hideOverlay();
    if (!sm.is(States.IDLE)) return;

    const file = e.dataTransfer?.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      notifyEphemeral('File too large', 'Maximum upload size is 2 GB.', 'error');
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase();

    // Document files → route to document-adapter for knowledge graph ingestion
    if (DOC_EXTENSIONS.includes(ext)) {
      try {
        const { extractTextFromFile, ingestDocument } = await import('./document-adapter.js');
        const doc = await extractTextFromFile(file);
        const result = await ingestDocument(doc);
        if (result.success) {
          notifyEphemeral('Document imported', `"${file.name}" added to knowledge graph`, 'success');
        } else {
          notifyEphemeral('Import failed', result.error || 'Could not process document', 'error');
        }
      } catch (err) {
        notifyEphemeral('Import failed', err.message || 'Could not process document', 'error');
      }
      return;
    }

    // Media files → entry pipeline
    if (!VALID_EXTENSIONS.includes(ext)) {
      notifyEphemeral('Unsupported format', `Accepted formats: ${[...VALID_EXTENSIONS, ...DOC_EXTENSIONS].join(', ')}`, 'error');
      return;
    }

    notifyEphemeral('File loaded', `Processing "${file.name}" (${formatSize(file.size)})`, 'success');
    onFileDrop(file);
  });
}

