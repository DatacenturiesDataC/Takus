// Takus — Archive Player (Phase 11c: PLAYBACK)
//
// Lightweight replay experience for archived entries (no video blob).
// Synchronises audio + key frame slideshow + transcript highlighting.

import { icons } from '../lib/icons.js';
import { esc, parseVTT, fmtTimestamp } from '../lib/utils.js';

/**
 * Open the archive replay modal.
 *
 * @param {object} entry - Recording entry (must have aiVtt or textContent)
 * @param {object} [options]
 * @param {Blob}   [options.audioBlob]  - Extracted audio (mp3) if available
 * @param {Array<{timestamp: number, blob: Blob}>} [options.frames] - Key frames
 */
export function openArchivePlayer(entry, options = {}) {
  const { audioBlob = null, frames = [] } = options;
  const segments = entry.aiVtt ? parseVTT(entry.aiVtt) : [];
  const hasAudio = !!audioBlob;
  const hasFrames = frames.length > 0;
  const hasTranscript = segments.length > 0;

  if (!hasAudio && !hasTranscript) {
    // Nothing to replay — just show the summary
    return;
  }

  document.getElementById('archive-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'archive-overlay';
  overlay.className = 'overlay-backdrop';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  const title = entry.title || 'Archived Recording';
  overlay.setAttribute('aria-label', `Archive replay: ${title}`);

  // Pre-create frame URLs
  const frameUrls = frames.map(f => ({
    url: URL.createObjectURL(f.blob),
    timestamp: f.timestamp,
  }));

  const audioUrl = hasAudio ? URL.createObjectURL(audioBlob) : null;

  const frameHtml = hasFrames
    ? `<div class="archive-frame-container">
        <img id="archive-frame-img" src="${frameUrls[0]?.url || ''}" alt="Key frame" class="archive-frame-img" />
        <div class="archive-frame-counter" id="archive-frame-counter">1 / ${frames.length}</div>
      </div>`
    : `<div class="archive-frame-container archive-frame-placeholder">
        <div class="flex-col items-center gap-2" style="color:rgba(255,255,255,0.3);">
          ${icons.video(40)}
          <span class="text-xs">No key frames available</span>
        </div>
      </div>`;

  const audioHtml = hasAudio
    ? `<audio id="archive-audio" src="${audioUrl}" controls style="width:100%;height:40px;border-radius:var(--radius-md);"></audio>`
    : `<div class="text-center text-xs" style="color:rgba(255,255,255,0.3);padding:var(--space-2);">No audio available</div>`;

  const transcriptHtml = hasTranscript
    ? `<div class="watch-transcript-panel" style="width:100%;max-height:none;border-left:none;border-top:1px solid rgba(255,255,255,0.08);">
        <div class="watch-transcript-header">
          <span class="watch-transcript-title">Transcript</span>
          <input type="text" class="watch-transcript-search" placeholder="Search transcript…" autocomplete="off" />
        </div>
        <div class="watch-transcript-list" id="archive-tlist" style="max-height:240px;">
          ${segments.map((seg, i) => `
            <div class="transcript-row" data-idx="${i}" data-start="${seg.start}" data-end="${seg.end}">
              <span class="transcript-ts">${fmtTimestamp(Math.floor(seg.start))}</span>
              <span class="transcript-text">${esc(seg.text)}</span>
            </div>`).join('')}
        </div>
      </div>`
    : '';

  overlay.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--space-2);width:100%;max-width:720px;">
      <div class="flex-between gap-3">
        <div class="flex-center gap-2">
          <span class="font-semi truncate" style="color:#fff;font-size:var(--font-sm);">${esc(entry.title || 'Archived Recording')}</span>
          <span class="badge-tag" style="color:rgba(139,92,246,0.8);background:rgba(139,92,246,0.15);">ARCHIVED</span>
        </div>
        <button id="archive-close" class="overlay-close" title="Close (Esc)">✕</button>
      </div>
      ${frameHtml}
      ${audioHtml}
      ${transcriptHtml}
      <p class="overlay-hint">Condensed replay — <kbd>Esc</kbd> to close</p>
    </div>
  `;
  document.body.appendChild(overlay);

  const audio = overlay.querySelector('#archive-audio');
  const frameImg = overlay.querySelector('#archive-frame-img');
  const frameCounter = overlay.querySelector('#archive-frame-counter');

  // ── Frame sync with audio ────────────────────────────────────────────
  if (hasAudio && hasFrames && audio && frameImg) {
    let currentFrameIdx = 0;
    audio.addEventListener('timeupdate', () => {
      const t = audio.currentTime;
      // Find the latest frame whose timestamp is <= current audio time
      let bestIdx = 0;
      for (let i = 0; i < frameUrls.length; i++) {
        if (frameUrls[i].timestamp <= t) bestIdx = i;
        else break;
      }
      if (bestIdx !== currentFrameIdx) {
        currentFrameIdx = bestIdx;
        frameImg.src = frameUrls[currentFrameIdx].url;
        if (frameCounter) frameCounter.textContent = `${currentFrameIdx + 1} / ${frames.length}`;
      }
    });
  }

  // ── Synced Transcript ────────────────────────────────────────────────
  if (hasTranscript) {
    const rows = overlay.querySelectorAll('.transcript-row');
    const searchInput = overlay.querySelector('.watch-transcript-search');
    let activeIdx = -1;
    let searchQuery = '';

    // Click-to-seek (audio)
    rows.forEach(row => {
      row.addEventListener('click', () => {
        if (audio) {
          audio.currentTime = Number(row.dataset.start);
          audio.play();
        }
      });
    });

    // Live highlight
    if (audio) {
      audio.addEventListener('timeupdate', () => {
        const t = audio.currentTime;
        let newIdx = -1;
        for (let i = 0; i < segments.length; i++) {
          if (t >= segments[i].start && t < segments[i].end) { newIdx = i; break; }
        }
        if (newIdx === -1) {
          for (let i = segments.length - 1; i >= 0; i--) {
            if (t >= segments[i].start) { newIdx = i; break; }
          }
        }
        if (newIdx !== activeIdx) {
          if (activeIdx >= 0 && rows[activeIdx]) rows[activeIdx].classList.remove('transcript-active');
          activeIdx = newIdx;
          if (activeIdx >= 0 && rows[activeIdx]) {
            rows[activeIdx].classList.add('transcript-active');
            if (!searchQuery) rows[activeIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      });
    }

    // Search
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value.trim().toLowerCase();
        rows.forEach(row => {
          const textSpan = row.querySelector('.transcript-text');
          const segIdx = Number(row.dataset.idx);
          const originalText = segments[segIdx].text;
          if (!searchQuery) {
            row.style.display = '';
            row.classList.remove('transcript-match');
            textSpan.innerHTML = esc(originalText);
            return;
          }
          if (originalText.toLowerCase().includes(searchQuery)) {
            row.style.display = '';
            row.classList.add('transcript-match');
            const escaped = esc(originalText);
            const eq = esc(searchQuery).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            textSpan.innerHTML = escaped.replace(new RegExp(eq, 'gi'), m => `<mark>${m}</mark>`);
          } else {
            row.style.display = 'none';
            row.classList.remove('transcript-match');
          }
        });
      });
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────
  const onEsc = (e) => { if (e.key === 'Escape') cleanup(); };
  const cleanup = () => {
    overlay.remove();
    frameUrls.forEach(f => URL.revokeObjectURL(f.url));
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    document.removeEventListener('keydown', onEsc);
  };
  overlay.querySelector('#archive-close').addEventListener('click', cleanup);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
  document.addEventListener('keydown', onEsc);
}

