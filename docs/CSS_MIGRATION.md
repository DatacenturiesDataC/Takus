# CSS Token Migration Guide

> **Status**: Active — legacy aliases still in use across the codebase.
> **Source of truth**: `src/styles/tokens.css` (sections 1–7 = canonical tokens)

## Overview

The design token system was refactored to canonical names (e.g. `--bg-primary`,
`--text-secondary`, `--accent-primary`). ~50 legacy aliases remain in
`tokens.css` lines 237–307 to avoid breaking existing components. This document
tracks which files still reference each legacy alias so they can be migrated
incrementally.

## Migration Instructions

1. **Find** the legacy token in the table below.
2. **Replace** `var(--legacy-name)` → `var(--canonical-name)` in each listed file.
3. **Test** the component visually (light + dark mode).
4. Once **zero files** reference a legacy token, remove its alias from `tokens.css`.

> [!IMPORTANT]
> Migrate one token at a time. Run a visual diff in both light and dark themes
> before committing — some aliases map differently (e.g. `--color-bg-surface` →
> `--bg-hover`, not `--bg-tertiary`).

---

## Legacy Color Tokens

| Legacy Token | Canonical Equivalent | Files Using Legacy Token |
|---|---|---|
| `--color-bg-deep` | `--bg-primary` | `src/styles/index.css`, `src/components/setup-wizard.js` |
| `--color-bg-base` | `--bg-secondary` | `src/styles/index.css` |
| `--color-bg-surface` | `--bg-hover` | `src/styles/index.css` (×6), `src/components/setup-wizard.js` (×2), `src/components/ask-panel.js` |
| `--color-bg-elevated` | `--bg-elevated` | `src/styles/index.css` (×4), `src/components/setup-wizard.js` (×2) |
| `--color-bg-hover` | `--bg-hover` | `src/styles/components.css` |
| `--color-bg-active` | `--bg-active` | *(no direct usages found outside tokens.css)* |
| `--color-primary` | `--accent-primary` | `src/styles/index.css` (×6), `src/styles/mobile.css` (×2), `src/styles/components.css`, `src/components/settings-utils.js`, `src/components/setup-wizard.js` |
| `--color-primary-light` | `--accent-primary` | `src/styles/index.css` (×9), `src/styles/animations.css`, `src/styles/tasks.css`, `src/styles/controls.css`, `src/styles/components.css` (×5), `src/styles/mobile.css`, `src/components/review-panel.js` (×3), `src/components/setup-wizard.js` (×3), `src/components/ask-panel.js` (×2), `src/lib/edge-types.js` |
| `--color-primary-dim` | `--accent-bg` | `src/styles/index.css` (×5), `src/components/setup-wizard.js` |
| `--color-secondary` | `--color-info` | `src/styles/index.css` |
| `--color-accent-gradient` | `linear-gradient(135deg, var(--accent-primary), var(--color-info))` | `src/styles/tasks.css`, `src/styles/components.css`, `src/components/setup-wizard.js` |
| `--color-success-dim` | `--color-success-bg` | *(no direct usages found outside tokens.css)* |
| `--color-danger-dim` | `--color-danger-bg` | *(no direct usages found outside tokens.css)* |
| `--color-warning-dim` | `--color-warning-bg` | *(no direct usages found outside tokens.css)* |
| `--color-info-dim` | `--color-info-bg` | *(no direct usages found outside tokens.css)* |
| `--color-error` | `--color-danger` | `src/styles/index.css` (×2), `src/components/setup-wizard.js`, `src/lib/content-pipeline.js`, `src/apps/goals/index.js` (×3) |
| `--color-recording` | `#ef4444` (hardcoded) | `src/styles/components.css`, `src/components/recorder-panel.js`, `src/components/auto-record-notification.js` (×2) |
| `--color-recording-glow` | `rgba(239, 68, 68, 0.4)` (hardcoded) | `src/styles/animations.css`, `src/styles/tokens.css` (internal ref) |
| `--color-text-primary` | `--text-primary` | `src/styles/index.css` (×8), `src/styles/entry-detail.css` (×2), `src/styles/tasks.css` (×2), `src/styles/components.css` |
| `--color-text-secondary` | `--text-secondary` | `src/styles/index.css` (×8), `src/styles/entry-detail.css` (×2), `src/styles/tasks.css` (×4), `src/styles/components.css` |
| `--color-text-muted` | `--text-muted` | `src/styles/index.css` (×6), `src/styles/entry-detail.css`, `src/styles/tasks.css` (×5) |
| `--color-text-disabled` | `--text-disabled` | `src/styles/index.css` (×12), `src/styles/entry-detail.css`, `src/styles/tasks.css` (×5) |
| `--color-text-tertiary` | `--text-muted` | *(no direct usages found outside tokens.css)* |
| `--color-border` | `--border-default` | `src/styles/index.css` (×4), `src/styles/animations.css`, `src/styles/components.css` |
| `--color-border-strong` | `--border-strong` | `src/styles/index.css` (×2), `src/styles/components.css` |
| `--color-surface-hover` | `--bg-hover` | `src/components/sidebar.js` (×5) |

## Legacy Typography Tokens

| Legacy Token | Canonical Equivalent | Files Using Legacy Token |
|---|---|---|
| `--font-xs` | `--text-2xs` (11px) | `src/styles/index.css` (×25+), `src/styles/entry-detail.css` (×3), `src/styles/tasks.css` (×5) |
| `--font-sm` | `--text-xs` (12px) | `src/styles/index.css` (×15+), `src/styles/entry-detail.css`, `src/styles/tasks.css` (×2) |
| `--font-base` | `--text-sm` (13px) | `src/styles/index.css` (×2), `src/styles/entry-detail.css` |
| `--font-lg` | `--text-base` (14px) | `src/styles/index.css` (×2) |
| `--font-xl` | `--text-md` (16px) | *(no direct usages found outside tokens.css)* |
| `--font-2xl` | `--text-lg` (20px) | `src/styles/index.css` (×2) |
| `--font-3xl` | `--text-xl` (24px) | `src/components/auto-record-notification.js` |
| `--font-4xl` | `--text-2xl` (32px) | *(no direct usages found outside tokens.css)* |
| `--font-5xl` | `--text-2xl` (32px) | `src/styles/index.css` |
| `--weight-light` | `400` (hardcoded) | *(no direct usages found outside tokens.css)* |
| `--weight-semi` | `--weight-semibold` | `src/styles/index.css` (×15+), `src/styles/entry-detail.css` (×3), `src/styles/tasks.css` (×2) |
| `--weight-heavy` | `700` (hardcoded) | `src/components/auto-record-notification.js` |

## Legacy Shadow / Transition / Z-index Tokens

| Legacy Token | Canonical Equivalent | Files Using Legacy Token |
|---|---|---|
| `--shadow-glow` | `0 0 20px var(--accent-bg)` | *(no direct usages found outside tokens.css)* |
| `--shadow-glow-danger` | `0 0 20px var(--color-recording-glow)` | *(no direct usages found outside tokens.css)* |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | `src/styles/index.css` (×4), `src/styles/tasks.css` (×2), `src/styles/animations.css`, `src/styles/controls.css`, `src/styles/components.css` (×8), `src/components/setup-wizard.js`, `src/components/history-panel.js` |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | `src/styles/controls.css`, `src/styles/components.css` (×2) |
| `--duration-fast` | `--transition-fast` | `src/styles/index.css` (×2), `src/styles/tasks.css`, `src/styles/components.css` (×6) |
| `--duration-normal` | `--transition-base` | `src/styles/tasks.css`, `src/styles/components.css` (×2) |
| `--duration-slow` | `--transition-slow` | `src/styles/index.css` (×3), `src/styles/animations.css`, `src/styles/components.css` |
| `--z-base` | `1` (hardcoded) | `src/styles/index.css` |
| `--z-sticky` | `--z-header` | *(no direct usages found outside tokens.css)* |
| `--z-overlay` | `--z-floating` | *(no direct usages found outside tokens.css)* |

## Legacy Glass / Premium Tokens

| Legacy Token | Canonical Equivalent | Files Using Legacy Token |
|---|---|---|
| `--glass-bg` | `--bg-hover` | *(no direct usages found outside tokens.css)* |
| `--glass-border` | `--border-default` | *(no direct usages found outside tokens.css)* |
| `--glass-blur` | `10px` (hardcoded) | *(no direct usages found outside tokens.css)* |
| `--glass-bg-premium` | `--bg-hover` | `src/styles/components.css` |
| `--glass-border-premium` | `--border-default` | `src/styles/index.css` (×2), `src/styles/components.css` (×2) |
| `--glass-blur-premium` | `20px` (hardcoded) | `src/styles/components.css` (×2) |

---

## Quick-Win Tokens (zero usages — safe to remove now)

The following legacy aliases have **no references** outside `tokens.css` itself
and can be deleted immediately:

- `--color-bg-active`
- `--color-success-dim`, `--color-danger-dim`, `--color-warning-dim`, `--color-info-dim`
- `--color-text-tertiary`
- `--font-xl`, `--font-4xl`
- `--weight-light`
- `--shadow-glow`, `--shadow-glow-danger`
- `--z-sticky`, `--z-overlay`
- `--glass-bg`, `--glass-border`, `--glass-blur`
