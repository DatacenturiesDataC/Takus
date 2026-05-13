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
netlify.toml                ← Netlify build config + function routes
netlify/functions/
  share.mjs                 ← [Phase 13] short share URLs (Netlify Blobs)
  jira.mjs                  ← [Phase 13] Jira Cloud REST API proxy
  notion.mjs                ← [Phase 13] Notion API proxy
public/
  sw.js                     ← service worker (offline caching)
  _headers                  ← Netlify security headers
src/
  components/
    app-shell.js            ← top-level orchestrator; state machine, keyboard shortcuts
    header.js               ← logo, cloud provider badge
    recorder-panel.js       ← live recording controls (start/pause/resume/stop, upload)
    preview-canvas.js       ← waveform + camera preview
    review-panel.js         ← post-recording: video preview, trim, GIF, approve/discard
    upload-progress.js      ← upload progress bar (Google Drive / OneDrive)
    history-panel.js        ← recordings list: search, filter, AI summary, tasks, batch ops
    recording-detail.js     ← [Phase 14] 70/30 split recording workspace (code-split)
    tasks-panel.js          ← [Phase 1] Tasks for Takus / Tasks for Me dual pane
    global-tasks-panel.js   ← [Phase 14] aggregate tasks across all recordings
    share-panel.js          ← modal: email summary + transcript to participants
    session-config.js       ← [Phase 14] type chips, camera toggle, mic device selection
    settings-panel.js       ← AI provider + API key, recording quality, watermark
    type-picker.js          ← meeting / screen / presentation / update type cards
    consent-notice.js       ← first-run privacy notice
    toast.js                ← transient notification overlay
    archive-player.js       ← [Phase 11] lightweight replay (audio + frames + transcript)
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
    integrations/
      slack.js / github.js / linear.js
      jira.js               ← [Phase 13] Jira client (Identity Vault credentials)
      notion.js             ← [Phase 13] Notion client (Identity Vault credentials)
```

### State Machine States

```
idle → requesting_access → previewing → recording → paused
     → reviewing → processing → uploading → complete | upload_failed
idle → reviewing  (crash-recovery resume path)
```

### IndexedDB Schema (DB: `takus`, version 4)

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
  driveFolderId,   // Phase 9: folder ID in structured drive layout
  calendarEvent,   // Phase 14: { id, summary, start, end, organizer }
  participants,    // [{ name, email }]
  tasks,           // [{ id, type, action, payload, contextTimestamp, done }]  ← Phase 1
  observerLog,     // { consoleErrors, networkErrors, actions }                ← Phase 1
  analytics,       // { fillerWords: {total,perMinute,breakdown,rating}, score: {score,label,color} } ← Phase 4a
  pinned,          // Phase 14e: boolean — pinned recordings sort first
  notes,           // Phase 14e: string — free-text user notes (auto-saved)
}
```

**settings** store (keyPath: `key`): arbitrary key-value pairs
**recovery** store (keyPath: `id`): crash-recovery chunks + updatedAt timestamp
**embeddings** store v3 (keyPath: `recordingId`): `{ recordingId, chunks: [{text, start, end, chunkIdx, embedding: number[]}] }`  ← Phase 2
**wiki** store v3 (keyPath: `id`, index: `date`): `{ id, date, query, answer, sources: [{recordingId, title}] }`  ← Phase 2
**vaultSync** store v4 (keyPath: `id`): `{ id, driveFolderId, drivePackageUploaded, archiveStatus, pinned, legalHold, lastSyncDate }`  ← Phase 9

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
- ✅ Timestamp linking to exact video position: shipped in Phase 11 (click-to-seek in transcript + inline timestamps)

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
| `CREATE_BUG_REPORT` | Jira (Bug) → GitHub → Linear | Clipboard copy |
| `UPDATE_TICKET` | Jira → Linear | Clipboard copy |
| `LOG_DECISION` | Notion → Clipboard | — |
| `CREATE_CALENDAR_EVENT` | Google Calendar URL | — |

### What's browser-accessible without a proxy
- ✅ Slack Incoming Webhooks (CORS-enabled)
- ✅ GitHub REST API v3 (CORS + PAT)
- ✅ Linear GraphQL API (CORS + API key)
- ✅ Jira Cloud (via Netlify Function proxy — Phase 13)
- ✅ Notion (via Netlify Function proxy — Phase 13)

### Netlify Build Plugin — deferred
- "Inject Takus" toggle for Netlify-deployed sites (niche feature, low priority)
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

### Phase 4b — Deferred (requires ML models / AI Gateway)

These features require heavy ML inference or external AI services beyond current scope. Netlify Functions infra is now in place (Phase 13).

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

### Phase 5b — Partially Shipped

- ✅ **Related recordings** — shipped in Phase 6 (`history-panel.js`); semantically similar recordings shown as chips when an AI-processed recording is expanded
- ✅ **Decision conflict detection** — shipped in Insights panel (`insights-panel.js`); word-overlap heuristic flags potentially conflicting LOG_DECISION entries
- **Team RAG** — shared vector index via Netlify Blobs + Functions (deferred — requires shared DB design)

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

### Phase 6b — Partially Shipped

- ✅ Decision conflict detection — shipped in Insights panel (word-overlap heuristic with 30% threshold)
- Team RAG / shared vector index (deferred — requires shared DB design)

---

## Phase 7 — SHARE + EXPORT (Library Portability) ✅ Shipped

**Goal:** Make recordings sharable and the library portable — no backend required for either.

### Shipped in Phase 7

- ✅ **Shareable summary links** (`shared-view.js` + `main.js`) — every AI-processed recording gets a "Share" button that encodes `{ title, date, type, aiSummary }` as base64 in a URL hash (`#share=…`). Opening the link renders a full-screen read-only summary overlay with markdown rendering, type badge, date, and "Download .md" action. No Takus account required. Copying the link flashes a check icon; falls back to a toast with the URL.
- ✅ **Library export** (`history-panel.js`) — "Export" button in history header downloads all recording metadata (AI summaries, transcripts, tasks, analytics) as `takus-backup-YYYY-MM-DD.json`. `observerLog` is excluded (privacy + size).
- ✅ **Library import** (`history-panel.js`) — "Import" button accepts a `.json` export file. Merges by recording ID — new entries added, existing IDs skipped. Shows "X added, Y skipped" toast.

### Phase 7b — Partially Shipped

- ✅ **Full ZIP export** (`src/lib/zip-export.js`) — "Full backup" button in history header bundles all recording metadata + video blobs + AI summaries + transcripts into a `.zip` file. Uses a zero-dependency browser-native ZIP builder (store method, CRC-32). Supports `showSaveFilePicker` with fallback to Blob download.
- ✅ **QR code generation** (`src/lib/qr-code.js`) — QR button on each AI-processed recording generates a scannable QR code for the shareable summary link. Zero-dependency QR encoder (byte mode, ECC level L, Reed-Solomon) renders to SVG. Modal with "Copy Link" button.
- ✅ **Shared summary page hosted at a stable short URL** — shipped in Phase 13b (`#s=<shortId>` via Netlify Blobs)

---

## Phase 8 — PULSE (Productivity Intelligence) ✅ Shipped

**Goal:** Surface work patterns over time and reduce friction before every recording session.

### Shipped in Phase 8

- ✅ **Activity heatmap** (`insights-panel.js`) — GitHub-style 52-week calendar grid (SVG, 53 columns × 7 rows) showing recording frequency per day. Purple intensity scale: 0–4+ recordings. Month labels on top axis; native tooltip on hover shows date and count. Rendered as the first card in the Insights tab.
- ✅ **Type breakdown donut** (`insights-panel.js`) — SVG donut chart showing proportional breakdown of recording types (meeting / screen / presentation / update) with per-type count and percentage legend. Only shown when 2+ distinct types exist.
- ✅ **Recording templates** (`session-config.js`) — Five quick-start chips above the title field: Standup, 1-on-1, Bug Bash, Demo, Sprint Review. Clicking a chip fills the title input and persists it immediately. Zero extra storage.
- ✅ **Desktop notifications** (`settings-panel.js` + `app-shell.js`) — Optional "Desktop notifications when AI finishes" toggle in Settings. Requests `Notification.permission` on first enable; gracefully handles denied state with a toast. Fires a `new Notification()` after every successful AI processing cycle if the tab may be in the background.
- ✅ **New icons** (`icons.js`) — `bell` (notification bell), `pieChart` (donut card header)

### Phase 8b — Partially Shipped

- ✅ **Heatmap cell click → filter history** (`insights-panel.js` + `app-shell.js`) — click a day cell on the activity heatmap to dispatch `takus:datefilter` custom event, which switches to History tab and applies a date filter showing only recordings from that day.

### Phase 8b — Fully Shipped

- ✅ **Busiest week annotation** — shipped in heatmap (`insights-panel.js`); shows "Peak: {date range} (count)" below the heatmap
- ✅ **Streak counter** — shipped in heatmap; shows "🔥 X-day streak" and "Y active days this year"
- ✅ **Notification grouping** — shipped; toast deduplication coalesces rapid-fire identical toasts into one with ×N count badge

---

## Phase 9 — VAULT (Structured Cloud Drive) ✅ Complete

**Goal:** Replace the current flat-file upload (single `.webm` dumped into a "Takus Recordings" folder) with a structured, conflict-resilient drive layout. Each recording becomes a self-contained folder with human-readable artefacts.

### Motivation

The current model uploads a single `{title}.webm` to the root of a "Takus Recordings" folder. This means:
- AI summaries and transcripts only exist in IndexedDB (lost on browser data clear)
- No way to recover metadata without the browser that recorded it
- No structured data for archival (Phase 10) to consume
- Cloud browsing is a flat list of opaque video files

### Drive Structure

```
Takus/                                  ← root, created on first authentication
│
├── recordings/                         ← screen, meeting, presentation captures
│   └── YYYY-MM/                        ← monthly bucket (e.g. 2026-05/)
│       └── {recording_id}/             ← one folder per recording
│           ├── original.webm           ← raw recording (video + audio)
│           ├── transcript.vtt          ← full transcript with timestamps
│           ├── summary.md              ← AI-generated summary (BYOK)
│           ├── metadata.json           ← duration, speakers, type, status, archive state
│           └── frames/                 ← (optional) key preview frames
│               ├── 0001.jpg
│               └── ...
│
├── chats/                              ← [future] AI conversation threads
│   └── {chat_id}/
│       ├── messages.json
│       ├── summary.md
│       └── context.json                ← linked recordings, tasks, etc.
│
├── tasks/                              ← [future] project management / to-do board
│   ├── board.json                      ← lists, columns, view state
│   └── cards/
│       └── {task_id}.json
│
├── integrations/                       ← connected third-party services config
│   └── manifest.json                   ← enabled integrations (non-secret metadata)
│
├── settings/                           ← user preferences
│   └── preferences.json                ← theme, language, defaults (no secrets)
│
└── exports/                            ← [future] user-requested export bundles
```

### Core Principles

- **No shared database file** — local IndexedDB is the fast cache and source of truth. The drive stores independent, human-readable files to avoid sync conflicts and corruption.
- **Monthly recording buckets** — grouping by `YYYY-MM/` keeps cloud directory listings fast and manageable at scale.
- **One entity per folder or file** — each recording, chat thread, and task card is isolated, so partial uploads or sync errors never corrupt unrelated items.
- **Zero secrets in the cloud** — BYOK API keys, OAuth tokens, and integration credentials are stored exclusively in the browser's secure storage (`identity-vault.js`). `settings/` and `integrations/` contain only non-sensitive metadata.

### Implementation Plan

#### 9a. Recording Upload Refactor (`google-drive.js`, `microsoft-onedrive.js`) ✅

Current `uploadResumable(blob, filename)` → new `uploadRecordingPackage(recordingId, blob, historyEntry)`:

1. `ensureFolder('Takus')` → `ensureFolder('Takus/recordings')` → `ensureFolder('Takus/recordings/YYYY-MM')` → `ensureFolder('Takus/recordings/YYYY-MM/{recording_id}')` ✅
2. Upload `original.webm` to the recording folder (resumable, same as today) ✅
3. After AI processing completes, upload `transcript.vtt`, `summary.md`, `metadata.json` as small files ✅
4. Generate and upload key frame thumbnails (Phase 10 prerequisite) — deferred to Phase 10

#### 9b. Settings Sync Refactor (`settings-panel.js`, `cloud-provider.js`) ✅

Current: Fully automatic — no manual Backup / Restore buttons.

- **Auto-backup:** Every syncable setting change triggers a debounced (2 s) cloud write to `Takus/settings/preferences.json`. Legacy `appDataFolder` is also updated for backward compat. ✅
- **Auto-restore:** On cloud connect, `restoreSettingsFromCloud()` merges cloud preferences into local IndexedDB. Cloud wins for syncable keys. ✅
- **Security:** API keys (`openaiKey`, `geminiKey`) are excluded from sync — never leave the device. ✅

#### 9c. App Initialisation Sync ✅

On page load (after auth), scan the drive for existing recordings:
1. List `Takus/recordings/*/*/metadata.json` (lightweight; only reads JSON headers) ✅
2. Merge into local IndexedDB by recording ID — new entries from other devices added, existing entries skip ✅
3. Transcript and summary populated from drive if missing locally ✅

### Migration Strategy

- Existing recordings in the flat "Takus Recordings" folder are left in place (no migration needed)
- New recordings use the structured layout
- A future "Migrate" button in Settings can move old files into the new structure (N/A — Takus hasn't gone to production)

---

## Phase 10 — ARCHIVE (Intelligent Storage Lifecycle) ✅ Complete

**Goal:** Reduce storage cost by replacing full video recordings with compact, information-preserving archives, while protecting against accidental data loss and respecting legal holds and user intent.

**Dependency:** Phase 9 (VAULT) — archival requires the per-recording structured folders to store condensed packages.

### 10a. Preconditions for Archival

A recording is eligible for archival only when **all** of the following are true:

| Condition | Description |
|-----------|-------------|
| **Age** | Created more than 30 days ago (configurable via `settings.archiveAfterDays`) |
| **Not pinned** | The recording is not flagged as pinned by the user |
| **No legal hold** | The recording is not part of any active retention requirement |
| **Not already archived** | Prevents double-processing |

### 10b. Content Classification

Before archiving, the system classifies the visual importance of the recording into one of three categories:

| Class | Typical Examples | Visual Significance | Detection Heuristics |
|-------|-----------------|---------------------|---------------------|
| **Transcript-centric** | Talking-head meetings, voice-only calls, pure narration | Very low | Audio-only duration ratio > 80%; no screen share; low frame variance |
| **Slide / Screen-share** | Presentations, code reviews, report walk-throughs | Medium | Screen share active > 50%; discrete frame changes (slide transitions) |
| **Dynamic-visual** | Live demos, physical whiteboards, animation reviews | High | High frame-difference variance; continuous motion detected |

Detection sources (use any combination):
- Percentage of time screen-sharing vs. camera-on (available from `MediaStream` track metadata)
- Frame-difference variance over time (computed via canvas sampling during recording or post-hoc)
- Presence of user-applied tags (e.g., recording type `presentation` vs `meeting`)
- Audio-only duration ratio

### 10c. Archive Actions per Class

#### A. Transcript-centric & Slide / Screen-share recordings

1. **Extract key frames** — capture frames at moments of significant visual change (slide transitions, screen content modifications). Use scene-cut detection or timestamp deltas.
2. **Retain permanently:**
   - Full audio (original format)
   - Full transcript with word-level timestamps and speaker labels
   - Set of extracted key frames (JPEG) stored alongside their timestamp
   - All original metadata (title, participants, date, duration, analytics)
3. **Delete the full video** from hot storage after grace period (Section 10e)
4. **Optional: Lightweight replay player** — synchronize audio, transcript highlighting, and key-frame display at the correct times to recreate a summarised replay experience without the full video

#### B. Dynamic-visual recordings

1. **Create a low-fidelity video derivative:**
   - Transcode to 360p, 5 fps, while keeping the original audio track
   - Target: ~90-95% file size reduction
2. **Retain permanently:** The low-fidelity video, full audio, full transcript, metadata
3. **Full video:** Moved to cold storage, then deleted after grace period

### 10d. Recording Pinning & Legal Holds

New recording-level flags in `metadata.json` and IndexedDB:

```js
{
  pinned: false,            // user toggle, prevents archival
  pinnedAt: null,           // ISO 8601 timestamp
  legalHold: false,         // admin/compliance toggle
  legalHoldReason: null,    // string: case ID or regulatory ref
  archiveStatus: 'active',  // 'active' | 'pending' | 'archived' | 'cold'
  archivedAt: null,
}
```

- **Pin/unpin** exposed as a toggle on history cards (star icon or thumbtack)
- **Pin audit trail** — all pin/unpin actions logged to an immutable `archiveLog[]` array on the recording entry
- **Legal hold** — not exposed in UI initially (set via JSON import or future admin panel)

### 10e. Safety, Compliance & Grace Period

| Step | Action | Duration |
|------|--------|----------|
| 1 | System identifies eligible recordings and generates condensed package | Automatic |
| 2 | **Pre-archive preview** (optional): notify user, 48-72 hour objection window | Configurable |
| 3 | Condensed package verified; original video moved to cold storage tier | Immediate after approval |
| 4 | **Grace period**: original accessible via "Restore" button with cost/time warning | 90 days (configurable) |
| 5 | Original permanently deleted after grace period expiry | Automatic |

### 10f. Storage Flow Summary

```
Active Storage (hot — Google Drive / OneDrive)
  │
  ├─ 30 days old, not pinned, no hold
  │
  ├─ Classify → Generate condensed package
  │     ├─ Transcript-centric: audio + transcript + key frames
  │     └─ Dynamic-visual: low-fidelity video + transcript
  │
  ├─ Move original full video to Cold Storage (retention 90 days)
  │     └─ After 90 days → Permanently delete
  │
  └─ Condensed package becomes the new primary, accessible record.
```

### 10g. Estimated Storage Savings

| Type | Original Size (1h 1080p) | Condensed Size | Saving |
|------|--------------------------|----------------|--------|
| Transcript-centric (frames) | ~500 MB | ~5–10 MB | >95% |
| Slide / Screen-share (frames) | ~500 MB | ~10–20 MB | >96% |
| Dynamic-visual (low-fidelity) | ~500 MB | ~30 MB | ~94% |

After cold-storage grace period expires, savings are permanent.

### 10h. Implementation Dependencies

| Dependency | Status | Required For |
|------------|--------|-------------|
| Phase 9 VAULT (structured folders) | ✅ | Condensed package storage, metadata.json archive flags |
| FFmpeg WASM (already shipped) | ✅ | Key frame extraction, video transcoding |
| IndexedDB schema v4 | ✅ | `pinned`, `legalHold`, `archiveStatus` fields on recordings |
| Cloud cold storage API | Deferred | S3 Glacier / Azure Archive / GCP Archive integration |
| Archive Engine (`archive-engine.js`) | ✅ | Eligibility, classification, key-frame extraction, condensed package |
| Archive Statistics (Insights panel) | ✅ | Dashboard card with active/archived/pinned counts + savings estimate |

> **Note:** For the initial browser-only implementation, "cold storage" maps to the same cloud drive but in an `archive/` subfolder. True cloud-tiered cold storage (Glacier, etc.) requires server-side functions (Netlify Functions) and is deferred to Phase 10b.

---

### Phase 11 — PLAYBACK (Enhanced Replay Experience) ✅

| Feature | Status | Details |
|---------|--------|---------|
| Synchronized Watch Modal | ✅ | Side-by-side video + transcript panel with live VTT segment highlighting |
| Click-to-seek transcript | ✅ | Click any transcript row → video seeks to that timestamp |
| Search within transcript | ✅ | Filter + highlight matches inside the watch modal transcript panel |
| Clickable inline timestamps | ✅ | VTT timestamps in history panel → open watch modal at that position |
| Archive Replay Player | ✅ | Lightweight modal with audio + key frames + transcript sync |

### Phase 12 — POLISH (Quality of Life) ✅

| Feature | Status | Details |
|---------|--------|---------|
| Batch Operations | ✅ | Select mode toggle, checkboxes, Delete Selected, Export Selected |
| Recording Tags | ✅ | Inline tag editor, autocomplete, tag filter chip row |
| Sort by Size | ✅ | Added "Largest" sort option to recording library |
| Pinned-first sort | ✅ | Pinned recordings always sort above others |

### Phase 13 — BRIDGE (Serverless Integration Layer) ✅

| Feature | Status | Details |
|---------|--------|---------|
| Netlify Functions setup | ✅ | `netlify.toml`, `/api/*` proxy, SPA fallback |
| Short Share URLs | ✅ | `POST /api/share` → Netlify Blobs (free tier, 1 GB) |
| Jira Cloud proxy | ✅ | `POST /api/jira` — issue creation, dry-run verify |
| Notion proxy | ✅ | `POST /api/notion` — page creation, markdown→blocks converter |
| Jira integration client | ✅ | `src/lib/integrations/jira.js` — credentials via Identity Vault |
| Notion integration client | ✅ | `src/lib/integrations/notion.js` — credentials via Identity Vault |
| Connect panel cards | ✅ | Jira Cloud + Notion cards with save/test/disconnect |
| Origin validation | ✅ | All serverless functions validate request origin; 500 KB payload limit on shares |
| Auto settings sync | ✅ | Debounced backup on every change; auto-restore on cloud connect. API keys never synced. |
| Google Drive upsert | ✅ | `upsertSmallFile()` — checks for existing file before upload, PATCHes instead of duplicating |
| OneDrive ID-based upsert | ✅ | `upsertSmallFile()` — uses folder ID (not path) for AI artefact re-uploads |
| AI artefact cloud sync | ✅ | Post-AI processing re-uploads summary.md, transcript.vtt, metadata.json to cloud folder |

> **Infrastructure cost: $0** — all within Netlify's free tier (125K function invocations/mo, 1 GB Blobs storage).

---

### Production Hardening Audit ✅

Full 52-file audit covering data integrity, race conditions, resource management, XSS, token security, error handling, and performance.

| Category | Finding |
|----------|---------|
| **Critical fix** | Upload failure no longer permanently blocks AI processing — `_uploadDone` promise now resolves in `finally` block |
| **Minor fix** | Event listener leak in keyboard shortcuts overlay — all close paths now unregister the `keydown` handler |
| XSS surface | ✅ All user content through `esc()`. `renderMarkdown()` escapes before adding HTML tags |
| Token storage | ✅ No raw tokens in localStorage. Google: memory-only. MS: MSAL cache. Creds: AES-GCM-256 vault |
| eval / open redirect | ✅ Zero instances of `eval()`, `new Function()`, or open redirects |
| Async error handling | ✅ All async event handlers have `try/catch` with toast error reporting |
| Resource cleanup | ✅ MediaStream tracks, timers, event listeners, FFmpeg FS — all properly released |
| CSP coverage | ✅ All API domains covered. `wasm-unsafe-eval` for FFmpeg. No inline scripts |
| Build | ✅ 345 KB bundle (87 KB gzipped), 0 npm vulnerabilities |

---

### Phase 14 — FOCUS (Knowledge Workspace Architecture) ✅

**Goal:** Restructure the IDLE screen from "recorder with history" into a **Knowledge Workspace** — shifting the interaction model from "record and forget" to "record, understand, and act."

#### 14a. Ask Elevation + 5-Tab Navigation ✅

- ✅ **Elevated Ask bar** — moved above the tab bar; always visible regardless of active tab
- ✅ **5-tab navigation** — `History | Tasks | Insights | Connect | Settings`
- ✅ **Global Tasks panel** (`global-tasks-panel.js`) — aggregates uncompleted tasks across all recordings
- ✅ **Inline Settings & Connect** — `renderSettingsInline()` and `renderConnectInline()` for tab panels
- ✅ **Lazy rendering** — `data-rendered` pattern defers DOM until first selection

#### 14b. Session Config Simplification + Upload ✅

- ✅ **Title input removed** — titles are AI-generated post-recording
- ✅ **Type selector chips** — Meeting (purple), Screen (blue), Presentation (green), Update (amber) with per-type camera/quality presets
- ✅ **Camera toggle** relocated to session-config
- ✅ **Upload button** — imports `.webm`, `.mp4`, `.m4a`, `.wav`, `.mp3`, `.mov` (2 GB limit)

#### 14c. Recording Detail View (70/30 Split) ✅

- ✅ **`recording-detail.js`** (code-split, 17.77 KB) — 70/30 grid layout
- **Left pane (70%)**: Ask (scoped semantic search), Summary (TL;DW + chapters), Transcript (search + video sync), Tasks
- **Right pane (30%)**: Video player, calendar event, participants, tags, quality score, downloads
- ✅ **Video-transcript sync** — active line highlights and auto-scrolls
- ✅ **Mobile responsive** — stacks vertically at 768px

#### 14d. Calendar Context Persistence ✅

- ✅ **Full calendar event metadata** saved to recording: `{ id, summary, start, end, organizer }`
- ✅ **Organizer field** in both Google Calendar and Microsoft Calendar returns

#### 14e. AI-Generated Titles + Related Recordings ✅

- ✅ **Type-based default titles** — `"Meeting — May 12 08:19 PM"` replaces "Untitled Recording"
- ✅ **AI title extraction** — `_extractTitleFromSummary()` parses first markdown heading from AI summary
- ✅ **Related recordings** — cosine similarity of mean embedding vectors, top-3 above 35% threshold
- ✅ **Clickable related chips** — click dispatches `takus:open-recording` to navigate to related recording
- ✅ **Upload duration extraction** — `_extractDuration()` reads metadata from uploaded video/audio files
- ✅ **Cascade panel refresh** — detail view pin/delete/notes auto-refresh History, Tasks, and Insights

#### 14f. Production Polish ✅

- ✅ **Knowledge OS branding** — onboarding card, noscript fallback, and manifest updated
- ✅ **Header settings** — gear icon in account dropdown now switches to Settings tab (with modal fallback)
- ✅ **Detail-tab conflict** — switching tabs auto-closes the recording detail overlay
- ✅ **Code-split optimization** — `global-tasks-panel.js` fully lazy-loaded (6.13 KB separate chunk)
- ✅ **Service worker** bumped to `v16` for new chunk hashes
- ✅ **Keyboard shortcuts** — Escape closes detail, comma opens Settings tab, shortcuts overlay updated

#### 14g. Cross-Panel Navigation + CSS Hardening ✅

- ✅ **Unified navigation** — every recording reference is clickable → opens detail view:
  - History rows, Tasks body, Insights digest, Decision ledger, Ask source chips, Related chips
- ✅ **Ask source chip UX** — click opens detail; play button (stopPropagation) opens timestamp watch modal
- ✅ **Cloud links** — "Open in Drive" + "View AI Doc" links in recording detail info section
- ✅ **CSS design system** — proper `.main-tab-bar`, `.main-tab`, `.global-task-row`, `.btn-task-done` rules
- ✅ **Accessibility** — `focus-visible` outlines on tabs, task checkboxes, detail tabs
- ✅ **Hover micro-interactions** — task checkbox scale(1.15), source chip border glow, task row backgrounds
- ✅ **Deduplicated CSS** — removed redundant `.global-task-row` block, consolidated to single source
- ✅ **Mobile polish** — tab font/padding reduction at 768px breakpoint

---

## Known Limitations

- **Gemini transcript tags:** If Gemini omits `<transcript>` XML tags, stored transcript is empty; summary is unaffected.
- **Blob quota:** IndexedDB video blobs may fill available disk on devices with many recordings. Use the Storage Health card in Insights to free space.
- **Watermark font:** Requires network fetch of Roboto.ttf on first use; skipped with toast if CDN unreachable.
- **FFmpeg cold start:** First WASM operation takes 2–5 s. Subsequent operations reuse the loaded instance.
- **FFmpeg CSP requirement:** The `_headers` file must include `'wasm-unsafe-eval'` in `script-src` for WebAssembly to work. Without it, MP4/GIF conversion silently fails.
- **Observer scope (Phase 1):** The Observer only captures events from the recording tab's own JS context. Cross-origin iframes and browser extensions are not observable.
- **Cross-device sync:** Recordings and settings appear on other devices after cloud login via background vault sync. The history panel re-renders automatically when sync completes. Sync is non-blocking and rate-limited to one concurrent operation.
- **Settings sync scope:** API keys (`openaiKey`, `geminiKey`) are never synced to the cloud — they are stored on-device only. All other preferences auto-sync.

---

## Code Conventions

- Vite build tool with native ES modules (`<script type="module">`)
- No TypeScript — JSDoc `@param` / `@returns` where non-obvious
- No framework — `innerHTML` for full re-renders, direct event listeners for interactions
- CSS variables in `src/styles/index.css`; component styles in `src/styles/components.css`
- Security: all user content through `esc()` before `innerHTML`; no `eval()`, no external scripts beyond OAuth SDKs
- Prefer single-file changes per feature

## Naming Conventions
- `render*` — rebuild a container's `innerHTML` from scratch
- `update*` — mutate specific DOM nodes without a full re-render
- `_private` — internal helpers not exported from the module
- Event delegation via `container.querySelector()` after `innerHTML` assignment
