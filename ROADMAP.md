# Takus — Product Roadmap & Developer Guide

## Vision: Agentic Knowledge Operating System

Takus is a **local-first, AI-agent-led platform that captures workplace intent**. It moves beyond the commodity of "screen recording" to provide **Knowledge Transformation** — turning every recording into a structured, searchable, and actionable asset.

> **"Make the video unnecessary for the viewer."**

The platform is built on four pillars:

| Pillar | Role | Time Axis |
|--------|------|-----------|
| **Record** | Ingestion engine — context-aware capture with specialist agents | Present |
| **Ask** | Knowledge base — Video-RAG semantic search across all recordings | Past |
| **Tasks** | Execution layer — AI-extracted tasks with contextual video clips | Future |
| **Connect** | Ecosystem — bi-directional sync with Jira, Slack, Notion, GitHub | World |

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
    recorder-panel.js       ← live recording controls (start/pause/resume/stop, stats)
    preview-canvas.js       ← waveform + camera preview
    review-panel.js         ← post-recording: video preview, trim, GIF, approve/discard
    upload-progress.js      ← upload progress bar (Google Drive / OneDrive)
    history-panel.js        ← recordings list: search, filter, AI summary, tasks
    tasks-panel.js          ← [Phase 1] Tasks for Takus / Tasks for Me dual pane
    share-panel.js          ← modal: email summary + transcript to participants
    session-config.js       ← pre-recording title, camera, mic device selection
    settings-panel.js       ← AI provider + API key, recording quality, watermark
    type-picker.js          ← meeting / screen / presentation / update type cards
    consent-notice.js       ← first-run privacy notice
    toast.js                ← transient notification overlay
  lib/
    recorder.js             ← Recorder class (MediaRecorder wrapper, mic mixing, timer)
    audio-engine.js         ← Web Audio API: mix system + mic, level meter
    facecam.js              ← FacecamManager: PiP webcam + draggable fallback overlay
    observer.js             ← [Phase 1] Console sniffer, action log, DOM pulse
    ai-engine.js            ← Whisper STT + GPT-4o-mini; Gemini 2.0 Flash; task extraction
    state-machine.js        ← StateMachine class
    storage.js              ← IndexedDB: recordings, settings, crash-recovery, blobs
    config.js               ← runtime config (quality presets, OAuth client IDs)
    cloud-provider.js       ← Google Drive / OneDrive upload abstraction
    google-auth.js / google-drive.js / google-calendar.js / google-docs.js
    microsoft-auth.js / microsoft-onedrive.js / microsoft-calendar.js / microsoft-onenote.js
    ffmpeg-engine.js        ← FFmpeg WASM (GIF export, video trim, watermark)
    icons.js                ← SVG icon helpers
```

### State Machine States

```
idle → requesting_access → previewing → recording → paused
     → reviewing → processing → uploading → complete | upload_failed
idle → reviewing  (crash-recovery resume path)
```

### IndexedDB Schema (DB: `takus`, version 3)

**recordings** store (keyPath: `id`, index: `date`):
```js
{
  id, title, date, duration, size,
  type: 'meeting' | 'screen' | 'presentation' | 'update',
  device, aiProvider,
  aiSummary,       // markdown
  aiTranscript,    // plain text
  aiVtt,           // WebVTT (OpenAI path only)
  aiDocLink,       // Google Docs / OneNote URL
  driveLink,       // Google Drive / OneDrive URL
  participants,    // [{ name, email }]
  tasks,           // [{ id, type, action, payload, contextTimestamp, done }]  ← Phase 1
  observerLog,     // { consoleErrors, networkErrors, actions }                ← Phase 1
}
```

**settings** store (keyPath: `key`): arbitrary key-value pairs
**recovery** store (keyPath: `id`): crash-recovery chunks + updatedAt timestamp
**embeddings** store v3 (keyPath: `recordingId`): `{ recordingId, chunks: [{text, start, end, chunkIdx, embedding: number[]}] }`  ← Phase 2
**wiki** store v3 (keyPath: `id`, index: `date`): `{ id, date, query, answer, sources: [{recordingId, title}] }`  ← Phase 2

---

## What's Already Shipped (Phase 0 — Foundation ✅)

### Core Recording
- [x] Screen + audio capture (MediaRecorder, display + mic mixing)
- [x] Facecam PiP with draggable fallback overlay
- [x] Recording type picker (Meeting / Screen / Presentation / Status Update)
- [x] Pre-recording session config (title, camera, mic device, mic level test)
- [x] Live stats bar (duration, file size) with recording favicon
- [x] Pause / resume with elapsed-time tracking
- [x] 60-minute hard limit with 10-minute warning toast
- [x] Keyboard shortcuts (configurable; default: Space, S, R, ,)
- [x] 3-2-1 countdown before recording starts

### Review & Export
- [x] Review panel: video preview, trim (start/end), speed control, loop
- [x] GIF export via FFmpeg WASM
- [x] Watermark overlay (configurable text, FFmpeg drawtext)
- [x] Local blob storage (re-watch without cloud)

### AI Summaries (Structured per Type)
- [x] OpenAI Whisper transcription → GPT-4o-mini summary
- [x] Gemini 2.0 Flash transcription + summary
- [x] Meeting → Summary, Action Items, Key Decisions, Decision Ledger table, Sentiment
- [x] Screen → Overview, Key Steps, Bug Report card, Technical Notes
- [x] Presentation → Summary, Key Points, Chapter List with timestamps, Audience Takeaways
- [x] Status Update → TL;DR bullets, Ticket References, Blockers, Next Steps

### Cloud & Integrations
- [x] Google Drive + OneDrive resumable upload with progress bar
- [x] Google Docs / OneNote export for AI summaries
- [x] Google Calendar + Outlook Calendar (auto-fetch attendees)

### History & Sharing
- [x] Full-text search with yellow highlight
- [x] Type filter chips
- [x] AI summary tab / transcript tab (state preserved across search re-renders)
- [x] Inline VTT transcript viewer with clickable timestamps
- [x] Markdown rendering (bold, italic, headers, lists, inline code, tables)
- [x] Copy transcript, Download VTT, Download .md, Copy link
- [x] Re-watch recordings locally (modal player)
- [x] Inline title rename (double-click)
- [x] Share panel: email/mailto for participants; Select All/None for 2+

### Infrastructure
- [x] PWA: installable, offline-capable service worker
- [x] Crash recovery (IndexedDB chunks every 10 s) + Resume → review panel
- [x] Settings: AI provider/key, recording quality, audio quality, watermark, shortcuts

---

## Phase 1 — The Scribe (Record-to-Task Pipeline) ✅ Shipped

**Goal:** Deliver immediate, tangible value from every recording by extracting actionable tasks automatically — no user effort required after hitting Stop.

### 1a. Observer Module (`src/lib/observer.js`)
Runs silently during any recording session. Captures three data channels:

| Channel | What it captures | Used by |
|---------|-----------------|---------|
| **Console Sniffer** | `console.error`, `console.warn`, uncaught exceptions, 4xx/5xx XHR/fetch responses | Screen agent |
| **Action Log** | `click`, `input`, `scroll`, `keydown` (key only, not value), `navigation` events with timestamps | All agents |
| **Network Sniffer** | Intercepts `fetch` / `XMLHttpRequest` for failed status codes; logs url + status + timestamp | Screen agent |

Privacy: input field _values_ are never logged. Only element selectors and event types.

### 1b. Task Extraction (`src/lib/ai-engine.js`)
New function `extractTasks(transcript, observerLog, type, apiKey, provider)`:

**Output schema:**
```js
{
  takusTasks: [
    { id, action, payload, contextTimestamp, done: false }
    // actions: CREATE_JIRA_TICKET | DRAFT_SLACK_MESSAGE | CREATE_CALENDAR_EVENT | OPEN_PR | LOG_DECISION
  ],
  meTasks: [
    { id, note, contextTimestamp, done: false }
    // extracted from verbal commitments: "I will…", "I'll…", "We need to…"
  ]
}
```

- Meeting → extracts commitments, delegate items, unresolved conflicts
- Screen → extracts bug report tasks with console error context
- Presentation → extracts follow-up actions mentioned by presenter
- Status Update → extracts ticket references and blocker escalations

### 1c. Tasks Panel UI (`src/components/tasks-panel.js`)
Dual-pane component rendered in the history item expansion (alongside AI Summary / Transcript tabs):

- **Tasks for Takus** pane: automated workflow suggestions (draft Jira ticket, post to Slack, create calendar event) — each with a one-click action button and a 5-second context clip timestamp
- **Tasks for Me** pane: personal follow-ups extracted from speech — each with a checkbox, note, and timestamp link
- Task completion state persisted to IndexedDB via `saveRecording()`

### 1d. History Integration
- "Tasks" tab added to AI summary box (alongside Summary / Transcript)
- Task badge on history item row showing count of open tasks
- Completed tasks shown with strikethrough; completion persisted

---

## Phase 2 — Ask (Video-RAG Knowledge Base) 🔨 In Progress

**Goal:** Let users ask natural language questions across all their recordings and get timestamped answers, not another search results list.

### Shipped in Phase 2

- [x] **`src/lib/embeddings.js`** — `chunkTranscript()` (400-char overlapping chunks), `embedTranscript()` (batch API calls), `cosineSimilarity()`, `semanticSearch()` (top-k retrieval)
- [x] **Embedding generation** — called after every AI transcription; persisted to `IndexedDB:embeddings` store (DB v3); silently skipped on API error
- [x] **`src/lib/ai-engine.js`** — `generateAnswer()`: RAG prompt → GPT-4o-mini / Gemini 2.0 Flash; cites `[Source N]` in reply
- [x] **`src/components/ask-panel.js`** — Ask bar with placeholder showing embedding availability, loading dots, answer card, source chips, "Save to Wiki" button
- [x] **Living Wiki** — Saved Q&A entries stored in `IndexedDB:wiki`; shown below Ask bar as clickable re-run chips; individually deletable
- [x] **Cmd+K shortcut** — focuses Ask input from anywhere in the idle state
- [x] **Recording delete** — also removes associated embeddings from IndexedDB
- [x] **Clear all** — wipes embeddings + wiki alongside recordings

### Providers
- OpenAI: `text-embedding-3-small` (1536-dim, batch input)
- Gemini: `text-embedding-004` (768-dim, one-per-request)

### Scoping Constraints
- Personal (single-device) RAG: IndexedDB vectors, no backend required
- Team RAG (future): Netlify Blobs + Netlify Functions for shared vector index
- Timestamp linking to exact video position: deferred to Phase 2.1 (requires VTT-to-chunk offset mapping)

---

## Phase 3 — Connect (Ecosystem Integrations) 🔨 In Progress

**Goal:** Make Takus a bi-directional hub, not a dead end. Every task can be routed to where work actually happens.

### Shipped in Phase 3

- [x] **`src/lib/identity-vault.js`** — AES-GCM 256-bit encryption via SubtleCrypto; auto-generated `CryptoKey` stored in IndexedDB with `extractable:false`; `saveCredential/loadCredential/clearCredential` API
- [x] **`src/lib/integrations/slack.js`** — `postToSlack(webhookUrl, payload)` via Incoming Webhook (CORS-supported); `buildSlackPayload(task, recording)` with Block Kit formatting
- [x] **`src/lib/integrations/github.js`** — `createGitHubIssue(token, owner, repo, issue)` via GitHub REST API; `verifyGitHubToken()`; `buildGitHubIssuePayload(task, recording)` with bug-report markdown
- [x] **`src/lib/integrations/linear.js`** — `createLinearIssue(apiKey, teamId, issue)` via Linear GraphQL; `verifyLinearKey()`; `fetchLinearTeams()`; `buildLinearIssuePayload()` with priority mapping
- [x] **`src/components/connect-panel.js`** — `openConnectModal()`: integration cards for Slack, GitHub, Linear; per-card status badge, inline config form, Test and Save buttons, Disconnect; accessible from Settings → Connect
- [x] **Tasks panel routing** — "Run" button dispatches to configured integration; falls back to clipboard + "Open Settings → Connect" toast hint; loading spinner on btn during async call
- [x] **Settings modal** — "Connect integrations" section at bottom with arrow button to open Connect modal
- [x] **New icons** — `plug`, `chevronDown`

### Task → Integration routing
| Task action | Primary | Fallback |
|---|---|---|
| `DRAFT_SLACK_MESSAGE` / `DRAFT_SHARE_MESSAGE` | Slack Incoming Webhook | Clipboard copy |
| `CREATE_BUG_REPORT` | GitHub Issues (then Linear) | Clipboard copy |
| `UPDATE_TICKET` | Linear issue | Clipboard copy |
| `LOG_DECISION` | Clipboard (Notion deferred) | — |
| `CREATE_CALENDAR_EVENT` | Google Calendar URL | — |

### What's browser-accessible without a proxy
- ✅ Slack Incoming Webhooks (CORS-enabled)
- ✅ GitHub REST API v3 (CORS + PAT)
- ✅ Linear GraphQL API (CORS + API key)
- ❌ Jira Cloud (CORS-blocked — needs Netlify Function proxy, deferred to Phase 4)
- ❌ Notion (CORS-blocked — deferred)

### Netlify Build Plugin — deferred to Phase 4
- "Inject Takus" toggle for Netlify-deployed sites
- Feedback recordings routed to site owner's workspace

---

## Phase 4 — Advanced Specialist Agents 📋 Future

These features require Netlify Functions + AI Gateway infrastructure and are intentionally deferred until Phases 1–3 are stable.

### Meeting Agent: Semantic Diarization
- Speaker attribution using calendar invite cross-reference
- Face-to-voice mapping (local visual inference via WebLLM)
- Verbal signifier detection: "I will…" → Me Task; "We decided…" → Decision Ledger; "Can you…" → Delegate Task
- Conflict detection: surface when a new decision contradicts a past recording's Decision Ledger

### Screen Agent: Rehydratable Bug Reports
- Full DOM/AOM snapshots (not just event log) serialised to Netlify Blobs
- "Open in DevTools" button in Jira tasks: loads headless browser with exact DOM state at the moment of the error
- WebGPU / WebLLM local PII redaction: blur password/token fields in the video buffer before upload

### Presentation Agent: Ghost Producer
- Gaze correction via lightweight browser-based face model
- Auto-chaptering using OCR on slide transitions (Tesseract.js or Gemini multimodal)
- Smart camera bubble repositioning when content is detected beneath it
- Filler word detection + one-click audio polish (silence/filler removal via FFmpeg)

### Updates Agent: AI-Voiced Recap
- 15-second AI audio abstract cloned from the user's voice (Lyria model)
- TL;DW overlay: 3 bullet points on the video thumbnail before playback
- Urgency detection: "Blocked" / "Critical" flags routed with priority markers
- Automatic Slack/Jira routing based on project context detected from screen

---

## Known Limitations

- **Gemini transcript tags:** If Gemini omits `<transcript>` XML tags, stored transcript is empty; summary is unaffected.
- **Blob quota:** IndexedDB video blobs may fill available disk on devices with many recordings. No auto-purge yet.
- **Watermark font:** Requires network fetch of Roboto.ttf on first use; skipped with toast if CDN unreachable.
- **FFmpeg cold start:** First WASM operation takes 2–5 s. Subsequent operations reuse the loaded instance.
- **Observer scope (Phase 1):** The Observer only captures events from the recording tab's own JS context. Cross-origin iframes and browser extensions are not observable.

---

## Code Conventions

- No build tool — native ES modules via `<script type="module">`
- No TypeScript — JSDoc `@param` / `@returns` where non-obvious
- No framework — `innerHTML` for full re-renders, direct event listeners for interactions
- CSS variables in `src/styles/variables.css`; component styles in `src/styles/components.css`
- Security: all user content through `esc()` before `innerHTML`; no `eval()`, no external scripts beyond OAuth SDKs
- Prefer single-file changes per feature

## Naming Conventions
- `render*` — rebuild a container's `innerHTML` from scratch
- `update*` — mutate specific DOM nodes without a full re-render
- `_private` — internal helpers not exported from the module
- Event delegation via `container.querySelector()` after `innerHTML` assignment
