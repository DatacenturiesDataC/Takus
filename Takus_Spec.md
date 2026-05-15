# Deep Evaluation & Normalization of the Takus Design

> **Document Status:** Validated against Takus codebase v0.13.2 (2026-05-15).
> Each section is annotated with `[IMPLEMENTED]`, `[PARTIAL]`, `[NOT IMPLEMENTED]`, or `[PROPOSAL]` tags indicating the current state relative to the live codebase. Takus has **not** been deployed to production yet.

---

## 1. Logical Soundness

Overall assessment: The architecture forms a coherent directed acyclic graph (ingest → transform → store → query/act) with clear feedback loops. However, several logical inconsistencies exist.

- **Knowledge levels (L0–L4)** are well-ordered but the concept of "close contact" for L3 is recursive: a contact's engagement makes them close, but we also need closeness to weight that engagement. This circularity is mitigated by using a 30-day interaction window that computes closeness independently of L3 status. The logic holds if we strictly compute closeness from L0–L2 interactions only.
  - `[IMPLEMENTED]` — `closeness-score.js` uses a configurable `daysBack` (default 30) rolling window. `knowledge-level.js` computes L3 using `isCloseContact()` (threshold ≥65) plus engagement signals. Closeness is computed from raw interaction types (DM, meeting, sharedTask, mention) — independent of knowledge levels, avoiding circularity.

- **Autonomous task steps with dependencies** can create deadlocks if step A depends on B and B depends on A. The design must detect and reject cycles at step creation time. This is missing.
  - `[NOT IMPLEMENTED]` — `step-executor.js` checks `areDependenciesMet()` at runtime but does **not** validate for cycles at step creation time. `createStep()` accepts arbitrary `dependsOn` arrays without validation.

- **Archiving with cold storage then deletion** is logically sound, but the state machine needs an explicit "restored" state that rehydrates the original content without creating duplicate nodes.
  - `[PARTIAL]` — `archive-engine.js` defines `ArchiveStatus = { ACTIVE, PENDING, COLD, ARCHIVED }` but has **no** `RESTORED` state. The restore path is not implemented. Condensing (key-frame extraction, transcript retention) is implemented. Original video deletion after cold-storage grace period is not implemented.

- **Device continuity via CRDT** plus cloud relay is logically possible only if the CRDT document size stays within practical limits (a few MB). Embedding millions of nodes will bloat the sync file; the design must partition the graph (e.g., by time) or use a hybrid model.
  - `[NOT IMPLEMENTED]` — Takus uses **IndexedDB** (11 object stores, v6 schema) as the local data layer and cloud drive folder sync (`Takus/recordings/YYYY-MM/{id}/`) for cross-device continuity. There is **no CRDT** (no Yjs dependency), **no WebRTC sync**, and **no graph sharding**. Device sync relies on the cloud provider's vault sync mechanism (`cloud-provider.js`).

- **Confirmation bias mitigation** is logically an advisory layer, not an active filter. It must never override user decisions; this boundary is clear but must be enforced in UI prompts.
  - `[IMPLEMENTED]` — `blind-spot-detector.js` is a pure computation module (no side effects) that detects 4 bias patterns (ignored categories, single-source tunnel vision, stale contacts, recency bias). Results are displayed as advisory "Blind Spots" cards in the Insights panel. The module never modifies user data or overrides decisions. Gated behind the `blindSpots` feature flag.

**Refinement:** Add cycle detection in step dependencies. Make archiving state explicit: active → archived → (restored → active) or deleted. ~~Partition the CRDT graph into shards~~ → Not applicable; current architecture uses IndexedDB + cloud folder sync, not CRDTs.

---

## 2. Normalization (Data Model & Redundancy)

The current model uses a graph (nodes + edges) with properties stored as JSON. This is flexible but can lead to data redundancy and inconsistency.

- **Task steps are embedded inside the task node.** This is fine for a document-oriented database but risks large objects when a task has many steps.
  - `[IMPLEMENTED]` — Tasks are stored in the `recordings` store as a `tasks` array property on recording objects. Steps are embedded as `steps` arrays within each task object. No separate store exists for steps. The step-executor supports `dependsOn` relationships within a single task's step array. There is no enforced cap on step count.

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
  - `[PARTIAL]` — Takus has a service worker (`public/sw.js`, cache v39) for **offline caching and PWA installation** only. It does **not** use `PeriodicBackgroundSync` or `BackgroundFetch`. Background processing uses `requestIdleCallback` in the main thread (`autonomy-engine.js`) with `visibilitychange` pausing. This works across all modern browsers.

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
  - `[PARTIAL]` — `schema-validator.js` validates records on every IDB read and auto-repairs malformed fields. `clearAllRecordings()` provides a manual reset across 6 stores. There is **no** automatic rebuild-from-cloud mechanism. The `_db.onclose` handler in `storage.js` invalidates the connection cache for reconnection.

- **Archiving and cold storage:** If the cold storage retention expires and the user attempts to restore, the restoration must fail gracefully.
  - `[NOT IMPLEMENTED]` — No cold storage expiry or restore mechanism exists. Archive engine creates condensed packages but does not implement a restore flow.

- **Autonomous task steps:** If a step fails repeatedly, it must not block dependent steps indefinitely.
  - `[PARTIAL]` — `step-executor.js` marks failed steps with `status: 'failed'` and records the error. `runPendingSteps()` skips failed steps. However, dependent steps remain `pending` forever if their dependency fails — there is **no** auto-skip, retry limit, or escalation mechanism.

**Refinement:** Add a retry counter + auto-escalate to `step-executor.js`. ~~Watchdog for desktop agent streams~~ → Not applicable. The recovery system is effective for its current scope. A "rebuild from cloud" function would be valuable but requires the vault sync to be comprehensive (currently it syncs metadata, not full recordings back to IDB).

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
  - `[PARTIAL]` — `navigator.storage.persist()` is requested on first IDB open. `navigator.storage.estimate()` is used in `feedback-engine.js` for diagnostics and in `insights-panel.js` for display. There is **no** proactive archiving trigger based on quota monitoring. OPFS is **not used** — all storage is IndexedDB + cloud drive.

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
| Knowledge Level L0–L4 | L3 "Endorsed" could imply active endorsement. | `[IMPLEMENTED]` — L3 labeled "Endorsed" in `knowledge-level.js` | Rename L3 to "Surfaced by close contacts" |
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
  - `[MITIGATED]` — Both `preference-engine.js` (RL signals) and `blind-spot-detector.js` (bias detection) are gated behind feature flags (`adaptiveAI`, `blindSpots`). They are opt-in via Settings → Labs. The preference engine collects 8 signal types but the system degrades gracefully if disabled.

- **Duplication of logic:** The transformation pipeline overlaps with autonomous task steps.
  - `[ACKNOWLEDGED — INTENTIONAL]` — `recording-pipeline.js` handles the primary recording flow (direct AI calls), while `step-executor.js` handles arbitrary task step graphs. The architecture comment in `step-executor.js` (lines 6–12) explicitly documents this as an intentional separation: the pipeline is optimized for the single-recording happy path, while the step executor handles dependency resolution for complex workflows.

- **Too many states:** Task steps have many statuses.
  - `[IMPLEMENTED]` — Steps use 6 statuses: `pending`, `queued`, `executing`, `completed`, `failed`, `waiting_input`. The step-executor state machine is linear (pending → executing → completed/failed) with a `waiting_input` branch for approval gates. Tasks themselves use a simpler tri-state model: `pending`, `done`, `ignored`.

- **API surface:** The number of modules can be reduced by merging similar functions.
  - `[CURRENT STATE]` — 93 modules total (29 components, 40 libs + 5 integrations, 46 test files, 7 style files). Cloud operations are split across provider-specific modules (`google-drive.js`, `microsoft-onedrive.js`, etc.) which is appropriate given the different APIs. The `cloud-provider.js` abstraction layer unifies the interface.

**Refinement:** ~~Merge pipeline into task engine~~ — The current intentional separation is pragmatic for a pre-production codebase. Merging should be considered only when sub-step execution becomes a user-facing feature beyond the recording flow. The main efficiency win would be unifying the duplicate pipeline+step-executor AI calls behind a shared service layer.

---

## Final Normalized Takus Architecture

### What the Spec Proposes vs. What Exists

| Spec Concept | Current Reality | Gap |
|---|---|---|
| "Everything is a task" | Recording pipeline + step executor are separate | Intentional; merge is a future option |
| CRDT graph sharded by year | IndexedDB v6 with 11 object stores | Fundamentally different architecture |
| Yjs maps for nodes/edges | `edges` store in IDB with compound indexes | Lightweight but functional |
| Knowledge level = computed | Computed by `knowledge-level.js`, stored on `content_items` | Close to spec intent |
| Cloud metadata = regenerable cache | Cloud `metadata.json` written on upload | Metadata is authoritative on cloud, computed locally |
| OPFS for media | IDB `blobs` store + cloud drive | No OPFS usage |
| Spatial Canvas primary view | Tab-based DOM layout | Entirely different UI paradigm |
| Web Workers for AI | Cloud API calls from main thread | Not needed (no local AI) |
| Desktop Agent / Takus Bridge | Browser `getDisplayMedia` only | Future feature |
| Multilingual | English only | Future feature |
| Inbox / "Read-to-Ingest" | All recordings processed immediately | Future feature |

### Core Principle (Adapted for Current Architecture)

**Everything is a recording.** Content enters via screen capture, file upload, or drag-and-drop. AI processing runs automatically on the primary recording flow. The autonomous task engine handles background intelligence (embedding, similarity, closeness recomputation). Cloud sync preserves recordings across sessions.

### Actual Data Model

```
TakusDB (IndexedDB v6)
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
└── edges           — Knowledge graph edges (6 types)
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
    • Auto-embed unprocessed transcripts
    • Compute similarity edges between recordings
    • Recompute closeness scores (24h cycle)
    • Resolve knowledge levels (L0–L4)
    • Archive scan (if feature flag enabled)
```

### Actual Module Architecture

```
src/
├── components/     — 29 UI modules (direct DOM management)
│   ├── app-shell.js           — State router (1,320 lines)
│   ├── history-panel.js       — Recording list + search
│   ├── global-tasks-panel.js  — Cross-recording task dashboard
│   ├── contacts-panel.js      — People + closeness scores
│   ├── insights-panel.js      — Analytics + intelligence cards
│   ├── connect-panel.js       — Apps dashboard (5 integrations)
│   └── settings-panel.js      — Config + Labs feature flags
├── lib/            — 40 business logic modules
│   ├── state-machine.js       — 9-state recording FSM
│   ├── recorder.js            — MediaRecorder wrapper
│   ├── recording-pipeline.js  — AI processing orchestrator
│   ├── step-executor.js       — Autonomous task step engine
│   ├── autonomy-engine.js     — Background intelligence loop
│   ├── storage.js             — IndexedDB (11 stores, v6)
│   ├── embeddings.js          — Vector search with pre-filter
│   ├── knowledge-level.js     — L0–L4 classification
│   ├── closeness-score.js     — Contact scoring (30-day window)
│   ├── preference-engine.js   — RL signal collection (8 types)
│   ├── blind-spot-detector.js — Confirmation bias detection
│   ├── archive-engine.js      — Condensed package generation
│   ├── notification-manager.js — 3-tier notifications
│   ├── events.js              — Centralized event constants
│   └── integrations/          — Slack, GitHub, Linear, Jira, Notion
└── styles/         — 7 CSS files (dark theme, responsive)
```

---

## The "Read-to-Ingest" Principle

> **Status:** `[PROPOSAL]` — None of this is implemented. Currently, all recordings are processed immediately upon capture.

### Current Behavior

When a recording is captured or a file is uploaded, `recording-pipeline.js` immediately runs the full AI pipeline (transcribe → summarize → extract tasks → embed). There is no "raw" or "inbox" state. Every recording enters the knowledge graph immediately.

### Proposed Enhancement

The "Read-to-Ingest" model proposes adding a `state` field to recording nodes:

| State | Description | Current Status |
|---|---|---|
| `raw` | Stub with metadata only, not processed | `[NOT IMPLEMENTED]` |
| `processing` | AI pipeline running | `[IMPLICIT]` — exists during pipeline execution but not as a persisted state |
| `active` | Fully processed | `[IMPLICIT]` — all completed recordings are in this state |
| `condensed` | Storage-optimized | `[PARTIAL]` — `archive-engine.js` supports this |
| `archived` | Removed from active views | `[PARTIAL]` — `ArchiveStatus.ARCHIVED` exists |

### Feasibility Assessment

This proposal is **viable and valuable** for Takus, particularly when:
- Bulk file uploads are added (drag-and-drop multiple files)
- External document ingestion is added (Google Drive folder watching)
- Email/calendar integration creates automatic recording stubs

For the current single-recording capture flow, immediate processing is the correct behavior (the user explicitly initiated the recording).

### Implementation Path

1. Add `state` field to recording schema (`schema-validator.js`)
2. Add `raw` rendering in `history-panel.js` (faint cards, "Process" button)
3. Gate `recording-pipeline.js` to only run when `state !== 'raw'`
4. Add "Auto-Read" rules in settings (by source, by contact)
5. Add Inbox view (filtered list of `state === 'raw'` recordings)

---

## Validation Summary: Discrepancies Found

| # | Spec Claim | Codebase Reality | Severity |
|---|---|---|---|
| 1 | CRDT graph with Yjs sharding | IndexedDB v6, no CRDTs | **Major** — Spec assumes wrong data layer |
| 2 | Spatial canvas as primary UI | Tab-based DOM layout | **Major** — Entirely different UI paradigm |
| 3 | WebGPU / local Whisper | Cloud AI (OpenAI/Gemini) BYOK | **Major** — Different AI architecture |
| 4 | Desktop agent / WebSocket | Browser getDisplayMedia only | **Medium** — Future feature, not current |
| 5 | OPFS for media storage | IDB blobs + cloud drive | **Medium** — Different storage strategy |
| 6 | WebRTC device sync | Cloud drive vault sync | **Medium** — Different sync mechanism |
| 7 | Multilingual support | English only | **Medium** — Not implemented |
| 8 | Inbox / "raw" state | All recordings processed immediately | **Low** — Valid proposal, not built yet |
| 9 | Cycle detection in step deps | No validation at creation time | **Low** — Missing validation |
| 10 | Archive restore flow | No restore mechanism | **Low** — Feature gap |
| 11 | Step retry/escalation | Failed steps block dependents | **Low** — Missing resilience |
| 12 | L3 naming ("Endorsed") | Could imply active endorsement | **Cosmetic** — Rename candidate |

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

### Phase 3: Features (Medium-term — New Capabilities)

| Item | Modules | Effort | Impact |
|---|---|---|---|
| Read-to-Ingest / Inbox view | `history-panel.js`, `recording-pipeline.js` | Large | Resource efficiency for bulk ingest |
| Archive restore flow | `archive-engine.js`, `recording-detail.js` | Medium | Complete archive lifecycle |
| Step-level checkpointing | `step-executor.js`, `recording-pipeline.js` | Large | Resumable long-running tasks |
| Document ingestion (non-recording) | New `document-adapter.js` | Large | Expands content types |

### Phase 4: Vision (Long-term — Architecture Evolution)

| Item | Description | Prerequisite |
|---|---|---|
| Desktop agent ("Takus Bridge") | Virtual display + local WebSocket → PWA | Electron/Tauri wrapper |
| Local AI inference | WASM Whisper fallback for offline | WebGPU maturity |
| Multi-device sync | Shared cloud state + conflict resolution | Comprehensive vault sync |
| Multilingual knowledge | Translation steps + multilingual embeddings | AI pipeline refactor |
| Unified pipeline + task engine | Merge recording-pipeline into step-executor | Step checkpointing complete |

> **Note:** Phases 3–4 should be revisited after Takus reaches production and real user feedback is collected. The "everything is a task" unification is architecturally elegant but premature for a pre-production codebase with a working, tested pipeline.
