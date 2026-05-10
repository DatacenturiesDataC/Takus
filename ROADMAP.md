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
    storage.js              ← IndexedDB: recordings, settings, crash-recovery
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
    ffmpeg-engine.js        ← FFmpeg WASM (GIF export, video trim)
    icons.js                ← SVG icon helpers
```

### State Machine States

```
idle → requesting_access → previewing → recording → paused
     → reviewing → processing → uploading → complete | upload_failed
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
}
```

**settings** store (keyPath: `key`): arbitrary key-value pairs
**recovery** store (keyPath: `id`): crash-recovery chunks + updatedAt timestamp

---

## What's Already Shipped

- [x] Screen + audio capture (MediaRecorder, display + mic mixing)
- [x] Facecam PiP with draggable fallback overlay
- [x] Recording type picker (Meeting / Screen / Presentation / Update)
- [x] Pre-recording session config (title, participants, type)
- [x] Live stats bar (duration, file size) with recording favicon
- [x] Pause / resume with elapsed-time tracking
- [x] Review panel: video preview, trim (start/end), speed control, loop
- [x] GIF export via FFmpeg WASM (with size warning for long videos)
- [x] Google Drive + OneDrive upload with resumable upload + progress bar
- [x] Google Docs / OneNote export for AI summaries
- [x] Google Calendar + Outlook Calendar integration (auto-fetch attendees)
- [x] AI transcription: OpenAI Whisper (with VTT segments) or Gemini 2.0 Flash
- [x] AI summary: GPT-4o-mini or Gemini 2.0 Flash (type-specific prompts)
- [x] History panel: search (full-text), type filter, summary toggle, VTT download
- [x] Markdown rendering of AI summaries in history
- [x] Share panel: email message + mailto link for participants
- [x] Settings: AI provider/key, recording quality, audio quality, watermark
- [x] Inline title rename (double-click)
- [x] Keyboard shortcuts (Space = pause, S = stop, R/Space = record, , = settings)
- [x] Recording favicon (red dot while recording)
- [x] PWA: installable, offline-capable via service worker
- [x] Crash recovery store (IndexedDB chunks saved during recording)

---

## Feature Backlog (prioritised)

### P1 — High Value, Low Risk

#### Transcript Viewer (inline VTT)
The `aiVtt` field is stored but only downloadable. Add a toggleable transcript tab
inside the AI summary box that parses the VTT and renders clickable timestamp segments.
- Parse `WEBVTT` format into `[{ start, end, text }]` array
- Render as scrollable list: `[00:01:23] segment text`
- "Copy Transcript" already exists — keep it

#### Export as Markdown
Add "Download .md" next to "Copy Summary". Generate:
```markdown
# {title}
_{date} · {duration} · {type}_

## Summary
{aiSummary}

## Transcript
{aiTranscript}
```

#### Improved Markdown Renderer
Current renderer missing:
- Numbered lists (`1. ...`, `2. ...`)
- Inline code (`` `code` ``)
- Bold inside list items already works but nested items are not handled

#### Crash Recovery UI
The recovery store saves recording chunks on every `ondataavailable` event.
On app load, if recovery data exists, show a toast/modal: "You have an unsaved recording. Resume?".
Reconstruct the blob from saved chunks and drop the user into the review panel.

### P2 — Medium Value

#### Re-watch Recordings Locally
Currently the video blob is lost after the review panel closes (only the cloud link survives).
Store the blob in IndexedDB (`recordings` store, add a `blobData: ArrayBuffer` field).
Add a "▶ Watch" button in history that opens a modal with the video player.
- Blob storage is ~50–200 MB per recording; warn user if quota is low
- Auto-purge blobs older than 30 days while keeping metadata

#### Structured AI Output Per Type
Today all types get the same flat markdown summary. Add type-specific structured sections:

- **Meeting**: Decision Ledger table (`| Commitment | Owner | Due |`)
- **Screen**: Bug report card format (steps to reproduce, element, error)
- **Presentation**: Chapter list with timestamps
- **Update**: TL;DR bullets + ticket ID extraction

#### Participant Management Before Recording
"Meeting" type recordings can have participants, but the only way to add them is via
the session-config. Add an "Add participant" inline flow in session-config that
auto-completes from previously seen participants (stored in settings).

#### Waveform Seekbar in Review Panel
The review panel's `<video>` uses the native browser controls.
Replace with a custom seekbar that shows the audio waveform (from `AudioEngine.getFrequencyData`
sampled during recording) so users can visually seek to loud/active sections.

### P3 — Longer Term

#### Full-Text Search with Highlighting
The history search currently filters rows by title/type/summary/transcript.
Make matching text in summaries/transcripts highlight yellow when a search query is active.

#### Bulk Export / ZIP
"Export all" button: generate a ZIP (via native `CompressionStream` API) containing
one `.md` file per recording with summary + transcript.

#### Slack / Notion Integration
For `update` type: after processing, show a "Post to Slack" card that posts the TL;DR
to a configured channel via a Netlify Function proxy (keeps the Slack bot token server-side).

#### Supabase Auth + Cloud Sync
Replace per-device IndexedDB with Supabase (pgvector for RAG search, Realtime for
cross-device sync). Keep Google/MS OAuth as social login providers via Supabase Auth.
This is a significant architectural addition — implement only after P1/P2 are complete.

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
