# Takus — Product Roadmap & Developer Guide

## What Takus Is

A browser-based screen recorder that captures video + audio, then runs it through AI (OpenAI Whisper or Gemini 2.0 Flash) to produce transcripts, summaries, and structured insights. All processing is local-first — the only network calls are to the AI provider and the optional cloud storage destination.

**Tech stack:** Vanilla JS (ES modules, no build tool), PWA with service worker, IndexedDB for persistence, MediaRecorder + Web Audio API for capture.

---

## Current Architecture

```
index.html                  ← app entry point
public/
  sw.js                     ← service worker (offline caching)
  _headers                  ← Netlify security headers
src/
  components/
    app-shell.js            ← top-level orchestrator; state machine, keyboard shortcuts
    header.js               ← logo, cloud provider badge
    hero-section.js         ← landing / idle state
    recorder-panel.js       ← live recording controls (start/pause/resume/stop, stats)
    preview-canvas.js       ← waveform + camera preview before recording starts
    review-panel.js         ← post-recording: video preview, trim, GIF, approve/discard
    upload-progress.js      ← upload progress bar (Google Drive / OneDrive)
    history-panel.js        ← recordings list: search, filter, AI summary, actions
    share-panel.js          ← modal: email summary + transcript to participants
    session-config.js       ← pre-recording title, participants, type selector
    settings-panel.js       ← AI provider + API key, recording quality, watermark
    type-picker.js          ← meeting / screen / presentation / update type cards
    consent-notice.js       ← first-run privacy notice
    toast.js                ← transient notification overlay
  lib/
    recorder.js             ← Recorder class (MediaRecorder wrapper, mic mixing, timer)
    audio-engine.js         ← Web Audio API: mix system + mic, level meter
    facecam.js              ← FacecamManager: PiP webcam + draggable fallback overlay
    ai-engine.js            ← Whisper STT + GPT-4o-mini summary; Gemini 2.0 Flash
    state-machine.js        ← StateMachine class (idle → recording → reviewing → …)
    storage.js              ← IndexedDB: recordings, settings, crash-recovery, blobs
    config.js               ← runtime config (quality presets, Google/MS client IDs)
    cloud-provider.js       ← Google Drive / OneDrive upload abstraction
    google-auth.js          ← Google OAuth + token refresh
    google-drive.js         ← Drive file upload, folder management
    google-calendar.js      ← calendar event fetch (meeting attendees)
    google-docs.js          ← Docs export (AI summary → Google Doc)
    microsoft-auth.js       ← MSAL-based MS OAuth
    microsoft-onedrive.js   ← OneDrive upload
    microsoft-calendar.js   ← Outlook calendar fetch
    microsoft-onenote.js    ← OneNote export
    ffmpeg-engine.js        ← FFmpeg WASM (GIF export, video trim, watermark)
    icons.js                ← SVG icon helpers
```

### State Machine States

```
idle → requesting_access → previewing → recording → paused
     → reviewing → processing → uploading → complete | upload_failed
idle → reviewing  (crash-recovery resume path)
```

### IndexedDB Schema (DB: `takus`, version 1)

**recordings** store (keyPath: `id`, index: `date`):
```js
{
  id: string,           // crypto.randomUUID()
  title: string,
  date: string,         // ISO timestamp
  duration: number,     // ms
  size: number,         // bytes
  type: 'meeting' | 'screen' | 'presentation' | 'update',
  device: string,       // navigator.platform
  aiProvider: 'openai' | 'gemini',
  aiSummary: string,    // markdown
  aiTranscript: string, // plain text
  aiVtt: string,        // WebVTT format (null for Gemini)
  aiDocLink: string,    // Google Docs / OneNote URL
  driveLink: string,    // Google Drive / OneDrive URL
  participants: [{ name, email }],
  blobData: ArrayBuffer, // stored separately via saveRecordingBlob()
}
```

**settings** store (keyPath: `key`): arbitrary key-value pairs
**recovery** store (keyPath: `id`): crash-recovery chunks + updatedAt timestamp

---

## What's Already Shipped

### Core Recording
- [x] Screen + audio capture (MediaRecorder, display + mic mixing)
- [x] Facecam PiP with draggable fallback overlay
- [x] Recording type picker (Meeting / Screen / Presentation / Status Update)
- [x] Pre-recording session config (title, camera, mic device selection, mic level test)
- [x] Live stats bar (duration, file size) with recording favicon
- [x] Pause / resume with elapsed-time tracking
- [x] 60-minute hard limit with 10-minute warning toast
- [x] Keyboard shortcuts (Space = pause, S = stop, R/Space = record, , = settings)
- [x] 3-2-1 countdown before recording starts

### Review & Export
- [x] Review panel: video preview, trim (start/end), speed control (0.5×–2×), loop
- [x] GIF export via FFmpeg WASM (with size warning for long videos)
- [x] Watermark overlay (drawtext via FFmpeg, configurable text)
- [x] Local blob storage so users can re-watch without cloud

### Cloud & AI
- [x] Google Drive + OneDrive upload with resumable upload + progress bar
- [x] Google Docs / OneNote export for AI summaries
- [x] Google Calendar + Outlook Calendar integration (auto-fetch attendees)
- [x] AI transcription: OpenAI Whisper (with VTT segments) or Gemini 2.0 Flash
- [x] AI summary: GPT-4o-mini or Gemini 2.0 Flash (type-specific structured prompts)
  - Meeting: Summary, Action Items, Key Decisions, **Decision Ledger table**, Sentiment
  - Screen: Overview, Key Steps, **Bug Report card**, Technical Notes
  - Presentation: Summary, Key Points, **Chapter List with timestamps**, Audience Takeaways
  - Status Update: **TL;DR bullets, Ticket References, Blockers, Next Steps**

### History & Sharing
- [x] History panel: search (full-text + highlight), type filter chips, summary toggle
- [x] AI summary tab / transcript tab — state preserved across search/filter re-renders
- [x] Inline VTT transcript viewer with clickable timestamp segments
- [x] Markdown rendering of AI summaries (bold, italic, headers, lists, inline code)
- [x] Copy transcript, Download VTT, Download .md, Copy link
- [x] Re-watch recordings locally (IndexedDB blob storage + modal player)
- [x] Inline title rename (double-click)
- [x] Share panel: email message + mailto link for participants; Select All/None available for 2+ participants
- [x] Full-text search with yellow highlight on matched text

### Infrastructure
- [x] PWA: installable, offline-capable via service worker
- [x] Crash recovery store (IndexedDB chunks saved every 10 s during recording)
- [x] Crash recovery UI: banner with Resume (→ review panel), Download, Discard
- [x] Settings: AI provider/key, recording quality, audio quality, watermark, auto-copy link
- [x] Keyboard shortcut customisation in Settings
- [x] Consent notice (first-run privacy notice)

---

## Feature Backlog (prioritised)

### P2 — Medium Value (not yet started)

#### Participant Management Before Recording
"Meeting" type recordings can have participants, but the only way to add them is via
the session-config. Add an "Add participant" inline flow in session-config that
auto-completes from previously seen participants (stored in settings).

#### Waveform Seekbar in Review Panel
The review panel's `<video>` uses the native browser controls.
Replace with a custom seekbar that shows the audio waveform (from `AudioEngine.getFrequencyData`
sampled during recording) so users can visually seek to loud/active sections.

#### Structured AI Output — Gemini Parity
The OpenAI flow requests structured sections (Decision Ledger, Bug Report card, etc.) and
these appear consistently. The Gemini flow is a single combined prompt; verify that Gemini 2.0
Flash reliably returns the same sections with the same markdown structure, and add a validation
pass that retries or falls back if sections are missing.

### P3 — Longer Term

#### Bulk Export / ZIP
"Export all" button: generate a ZIP (via native `CompressionStream` API) containing
one `.md` file per recording with summary + transcript.

#### Slack / Notion Integration
For `update` type: after processing, show a "Post to Slack" card that posts the TL;DR
to a configured channel via a Netlify Function proxy (keeps the Slack bot token server-side).

#### Supabase Auth + Cloud Sync
Replace per-device IndexedDB with Supabase (pgvector for RAG search, Realtime for
cross-device sync). Keep Google/MS OAuth as social login providers via Supabase Auth.
This is a significant architectural addition — implement only after P2 are complete.

---

## Known Limitations

- **Gemini transcript extraction**: If Gemini omits `<transcript>` XML tags (rare), the stored transcript is empty and only the summary is saved. The summary still contains the full analysis.
- **Blob quota**: Video blobs are stored in IndexedDB; browsers typically allow 50–80 % of available disk space. Large or many recordings may approach quota limits. No auto-purge is implemented yet.
- **Watermark font**: Requires a network fetch of Roboto.ttf on first use. If the CDN is unreachable, watermarking is skipped with a toast notification.
- **FFmpeg WASM cold start**: First FFmpeg operation (trim, GIF, watermark) takes 2–5 s to load the WASM binary. Subsequent operations reuse the loaded instance.

---

## Code Conventions

- No build tool — all JS is native ES modules loaded via `<script type="module">`
- No TypeScript — use JSDoc `@param` / `@returns` comments where non-obvious
- No framework — DOM manipulation via `innerHTML` for full re-renders, direct event listeners for interactions
- CSS variables defined in `src/styles/variables.css`; component styles in `src/styles/components.css`
- Security: all user content passed through `esc()` before `innerHTML`; no `eval()`, no external scripts beyond Google/MS OAuth SDKs
- Prefer editing a single file per feature; avoid cross-cutting changes

## Naming Conventions
- `render*` functions: rebuild a container's `innerHTML` from scratch
- `update*` functions: mutate specific DOM nodes without a full re-render
- `_private` prefix: internal helpers not exported from the module
- Event delegation via `container.querySelector()` after `innerHTML` assignment
