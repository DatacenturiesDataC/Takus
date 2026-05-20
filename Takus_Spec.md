# Deep Evaluation & Normalization of the Takus Design

> **Document Status:** Validated against Takus codebase v0.17.0 (2026-05-20). Phases 1–3 complete. Post-v0.14 capabilities (Phases 4–92) documented below.
> Each section is annotated with `[IMPLEMENTED]`, `[PARTIAL]`, `[NOT IMPLEMENTED]`, or `[PROPOSAL]` tags indicating the current state relative to the live codebase. Takus has **not** been deployed to production yet.

---

## 1. Logical Soundness

Overall assessment: The architecture forms a coherent directed acyclic graph (ingest → transform → store → query/act) with clear feedback loops. However, several logical inconsistencies exist.

- **Knowledge levels (L0–L4)** are well-ordered but the concept of "close contact" for L3 is recursive: a contact's engagement makes them close, but we also need closeness to weight that engagement. This circularity is mitigated by using a 30-day interaction window that computes closeness independently of L3 status. The logic holds if we strictly compute closeness from L0–L2 interactions only.
  - `[IMPLEMENTED]` — `closeness-score.js` uses a configurable `daysBack` (default 30) rolling window. `knowledge-level.js` computes L3 using `isCloseContact()` (threshold ≥65) plus engagement signals. Closeness is computed from raw interaction types (DM, meeting, sharedTask, mention) — independent of knowledge levels, avoiding circularity.

- **Autonomous task steps with dependencies** can create deadlocks if step A depends on B and B depends on A. The design must detect and reject cycles at step creation time.
  - `[IMPLEMENTED]` — `step-executor.js` now includes `detectCycles()` (iterative DFS) and `validateSteps()` which enforces a 50-step cap (`MAX_STEPS_PER_TASK`) and rejects cyclic dependencies at creation time. `getDependencyStatus()` returns `met|blocked|failed` and dependent steps auto-skip when a dependency permanently fails.

- **Archiving with cold storage then deletion** is logically sound, but the state machine needs an explicit "restored" state that rehydrates the original content without creating duplicate nodes.
  - `[IMPLEMENTED]` — `archive-engine.js` defines `ArchiveStatus = { ACTIVE, PENDING, ARCHIVED, COLD, RESTORED }`. `restoreRecording()` downloads the video blob and AI artefacts from cloud, transitions archived→active with full audit trail. Condensed package generation is implemented. Original video deletion after cold-storage grace period is fully implemented.

- **Device continuity via CRDT** plus cloud relay is logically possible only if the CRDT document size stays within practical limits (a few MB). Embedding millions of nodes will bloat the sync file; the design must partition the graph (e.g., by time) or use a hybrid model.
  - `[NOT IMPLEMENTED]` — Takus uses **IndexedDB** (12 object stores, v7 schema) as the local data layer and cloud drive folder sync (`Takus/recordings/YYYY-MM/{id}/`) for cross-device continuity. There is **no CRDT** (no Yjs dependency), **no WebRTC sync**, and **no graph sharding**. Device sync relies on the cloud provider's vault sync mechanism (`cloud-provider.js`).

- **Confirmation bias mitigation** is logically an advisory layer, not an active filter. It must never override user decisions; this boundary is clear but must be enforced in UI prompts.
  - `[IMPLEMENTED]` — `blind-spot-detector.js` is a pure computation module (no side effects) that detects 4 bias patterns (ignored categories, single-source tunnel vision, stale contacts, recency bias). Results are displayed as advisory "Blind Spots" cards in the Insights panel. The module never modifies user data or overrides decisions. Gated behind the `blindSpots` feature flag.

**Refinement:** ~~Add cycle detection in step dependencies~~ → Done (`detectCycles()` + `validateSteps()`). ~~Make archiving state explicit~~ → Done (`RESTORED` status + `restoreRecording()`). ~~Partition the CRDT graph into shards~~ → Not applicable; current architecture uses IndexedDB + cloud folder sync, not CRDTs.

---

## 2. Normalization (Data Model & Redundancy)

The current model uses a graph (nodes + edges) with properties stored as JSON. This is flexible but can lead to data redundancy and inconsistency.

- **Task steps are embedded inside the task node.** This is fine for a document-oriented database but risks large objects when a task has many steps.
  - `[IMPLEMENTED]` — Tasks are stored in the `recordings` store as a `tasks` array property on recording objects. Steps are embedded as `steps` arrays within each task object. No separate store exists for steps. The step-executor supports `dependsOn` relationships within a single task's step array. Step count is capped at `MAX_STEPS_PER_TASK = 50`.

- **Metadata duplication:** Each `metadata.json` in the cloud drive contains the knowledge level, which is derived from the graph.
  - `[PARTIAL]` — Cloud vault uploads (`google-drive.js`, `microsoft-onedrive.js`) write `metadata.json` files containing recording metadata. Knowledge level is stored as a **computed field** on `content_items` in IDB (via `knowledge-level.js`) but is **not** currently written to cloud `metadata.json` files. The spec's concern about sync burden does not apply in the current implementation.

- **Multilingual translated fields** are stored as properties of the same node.
  - `[NOT IMPLEMENTED]` — There is no multilingual support in the codebase. No translation steps, no `summary_fr` properties, no language configuration. AI prompts are English-only.

- **Feedback payload** includes device context; this is ephemeral data that should not be stored long-term in the graph.
  - `[IMPLEMENTED]` — `feedback-engine.js` gathers device diagnostics (browser, screen, memory, storage estimate) and sanitizes PII. Feedback payloads are composed on-demand and submitted via the feedback modal. They are **not** stored in the knowledge graph or CRDT — only a lightweight submission history is kept in IDB settings.

**Refinement:** Keep knowledge level as a computed property derived on-the-fly from graph relationships — **this is already the case** in the current codebase. ~~Store feedback payload externally~~ — already external. The main gap is the absence of multilingual support (entirely a future feature).

---

## 3. Reality Check (Feasibility & Assumptions)

- **Desktop agent for zero-click capture** is technically feasible but requires user installation and OS trust.
  - `[NOT IMPLEMENTED]` — No desktop agent exists. Screen capture uses the browser's `getDisplayMedia` API exclusively (one-click permission). Auto-recording is calendar-driven (`auto-record-engine.js`, `calendar-poller.js`) but still requires the browser tab to be open and the PWA installed.

- **WebGPU for local AI** is still maturing. Whisper models need careful quantization.
  - `[NOT IMPLEMENTED]` — Takus uses **cloud AI exclusively** (BYOK: OpenAI Whisper API or Google Gemini). There is no local AI inference, no WebGPU, no WASM Whisper. Audio is extracted via FFmpeg WASM (`ffmpeg-engine.js`) then sent to the cloud API.

- **CRDT sync over WebRTC** requires a signaling server.
  - `[NOT IMPLEMENTED]` — See §1. No CRDTs, no WebRTC, no signaling server. Cross-device sync uses cloud drive folder listing + metadata comparison (`cloud-provider.js` vault sync).

- **Background processing via Service Workers** is limited to Chromium-based browsers.
  - `[PARTIAL]` — Takus has a service worker (`public/sw.js`, cache v40) for **offline caching and PWA installation** only. It does **not** use `PeriodicBackgroundSync` or `BackgroundFetch`. Background processing uses `requestIdleCallback` in the main thread (`autonomy-engine.js`) with `visibilitychange` pausing. Autonomy engine now includes proactive quota monitoring (`_checkStorageQuota()` at 80% threshold) and crash recovery (`_resumeInterruptedSteps()` on startup).

- **Confirmation bias mitigation** is aspirational; current AI can summarise opposing views but cannot truly understand cognitive biases.
  - `[IMPLEMENTED AS ADVISORY]` — Framed as "Blind Spots" and "Dissent & Open Questions," not "bias correction." AI prompts in `ai-engine.js` explicitly ask for disagreements and unresolved tensions in meeting summaries. `blind-spot-detector.js` analyzes behavioral patterns. Both are opt-in via feature flags (`blindSpots`, `dissent`).

**Refinement:** Position the desktop agent as a future "Takus Bridge" tier. ~~Rely on cloud AI for bias-aware summaries~~ — **this is already the approach**. Browser support tiers are not formally documented but graceful degradation exists (feature detection for `getDisplayMedia`, `MediaRecorder`, `requestIdleCallback`).

---

## 4. Reliability & Fault Tolerance

- **Recording pipeline:** If the desktop agent WebSocket connection drops mid-recording, the browser must detect and mark the recording as incomplete, with a retry/merge capability.
  - `[PARTIAL — DIFFERENT APPROACH]` — No desktop agent exists. Crash recovery uses **IndexedDB snapshots**: `saveRecoveryChunk()` writes every 10s during recording. On restart, `_checkRecovery()` in `app-shell.js` offers Resume/Download/Discard. Recovery data expires after 24h. The display stream's `ended` event triggers auto-stop.

- **CRDT merge conflicts:** While CRDTs guarantee eventual consistency, they cannot solve semantic conflicts.
  - `[NOT APPLICABLE]` — No CRDTs in the codebase. Takus is single-user, single-device primary with cloud backup. There is no multi-device concurrent editing scenario.

- **IndexedDB corruption:** The local cache must be rebuilt from the cloud drive automatically if corrupted.
  - `[IMPLEMENTED]` — `schema-validator.js` validates records on every IDB read and auto-repairs malformed fields (including the new `state` field with 5 valid values). `clearAllRecordings()` resets all 7 stores (including `step_checkpoints`). `CloudProviderManager.rebuildFromCloud()` provides explicit IDB rebuild from cloud vault. The `_db.onclose` handler in `storage.js` invalidates the connection cache for reconnection.

- **Archiving and cold storage:** If the cold storage retention expires and the user attempts to restore, the restoration must fail gracefully.
  - `[IMPLEMENTED]` — `restoreRecording()` downloads video + AI artefacts from cloud, handles both Google Drive and OneDrive. Transitions archived→restored→active with audit trail. If no cloud provider is connected or no video file is found, restoration fails gracefully with a descriptive error. Cold storage expiry/deletion is fully implemented; restoring a COLD entry fails immediately with a descriptive error.

- **Autonomous task steps:** If a step fails repeatedly, it must not block dependent steps indefinitely.
  - `[IMPLEMENTED]` — `getDependencyStatus()` returns `met|blocked|failed`. When a dependency permanently fails or is skipped, dependent steps auto-transition to `skipped` status with error message. `retryCount` field tracks attempts. `MAX_STEP_RETRIES = 3` is defined. `runWithCheckpoint()` persists step state to IDB after each step for crash recovery; `resumeCheckpoints()` resumes interrupted workflows on startup (24h expiry).

**Refinement:** ~~Add a retry counter + auto-escalate to `step-executor.js`~~ → Done (`getDependencyStatus()`, `retryCount`, auto-skip). ~~Watchdog for desktop agent streams~~ → Not applicable. The recovery system is effective for its current scope. ~~"Rebuild from cloud" function~~ → Done (`rebuildFromCloud()` in `CloudProviderManager`).

---

## 5. Performance & Scalability

- **CRDT document size:** Every node and edge added to the Yjs document increases sync time and memory.
  - `[NOT APPLICABLE]` — No Yjs/CRDT. Data stored in IndexedDB object stores with B-tree indexes. Performance is bounded by IDB read speed, not CRDT document size.

- **Vector search in IndexedDB:** Brute-force cosine similarity over 10k vectors (each 384-dimension) will take ~100 ms in JavaScript.
  - `[IMPLEMENTED]` — `embeddings.js` performs brute-force cosine similarity search over all stored embeddings. Vectors use OpenAI's `text-embedding-3-small` (1536-dim) or Gemini embeddings, not 384-dim. A keyword pre-filter (`_preFilter`) prunes candidates before cosine computation for faster search on large libraries. No HNSW index.

- **Spatial canvas with thousands of cards:** WebGL rendering is fast, but the DOM-based fallback will struggle.
  - `[NOT IMPLEMENTED]` — There is **no spatial canvas**. The UI uses a traditional tab-based layout (History, Tasks, People, Insights, Apps, Settings) with DOM-based list views. History panel uses standard DOM scrolling. No WebGL, no canvas rendering, no virtualized scrolling.

- **Local AI processing:** Running Whisper for a 1-hour meeting takes ~1–2 minutes on a good GPU.
  - `[NOT APPLICABLE]` — All AI runs in the cloud (OpenAI/Gemini API). Processing time depends on API latency, not local GPU. FFmpeg WASM audio extraction runs locally but completes in seconds.

- **Cloud sync with many small files:** The folder structure `recordings/YYYY-MM/{id}/` generates many files.
  - `[IMPLEMENTED]` — Google Drive and OneDrive uploads use the `Takus/recordings/YYYY-MM/{id}/` structure. Rate limiting is handled by the upload manager's exponential backoff (`upload-manager.js`). Vault sync on startup lists folders incrementally. No pagination caching beyond what the cloud API provides.

**Refinement:** ~~CRDT sharding~~ → Not applicable. ~~Web Workers for AI~~ → Not applicable (cloud API). The main performance concern is embedding search at scale — the keyword pre-filter mitigates this. Virtual scrolling in list views would help at 1000+ recordings but is not yet implemented.

---

## 6. Stability & Crash Resistance

- **Long-running operations** (translation, summarisation) must be resumable if the tab is closed.
  - `[PARTIAL]` — The recording pipeline (`recording-pipeline.js`) runs AI processing as a single async flow. If the tab closes mid-processing, the recording is saved (blob in IDB via crash recovery), but AI enrichments are lost and must be manually re-triggered. Step execution state is **not** persisted to IDB/OPFS between steps.

- **Storage quota exceeded:** OPFS has a quota. The resource orchestrator must monitor and trigger archiving before quota is hit.
  - `[IMPLEMENTED]` — `navigator.storage.persist()` is requested on first IDB open. `navigator.storage.estimate()` is used in `feedback-engine.js` for diagnostics and in `insights-panel.js` for display. When database usage exceeds the 80% quota threshold, `autonomy-engine.js` proactively triggers an archive scan (`_autoArchiveScan()`) to free space. OPFS is **not used** — all storage is IndexedDB + cloud drive.

- **Memory leaks:** The spatial canvas and WebGL contexts must be properly disposed.
  - `[PARTIAL — DIFFERENT SCOPE]` — No spatial canvas or WebGL. Memory leak prevention focuses on: `requestAnimationFrame` cleanup in `watch-modal.js`, stream track cleanup in `recorder.js`, audio engine disposal, and `cancelIdleCallback` in `autonomy-engine.js`. All tested.

- **Network interruptions:** Uploads and downloads must be queued with exponential backoff.
  - `[IMPLEMENTED]` — `upload-manager.js` implements `retryWithBackoff()` with configurable max retries (default 3), initial delay (1s), exponential multiplier, and jitter. Client errors (4xx) are not retried. Cloud uploads use chunked resumable uploads (5MB chunks for Google, 320KB-aligned for OneDrive).

**Refinement:** ~~OPFS state snapshots~~ → Not applicable (no OPFS). ~~Yjs GC~~ → Not applicable (no CRDT). The main stability gap is step execution persistence — if a multi-step task is interrupted, progress is lost. Adding step-level checkpointing to IDB would solve this.

---

## 7. Naming Conventions

| Term | Clarity | Current Codebase Status | Suggestion |
|------|---------|------------------------|------------|
| Takus | Product name, fine. | `[IMPLEMENTED]` | — |
| Knowledge Level L0–L4 | L3 originally named "Endorsed" — renamed to "Surfaced" | `[IMPLEMENTED]` — L3 labeled "Surfaced" in `knowledge-level.js` | ✅ Done |
| Close contact | Clear, but "close" is subjective. | `[IMPLEMENTED]` — Threshold ≥65 defined in `closeness-score.js` | Keep, threshold is well-defined |
| Archiving vs. condensing | The process creates a condensed version. | `[IMPLEMENTED]` — Called "archive" throughout, condensed packages are internal | `[PROPOSAL]` Use "Condense" for process, "Archive" for state |
| Feedback | Good. | `[IMPLEMENTED]` — `feedback-engine.js` + `feedback-modal.js` | — |
| Takus Brain | Internal name. | `[NOT USED]` — No "Brain" terminology in code | N/A |
| Desktop Agent | Not in codebase. | `[NOT IMPLEMENTED]` | `[PROPOSAL]` "Takus Bridge" when built |
| CRDT document | Technical. | `[NOT IMPLEMENTED]` — No CRDTs | N/A |
| Ingestion Adapter | Too technical. | `[NOT USED]` — Recording pipeline handles ingestion directly | `[PROPOSAL]` "Connected Services" (matches current "Apps" tab) |

**Current UI terminology:** The tab bar uses: History, Tasks, People, Insights, Apps, Settings. Integration management uses "Connected Apps" with tiles (Slack, GitHub, Linear, Jira, Notion). These are clean, user-friendly names.

---

## 8. Efficiency & Simplicity

- **Overengineering risk:** The cognitive engine with reinforcement learning and bias mitigation may add complexity that users don't see immediate value from.
  - `[MITIGATED]` — Both `preference-engine.js` (RL signals) and `blind-spot-detector.js` (bias detection) are gated behind feature flags (`adaptiveAI`, `blindSpots`). They are opt-in via Settings → Labs. The preference engine collects 10 signal types (7 task/search + 3 goal lifecycle) but the system degrades gracefully if disabled.

- **Duplication of logic:** The transformation pipeline overlaps with autonomous task steps.
  - `[ACKNOWLEDGED — INTENTIONAL]` — `recording-pipeline.js` handles the primary recording flow (direct AI calls), while `step-executor.js` handles arbitrary task step graphs. The architecture comment in `step-executor.js` (lines 6–12) explicitly documents this as an intentional separation: the pipeline is optimized for the single-recording happy path, while the step executor handles dependency resolution for complex workflows.

- **Too many states:** Task steps have many statuses.
  - `[IMPLEMENTED]` — Steps use 6 statuses: `pending`, `queued`, `executing`, `completed`, `failed`, `waiting_input`. The step-executor state machine is linear (pending → executing → completed/failed) with a `waiting_input` branch for approval gates. Tasks themselves use a simpler tri-state model: `pending`, `done`, `ignored`.

- **API surface:** The number of modules can be reduced by merging similar functions.
  - `[CURRENT STATE]` — 132 source modules total (35 components, 84 libs including graph + integrations, 12 app modules, 1 root), plus 73 test files. Cloud operations are split across provider-specific modules (`google-drive.js`, `microsoft-onedrive.js`, etc.) which is appropriate given the different APIs. The `cloud-provider.js` abstraction layer unifies the interface.

**Refinement:** ~~Merge pipeline into task engine~~ — The current intentional separation is pragmatic for a pre-production codebase. Merging should be considered only when sub-step execution becomes a user-facing feature beyond the recording flow. The main efficiency win would be unifying the duplicate pipeline+step-executor AI calls behind a shared service layer.

---

## Final Normalized Takus Architecture

### What the Spec Proposes vs. What Exists

| Spec Concept | Current Reality | Gap |
|---|---|---|
| "Everything is a task" | Recording pipeline + step executor are separate | Intentional; merge is a future option |
| CRDT graph sharded by year | IndexedDB v7 with 12 object stores | Fundamentally different architecture |
| Yjs maps for nodes/edges | `edges` store in IDB with compound indexes | Lightweight but functional |
| Knowledge level = computed | Computed by `knowledge-level.js`, stored on `content_items` | Close to spec intent |
| Cloud metadata = regenerable cache | Cloud `metadata.json` written on upload | Metadata is authoritative on cloud, computed locally |
| OPFS for media | IDB `blobs` store + cloud drive | No OPFS usage |
| Spatial Canvas primary view | Tab-based DOM layout | Entirely different UI paradigm |
| Web Workers for AI | Cloud API calls from main thread | Not needed (no local AI) |
| Desktop Agent / Takus Bridge | Browser `getDisplayMedia` only | Future feature |
| Multilingual | English only | Future feature |
| Inbox / "Read-to-Ingest" | Implemented: raw→processing→active lifecycle + Auto-Read rules | Fully operational |

### Core Principle (Adapted for Current Architecture)

**Everything is a node.** Content enters via screen capture, file upload, document import, or app integration. AI processing runs automatically on the primary recording flow. The autonomy engine handles background intelligence (embedding, similarity, closeness, goal health, task-goal linking, well-being). Cloud sync preserves knowledge across sessions. Goals, tasks, and recordings are graph nodes connected by typed edges.

### Actual Data Model

```
TakusDB (IndexedDB v7)
├── recordings      — Recording metadata, tasks, AI summaries
├── blobs           — Raw video Blob storage
├── embeddings      — AI transcript vector embeddings
├── settings        — User preferences (key-value)
├── recovery        — Crash recovery chunks
├── vaultSync       — Cloud sync state tracking
├── wiki            — Living wiki entries
├── contacts        — People / Knowledge Source contacts
├── interactions    — Contact interaction events
├── content_items   — Content with knowledge levels (L0–L4)
├── engagement_events — Engagement tracking
├── edges           — Knowledge graph edges (6 types)
└── step_checkpoints — Step executor crash recovery (v7)
```

### Actual Processing Pipeline

```
User captures recording → MediaRecorder → IDB blob
        ↓
  Recording pipeline:
    1. FFmpeg WASM → extract audio
    2. Cloud AI API → transcribe (Whisper/Gemini)
    3. Cloud AI API → summarize + extract tasks
    4. Compute analytics (filler words, quality score)
    5. Generate embeddings for semantic search
    6. Create MENTIONED_IN edges for detected contacts
    7. Write content_item for knowledge level pipeline
        ↓
   Autonomy engine (background, requestIdleCallback):
    1. Auto-embed unprocessed transcripts
    2. Auto-compute similarity edges between recordings
    3. Recompute closeness scores (24h cycle)
    4. Resolve knowledge levels (L0–L4)
    5. Archive scan (if feature flag enabled)
    5b. Auto-link tasks → goals (keyword matching)
    6. Proactive quota monitoring (80% threshold)
    7. Well-being check (break, task, meeting, goal health)
```

### Actual Module Architecture

```
src/
├── components/     — 35 UI modules (direct DOM management)
│   ├── app-shell.js           — State router (1,320 lines)
│   ├── history-panel.js       — Recording list + search
│   ├── global-tasks-panel.js  — Cross-recording task dashboard
│   ├── contacts-panel.js      — People + closeness scores
│   ├── insights-panel.js      — Analytics + intelligence cards
│   ├── connect-panel.js       — Apps dashboard (5 integrations)
│   └── settings-panel.js      — Config + Labs feature flags
├── lib/            — 84 business logic modules (including graph, integrations)
│   ├── state-machine.js       — 9-state recording FSM
│   ├── recorder.js            — MediaRecorder wrapper
│   ├── recording-pipeline.js  — AI processing orchestrator + Read-to-Ingest + evaluateAutoRead
│   ├── step-executor.js       — Autonomous task step engine (cycle detection, checkpointing)
│   ├── autonomy-engine.js     — 7-step background intelligence loop
│   ├── storage.js             — IndexedDB (14 stores, v8)
│   ├── goal-linker.js         — Task→Goal linking + progress computation
│   ├── wellbeing.js           — Well-being service (break, task load, meeting fatigue, focus)
│   ├── embeddings.js          — Vector search with pre-filter
│   ├── knowledge-level.js     — L0–L4 classification (L3 = "Surfaced")
│   ├── closeness-score.js     — Contact scoring (30-day window)
│   ├── preference-engine.js   — RL signal collection (10 types: 7 task/search + 3 goal lifecycle)
│   ├── blind-spot-detector.js — Confirmation bias detection
│   ├── archive-engine.js      — Condensed packages + restore flow
│   ├── document-adapter.js    — Non-recording content ingestion
│   ├── auto-read-rules.js     — Auto-Read rule engine (by type/source/title/participant)
│   ├── notification-manager.js — 3-tier notifications
│   ├── events.js              — Centralized event constants
│   └── integrations/          — Slack, GitHub, Linear, Jira, Notion
├── apps/           — 12 app ecosystem modules (goals, etc.)
└── styles/         — 7 CSS files (dark theme, responsive)
```

---

## The "Read-to-Ingest" Principle

> **Status:** `[IMPLEMENTED]` — Full state lifecycle, inbox UI, process button, document adapter, and Auto-Read rules engine are all in place. The Read-to-Ingest principle is fully operational.

### Current Behavior

When a recording is captured, `recording-pipeline.js` immediately runs the full AI pipeline (transcribe → summarize → extract tasks → embed). The `state` field on recordings defaults to `active`. However, `processRawRecording()` now enables an explicit inbox workflow: recordings can be stored as `raw` and processed only when the user explicitly triggers it.

For document ingestion, `document-adapter.js` allows non-recording content (text, markdown, meeting notes) to be imported directly into the knowledge graph with AI summarization and embedding generation.

### State Lifecycle

| State | Description | Status |
|---|---|---|
| `raw` | Stub with metadata only, not processed | `[IMPLEMENTED]` — schema-validator validates; processRawRecording gates pipeline |
| `processing` | AI pipeline running | `[IMPLEMENTED]` — persisted state during pipeline execution; auto-reverts to raw on failure |
| `active` | Fully processed | `[IMPLEMENTED]` — default state for all recordings |
| `condensed` | Storage-optimized | `[IMPLEMENTED]` — archive-engine creates condensed packages |
| `archived` | Removed from active views | `[IMPLEMENTED]` — ArchiveStatus.ARCHIVED + restoreRecording() for recovery |

### Remaining Work

1. ~~Add `state` field to recording schema~~ → Done (`schema-validator.js`)
2. ~~Add `raw` rendering in `history-panel.js`~~ → Done (faint cards, inbox banner, "Process" button, state badges)
3. ~~Gate `recording-pipeline.js` to only run when `state !== 'raw'`~~ → Done (`processRawRecording()`)
4. ~~Add "Auto-Read" rules in settings (by source, by contact)~~ → Done (`auto-read-rules.js` — rules by type, source, title, participant)
5. ~~Document ingestion for non-recording content~~ → Done (`document-adapter.js`)

---

## Validation Summary: Discrepancies Found

| # | Spec Claim | Codebase Reality | Severity | Status |
|---|---|---|---|---|
| 1 | CRDT graph with Yjs sharding | IndexedDB v7, no CRDTs | **Major** | Accepted — IDB is the correct layer |
| 2 | Spatial canvas as primary UI | Tab-based DOM layout | **Major** | Accepted — Different paradigm |
| 3 | WebGPU / local Whisper | Cloud AI (OpenAI/Gemini) BYOK | **Major** | Accepted — Phase 4 vision item |
| 4 | Desktop agent / WebSocket | Browser getDisplayMedia only | **Medium** | Accepted — Phase 4 vision item |
| 5 | OPFS for media storage | IDB blobs + cloud drive | **Medium** | Accepted — IDB is sufficient |
| 6 | WebRTC device sync | Cloud drive vault sync | **Medium** | Accepted — Phase 4 vision item |
| 7 | Multilingual support | English only | **Medium** | Accepted — Phase 4 vision item |
| 8 | ~~Inbox / "raw" state~~ | ~~Not built~~ | ~~**Low**~~ | ✅ **FIXED** — `state` field + `processRawRecording()` |
| 9 | ~~Cycle detection in step deps~~ | ~~No validation~~ | ~~**Low**~~ | ✅ **FIXED** — `detectCycles()` + `validateSteps()` |
| 10 | ~~Archive restore flow~~ | ~~No restore mechanism~~ | ~~**Low**~~ | ✅ **FIXED** — `restoreRecording()` |
| 11 | ~~Step retry/escalation~~ | ~~Failed steps block dependents~~ | ~~**Low**~~ | ✅ **FIXED** — `getDependencyStatus()` + auto-skip |
| 12 | ~~L3 naming ("Endorsed")~~ | ~~Implies active endorsement~~ | ~~**Cosmetic**~~ | ✅ **FIXED** — Renamed to "Surfaced" |

> **5 of 12 discrepancies resolved.** The remaining 7 are architectural differences (Major/Medium) that represent deliberate design choices — they are not bugs but documented deviations from the original speculative design.

---

## Implementation Transformation Plan

Based on the validated spec, the following improvements are prioritized by impact and feasibility for the current codebase:

### Phase 1: Hardening (Immediate — No Architecture Changes) ✅ COMPLETE

| Item | Module | Status | Tests |
|---|---|---|---|
| ~~Add cycle detection in `createStep()`~~ | `step-executor.js` | ✅ `detectCycles()` + `validateSteps()` | +4 |
| ~~Add retry counter + auto-escalate for failed steps~~ | `step-executor.js` | ✅ `getDependencyStatus()` + auto-skip | +7 |
| ~~Add `RESTORED` to `ArchiveStatus` enum~~ | `archive-engine.js` | ✅ Added | existing |
| ~~Rename L3 from "Endorsed" to "Surfaced"~~ | `knowledge-level.js` | ✅ Label + description + comment | +0 (updated) |
| ~~Add quota monitoring trigger~~ | `autonomy-engine.js` | ✅ `_checkStorageQuota()` at 80% | — |
| ~~Cap steps per task at 50~~ | `step-executor.js` | ✅ `MAX_STEPS_PER_TASK` + validation | +1 |

> **Result:** 611 → 626 tests (+15), build clean at 461 KB / 120 KB gzip.

### Phase 2: Resilience (Short-term — Incremental) ✅ COMPLETE

| Item | Module | Status | Detail |
|---|---|---|---|
| ~~Persist step execution state to IDB~~ | `step-executor.js`, `storage.js` | ✅ | IDB v7 `step_checkpoints` store + `runWithCheckpoint()` + `resumeCheckpoints()` |
| ~~Add "rebuild from cloud" function~~ | `cloud-provider.js` | ✅ | `rebuildFromCloud()` — clears local IDB → re-imports from cloud vault |
| ~~Batched rendering for history list~~ | `history-panel.js` | ✅ | `requestAnimationFrame` batch rendering (15 items/batch) for lists >30 items |
| ~~Add `state` field to recording schema~~ | `schema-validator.js` | ✅ | 5 valid states: `raw`, `processing`, `active`, `condensed`, `archived` (+3 tests) |

> **Result:** 626 → 629 tests (+3), IDB schema v6→v7, build 464 KB / 120 KB gzip, version 0.14.0, SW cache v40.

### Phase 3: Features (Medium-term — New Capabilities) ✅ COMPLETE

| Item | Module | Status | Detail |
|---|---|---|---|
| ~~Read-to-Ingest / Inbox~~ | `recording-pipeline.js` | ✅ | `processRawRecording()` — raw→processing→active with error revert |
| ~~Archive restore flow~~ | `archive-engine.js` | ✅ | `restoreRecording()` — downloads video + artefacts from cloud, audit trail |
| ~~Step-level checkpointing~~ | `autonomy-engine.js` | ✅ | `_resumeInterruptedSteps()` wired to startup; uses Phase 2 `resumeCheckpoints()` |
| ~~Document ingestion~~ | `document-adapter.js` [NEW] | ✅ | `ingestDocument()` + `extractTextFromFile()` with AI summary + embeddings |

> **Result:** 629 → 658 tests (+29), 48 test files, build 474 KB / 123 KB gzip.

### Phase 4: Vision (Long-term — Architecture Evolution)

| Item | Description | Prerequisite |
|---|---|---|
| Desktop agent ("Takus Bridge") | Virtual display + local WebSocket → PWA | Electron/Tauri wrapper |
| Local AI inference | WASM Whisper fallback for offline | WebGPU maturity |
| Multi-device sync | Shared cloud state + conflict resolution | Comprehensive vault sync |
| Multilingual knowledge | Translation steps + multilingual embeddings | AI pipeline refactor |
| Unified pipeline + task engine | Merge recording-pipeline into step-executor | Step checkpointing complete |

> **Note:** Phases 1–3 are complete. Post-v0.14 work (Phases 4–92) brought the codebase to 1,676 tests across 103 test files (v0.17.0). Phase 4 Vision items remain aspirational.

---

## Post-v0.14 Capabilities (v0.15–v0.16)

> Phases 4–82 evolved the platform from a screen recorder with AI processing into a full **Adaptive Knowledge OS**. The following sections document the major capability clusters added.

### Goal Preservation Engine

| Capability | Module | Status | Detail |
|---|---|---|---|
| Goal extraction from transcripts | `ai-engine.js` | ✅ | `extractGoals()` — AI-powered detection of goals, commitments, aspirations from any text |
| Goal node lifecycle | `goals/index.js` | ✅ | Full lifecycle: aspiration → active → at-risk → achieved/abandoned |
| Goal health monitoring | `autonomy-engine.js` | ✅ | 30s tick checks goal stagnation against configurable threshold |
| Goal-task linking | `goal-linker.js` | ✅ | `autoLinkTasks()` wired into autonomy tick (Phase 82) |
| Goal progress tracking | `goal-linker.js` | ✅ | `computeGoalProgress()` — task-based progress % surfaced on goal cards |
| Goal analytics | `goals/index.js` | ✅ | `computeGoalAnalytics()` — total/achieved/at-risk/aspiration breakdown |
| Goal preference signals | `goals/index.js` | ✅ | `GOAL_ACTIVATED`, `GOAL_ACHIEVED`, `GOAL_ABANDONED` signals recorded (Phase 82) |

### Well-being Service

| Capability | Module | Status | Detail |
|---|---|---|---|
| Session duration monitoring | `wellbeing.js` | ✅ | `getSessionDuration()` tracks continuous work time |
| Task load assessment | `wellbeing.js` | ✅ | `getTaskLoadHealth()` flags task overload |
| Meeting fatigue detection | `wellbeing.js` | ✅ | `getMeetingFatigue()` analyzes recent meeting density |
| Focus capacity estimation | `wellbeing.js` | ✅ | `estimateFocusCapacity()` composite score: high/medium/low |
| Autonomy-integrated checks | `autonomy-engine.js` | ✅ | Passes goals, tasks, and recordings for comprehensive assessment (Phase 82) |
| Wellbeing dashboard card | `insights-panel.js` | ✅ | Focus gauge, break suggestions, task load indicators |
| Daily digest integration | `daily-digest.js` | ✅ | Wellbeing section in daily digest with goal health |

### Adaptive Intelligence

| Capability | Module | Status | Detail |
|---|---|---|---|
| Preference signal capture | `preference-engine.js` | ✅ | 10 signal types (7 task + 3 goal lifecycle) |
| Adaptive AI prompts | `ai-engine.js` | ✅ | `_buildAdaptiveHint()` injects user preferences + active goals into AI prompts (Phase 82) |
| Task priority scoring | `task-priority.js` | ✅ | `getScoringAdjustments()` feeds preference signals into scoring |
| Blind spot detection | `blind-spot-detector.js` | ✅ | 4 bias patterns: ignored categories, tunnel vision, stale contacts, recency bias |
| Dissent & open questions | `ai-engine.js` | ✅ | Configurable dissent section in meeting summaries |
| Knowledge health scoring | `knowledge-framework.js` | ✅ | Fact/decision/assumption/question classification + risk scoring |

### App Platform (WordPress Model)

| Capability | Module | Status | Detail |
|---|---|---|---|
| App interface contract | `app-interface.js` | ✅ | Lifecycle hooks, settings schemas, platform service injection |
| App manager orchestration | `app-manager.js` | ✅ | Dependency resolution, namespaced settings, activation lifecycle |
| 11 registered apps | `registry.js` | ✅ | Recorder, History, Tasks, Insights, Settings, Goals, People, DigestApp, InboxApp, TemplatesApp, ShortcutsApp |
| Autonomy step registration | `app-interface.js` | ✅ | Apps register step types for the autonomy engine |
| App-scoped storage | `app-manager.js` | ✅ | Namespaced IDB settings per app |

### Monolith Decomposition (v0.15→v0.16)

| Change | Impact |
|---|---|
| AppShell thinned by ~44% | Extracted recording pipeline, history rendering, and settings to dedicated modules |
| Recording pipeline standalone | `recording-pipeline.js` — autonomous post-recording orchestration |
| 73 test files (from 48) | +25 test files added during decomposition |
| 1,676 tests (from 658) | +1,018 tests across new and existing modules |
| Bundle size stable | 574 KB / 150 KB gzip (controlled growth despite 2× test coverage) |

### Infrastructure Hardening

| Capability | Module | Status |
|---|---|---|
| Rate limiting | `rate-limiter.js` | ✅ — Per-provider API rate limits (OpenAI 10/min, Gemini 30/min) |
| Schema validation | `schema-validator.js` | ✅ — Auto-repair on read, 5 valid recording states |
| Pipeline-as-steps | `recording-pipeline.js` | ✅ — 7 named steps with status tracking and error isolation |
| Health checks | `health-check.js` | ✅ — IndexedDB, storage quota, service worker, API key validation |
| Approval center | `approval-center.js` | ✅ — Governance layer for autonomous actions |
| Activity timeline | `activity-timeline.js` | ✅ — 7-day event history with icon-based rendering |
| Offline action queue | `offline-queue.js` | ✅ — Queue actions when offline, replay on reconnect |
| Keyboard shortcuts | `shortcuts/` | ✅ — Platform-aware shortcuts with customization |
| Recording templates | `recording-templates.js` | ✅ — Pre-configured recording types with auto-run rules |
