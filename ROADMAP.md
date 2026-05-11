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
  analytics,       // { fillerWords: {total,perMinute,breakdown,rating}, score: {score,label,color} } ← Phase 4a
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

## Phase 2 — Ask (Video-RAG Knowledge Base) ✅ Shipped

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

## Phase 3 — Connect (Ecosystem Integrations) ✅ Shipped

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

## Phase 4a — Browser-Achievable Specialist Agents ✅ Shipped

Pure browser-side analytics and routing. Zero additional network cost; runs locally after AI processing.

### Shipped in Phase 4a

- ✅ **Filler-word analyser** (`src/lib/analytics.js`) — 12 regex patterns, per-minute rate, `excellent/good/fair/needs_work` rating
- ✅ **Quality score** (0–100) — weighted from AI summary presence, task density, decision count, filler density
- ✅ **TL;DW strip** — up to 3 top-level bullets from AI summary shown inline in history cards
- ✅ **Chapter navigation** — `parseChapters()` reads `[~MM:SS]` markers from presentation summaries; watch modal renders seekable chapter buttons
- ✅ **Urgency auto-route** — `isUrgentUpdate()` detects P0/blocker/critical signals; auto-posts to Slack for `update`-type recordings
- ✅ **Quality + filler badges** in history card meta tags
- ✅ **Analytics wired into `_processAI`** — stored on `historyEntry.analytics` after every transcription

### Phase 4b — Deferred (requires Netlify Functions / AI Gateway)

These features require server-side infrastructure and are intentionally deferred.

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
- One-click audio polish (silence/filler removal via FFmpeg)

### Updates Agent: AI-Voiced Recap
- 15-second AI audio abstract cloned from the user's voice (Lyria model)
- Automatic Jira routing based on project context detected from screen

---

## Phase 5 — CORTEX (Cross-Recording Intelligence) ✅ Shipped

**Goal:** Surface patterns, trends, and decisions *across* all recordings — transforming the library from a list of sessions into a living knowledge base.

### Shipped in Phase 5

- ✅ **`src/components/insights-panel.js`** — Insights dashboard tab with:
  - Stats strip: total recordings, hours recorded, AI-processed count, recordings with tasks
  - Quality trend sparkline (inline SVG, last 10 scored recordings)
  - Filler word leaderboard (horizontal bar chart, aggregated across all recordings)
  - Decision ledger: all `LOG_DECISION` tasks across all recordings, newest first
- ✅ **Tab bar** in IDLE state — switches between History (Ask + recordings list) and Insights; lazy-renders insights on first click
- ✅ **Insights refresh** — panel re-renders automatically after each AI processing cycle

### Phase 5b — Deferred (requires embeddings in context)

- **Related recordings** — semantically similar recordings per history item (needs embeddings loaded in history-panel context; currently only available via `getAllEmbeddings()` in ask-panel)
- **Decision conflict detection** — flag when two LOG_DECISION entries contradict each other (requires cross-recording semantic comparison)
- **Team RAG** — shared vector index via Netlify Blobs + Functions

---

## Phase 6 — NEXUS (Related Intelligence + Storage Health) ✅ Shipped

**Goal:** Close the feedback loop across recordings — surface what's similar, make storage self-managing.

### Shipped in Phase 6

- ✅ **Related recordings** (`history-panel.js`) — when a recording with embeddings is expanded, 2-3 semantically similar recordings are computed locally (mean cosine similarity, threshold 0.35) and shown as clickable chips below the summary. Clicking scrolls to and expands the related item. Zero network cost; purely from stored vectors.
- ✅ **Storage health card** (`insights-panel.js`) — new card at the bottom of the Insights tab showing:
  - `navigator.storage.estimate()` usage bar (MB used / GB quota)
  - Count + estimated MB of local video blobs older than 30 days
  - "Free space" button: deletes blobs for old recordings while preserving all metadata, AI summaries, and transcript embeddings
- ✅ **Duplicate handler fix** (`history-panel.js`) — removed stale second copy of `.ai-tab` and `.history-download-md` event listeners that were silently stacking on every `_applyFilters()` call
- ✅ **`.related-chip` CSS** — compact chip style for related recording buttons

### Phase 6b — Deferred

- Decision conflict detection (requires cross-recording semantic comparison of LOG_DECISION payloads)
- Team RAG / shared vector index (requires Netlify Blobs + Functions)

---

## Phase 7 — SHARE + EXPORT (Library Portability) ✅ Shipped

**Goal:** Make recordings sharable and the library portable — no backend required for either.

### Shipped in Phase 7

- ✅ **Shareable summary links** (`shared-view.js` + `main.js`) — every AI-processed recording gets a "Share" button that encodes `{ title, date, type, aiSummary }` as base64 in a URL hash (`#share=…`). Opening the link renders a full-screen read-only summary overlay with markdown rendering, type badge, date, and "Download .md" action. No Takus account required. Copying the link flashes a check icon; falls back to a toast with the URL.
- ✅ **Library export** (`history-panel.js`) — "Export" button in history header downloads all recording metadata (AI summaries, transcripts, tasks, analytics) as `takus-backup-YYYY-MM-DD.json`. `observerLog` is excluded (privacy + size).
- ✅ **Library import** (`history-panel.js`) — "Import" button accepts a `.json` export file. Merges by recording ID — new entries added, existing IDs skipped. Shows "X added, Y skipped" toast.

### Phase 7b — Deferred

- Full ZIP export with video blobs (streaming download via browser File System API — requires `showSaveFilePicker`)
- Shared summary page hosted at a stable short URL (requires Netlify Functions to store/retrieve summaries)
- QR code generation for shared links

---

## Known Limitations

- **Gemini transcript tags:** If Gemini omits `<transcript>` XML tags, stored transcript is empty; summary is unaffected.
- **Blob quota:** IndexedDB video blobs may fill available disk on devices with many recordings. Use the Storage Health card in Insights to free space.
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
