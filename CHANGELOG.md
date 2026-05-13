# Changelog

All notable changes to **Takus** are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.10.0] — 2026-05-13

### Added
- **Meeting Prep Engine** (`src/lib/meeting-prep.js`) — cross-reference calendar events with contacts, past recordings, and open tasks to generate structured preparation packages
- **Daily Digest Generator** (`src/lib/daily-digest.js`) — aggregates recording streak, overdue tasks, weekly stats, and upcoming meetings into a "Today" summary
- **Task Priority Scoring** (`src/lib/task-priority.js`) — deterministic priority engine using weighted formula: deadline urgency (35%) + requester closeness (25%) + task age (20%) + action routing weight (20%)
- **Today Card** in Insights panel — real-time daily digest with streak badge, overdue alerts, completion rate
- **Priority Sort** in Global Tasks — new filter chip + 🔴🟡🔵 priority badges on pending tasks
- **Related Recordings** enhanced — combines embedding cosine similarity with shared participant overlap (up to 5 related)
- **CHANGELOG.md** — full version history from v0.1.0 onwards
- 73 new unit tests: intelligence layer, closeness score, schema validator, identity vault, library import, archive engine

### Changed
- Version bump to 0.10.0
- Service worker cache bumped to v22
- Module count: 71 → 74
- Test count: 176 → 285 (21 files)

### Fixed
- **Watch modal memory leak** — `requestAnimationFrame` now cancelled on cleanup
- **Watch modal accessibility** — added `role="dialog"`, `aria-modal`, `aria-label`, focus management
- **Archive player accessibility** — added ARIA dialog attributes
- **Insights panel performance** — eliminated duplicate IndexedDB read by passing pre-loaded recordings to daily digest
- **Library import crash** — guarded `JSON.parse` with try/catch for corrupt backup files

### Removed
- 3 unused imports (`extractTLDW`, `getAllInteractions`, `computeStreak`)

---

## [0.9.0] — 2026-05-12

### Added
- Pre-production hardening pass
- Utility CSS classes (`text-xs`, `text-muted`, `flex-center`, `gap-*`, `truncate`, etc.)
- Inline style consolidation across all components
- ARIA labels on all tab panels

### Changed
- Consolidated 200+ inline styles into reusable CSS utilities
- Consistent `role="tablist"` / `role="tab"` across all tab bars

---

## [0.8.0] — 2026-05-12

### Added
- **Closeness Worker** — background 24h closeness score recomputation
- **Knowledge Level Badges** (L0–L4) — automatic content classification
- **Embedding Pre-filter** — keyword pruning for faster semantic search
- **Storage API expansion** — contacts, interactions, content items, engagement events
- IndexedDB upgraded to v5

---

## [0.7.0] — 2026-05-11

### Added
- **Task Steps & Objectives** — granular sub-steps and strategic objective alignment
- **Task Analytics** — completion metrics, action breakdown, average time-to-done
- **Objective Grouping** — strategic summary cards in insights panel
- **ZIP Backup** — full library export with videos, metadata, transcripts
- **Shared View** — public read-only summary page for shareable links

### Changed
- Task schema evolved to tri-state model (pending/done/ignored) with mandatory metadata

---

## [0.6.0] — 2026-05-10

### Added
- **Global Tasks Dashboard** — aggregate tasks across all recordings with filters and progress
- **Per-Recording Tasks Panel** — status transitions, dependency indicators, integration routing
- **Connect Panel** — Slack, GitHub, Linear, Jira, Notion integrations with encrypted credential storage
- **Identity Vault** — AES-GCM 256-bit encrypted credential storage

---

## [0.5.0] — 2026-03-10

### Added
- **PWA Support** — installable standalone app with service worker offline caching
- **GIF Export** — FFmpeg WASM-powered animated GIF creation
- **Keyboard Shortcuts** — customizable hotkeys for recording workflow
- **Recording Detail View** — 70/30 split layout with Ask, Summary, Transcript, Tasks tabs
- **Auto-Recording** — calendar-driven automatic recording with configurable rules

---

## [0.4.0] — 2026-03-08

### Added
- **Google Docs / OneNote** — auto-create meeting notes documents
- **Video Watermark** — customizable text overlay on recordings
- **Quality Presets** — 480p / 720p / 1080p video settings
- **Structured Cloud Vault** — `YYYY-MM/{id}/` folder organization

---

## [0.3.0] — 2026-03-06

### Added
- **Video Review Panel** — post-recording trim, GIF extract, approve/discard
- **Device Selection** — camera and microphone choosers
- **Cross-Device Sync** — background vault sync populates local history from cloud

---

## [0.2.0] — 2026-03-04

### Added
- **AI Task Extraction** — auto-extract action items from recordings
- **Ask (Video-RAG)** — semantic search across recordings with embeddings
- **Filler Word Analysis** — speaking quality metrics
- **Activity Heatmap** — recording frequency visualization

---

## [0.1.0] — 2026-03-02

### Added
- Initial release — screen + audio recording with Google Drive upload
- Loom-style floating facecam (Picture-in-Picture)
- OpenAI Whisper transcription + GPT-4o-mini summaries
- Google Calendar auto-linking
- Recording history with IndexedDB persistence
