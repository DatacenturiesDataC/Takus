// Takus — Watch Modal (extracted from history-panel.js)
// Full-screen video player with chapter navigation, synced transcript,
// transcript search, and keyboard controls.

import { esc, parseVTT, fmtTimestamp } from '../lib/utils.js';

/**
 * Show a full-screen watch modal for a entry.
 *
 * @param {Blob}     blob         Video blob
 * @param {string}   title        Entry title
 * @param {Array}    chapters     Array of { title, seconds } objects
 * @param {number|null} startTime  Optional start timestamp in seconds
 * @param {string|null} vttString  Optional VTT subtitle content
 */
export function showWatchModal(blob, title, chapters = [], startTime = null, vttString = null) {
  document.getElementById('watch-overlay')?.remove();

  const url = URL.createObjectURL(blob);
  const segments = vttString ? parseVTT(vttString) : [];
  const hasTranscript = segments.length > 0;
  const overlay = document.createElement('div');
  overlay.id = 'watch-overlay';
  overlay.className = 'overlay-backdrop';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Watch: ${title}`);

  const chaptersHtml = chapters.length
    ? `<div class="watch-chapters">
        ${chapters.map((c, i) => `
          <button class="watch-chapter-btn" data-seconds="${c.seconds}" title="Jump to ${fmtTimestamp(c.seconds)}">
            <span class="watch-chapter-index">${i + 1}</span>
            <span class="watch-chapter-title">${esc(c.title)}</span>
            <span class="watch-chapter-time">${fmtTimestamp(c.seconds)}</span>
          </button>`).join('')}
      </div>`
    : '';

  const transcriptPanelHtml = hasTranscript
    ? `<div class="watch-transcript-panel">
        <div class="watch-transcript-header">
          <span class="watch-transcript-title">Transcript</span>
          <input type="text" class="watch-transcript-search" aria-label="Search transcript" placeholder="Search transcript…" autocomplete="off" />
        </div>
        <div class="watch-transcript-list" id="watch-tlist" aria-live="polite">
          ${segments.map((seg, i) => `
            <div class="transcript-row" data-idx="${i}" data-start="${seg.start}" data-end="${seg.end}">
              <span class="transcript-ts">${fmtTimestamp(Math.floor(seg.start))}</span>
              <span class="transcript-text">${esc(seg.text)}</span>
            </div>`).join('')}
        </div>
      </div>`
    : '';

  overlay.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--space-2);width:100%;max-width:${hasTranscript ? '1200px' : '960px'};">
      <div class="flex-between gap-3">
        <span class="font-semi truncate" style="color:#fff;font-size:var(--font-sm);">${esc(title)}</span>
        <button id="watch-close" class="overlay-close" title="Close (Esc)">✕</button>
      </div>
      <div class="watch-layout">
        <div class="watch-video-col">
          <video id="watch-video" src="${url}" controls autoplay></video>
          ${chaptersHtml}
        </div>
        ${transcriptPanelHtml}
      </div>
      <p class="overlay-hint">Click outside or press <kbd>Esc</kbd> to close</p>
    </div>
  `;
  document.body.appendChild(overlay);

  const video = overlay.querySelector('#watch-video');

  // Jump to start time if provided
  if (startTime !== null && startTime > 0) {
    video.addEventListener('loadedmetadata', () => { video.currentTime = startTime; }, { once: true });
  }

  // Chapter buttons
  overlay.querySelectorAll('.watch-chapter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      video.currentTime = Number(btn.dataset.seconds);
      video.play();
      overlay.querySelectorAll('.watch-chapter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ── Synced Transcript ──────────────────────────────────────────────────
  if (hasTranscript) {
    const tList = overlay.querySelector('#watch-tlist');
    const searchInput = overlay.querySelector('.watch-transcript-search');
    const rows = overlay.querySelectorAll('.transcript-row');
    let activeIdx = -1;
    let searchQuery = '';

    // Click-to-seek
    rows.forEach(row => {
      row.addEventListener('click', () => {
        video.currentTime = Number(row.dataset.start);
        video.play();
      });
    });

    // Live highlight on timeupdate (debounced via rAF)
    let _rafId = null;
    video.addEventListener('timeupdate', () => {
      if (_rafId) return;
      _rafId = requestAnimationFrame(() => {
        _rafId = null;
        const t = video.currentTime;
        let newIdx = -1;
        for (let i = 0; i < segments.length; i++) {
          if (t >= segments[i].start && t < segments[i].end) { newIdx = i; break; }
        }
        // Fallback: find the last segment that started before current time
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
            if (!searchQuery) {
              rows[activeIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
          }
        }
      });
    });

    // Store rAF ID for cleanup
    overlay._rafId = () => { if (_rafId) cancelAnimationFrame(_rafId); };

    // Search within transcript
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

        const lowerText = originalText.toLowerCase();
        if (lowerText.includes(searchQuery)) {
          row.style.display = '';
          row.classList.add('transcript-match');
          const escaped = esc(originalText);
          const escapedQuery = esc(searchQuery).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          textSpan.innerHTML = escaped.replace(
            new RegExp(escapedQuery, 'gi'),
            m => `<mark>${m}</mark>`
          );
        } else {
          row.style.display = 'none';
          row.classList.remove('transcript-match');
        }
      });
    });

    // If startTime provided, scroll to that segment on open
    if (startTime !== null && startTime > 0) {
      requestAnimationFrame(() => {
        for (let i = 0; i < segments.length; i++) {
          if (startTime >= segments[i].start && startTime < segments[i].end) {
            rows[i]?.classList.add('transcript-active');
            rows[i]?.scrollIntoView({ block: 'center' });
            activeIdx = i;
            break;
          }
        }
      });
    }
  }

  // Cleanup
  const onEsc = (e) => { if (e.key === 'Escape') cleanup(); };
  const cleanup = () => {
    if (overlay._rafId) overlay._rafId(); // Cancel any pending rAF
    overlay.remove();
    URL.revokeObjectURL(url);
    document.removeEventListener('keydown', onEsc);
  };
  overlay.querySelector('#watch-close').addEventListener('click', cleanup);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
  document.addEventListener('keydown', onEsc);

  // Focus management — move focus into the modal
  requestAnimationFrame(() => {
    overlay.querySelector('#watch-close')?.focus();
  });
}

