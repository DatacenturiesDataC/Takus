# 🤝 Contributing to Takus

Thanks for your interest in contributing! Takus is a free, privacy-first Knowledge OS that captures meetings, screens, and documents, then uses AI to build a knowledge graph connecting goals, tasks, people, and decisions.

## Quick Setup

1. **Fork and clone**
   ```bash
   git clone https://github.com/yourusername/takus.git
   cd takus
   ```
2. **Install** — `npm install`
3. **Configure** — set your OAuth Client IDs in `public/config.js` (see [setup-guide.md](setup-guide.md))
4. **Run** — `npm run dev`
5. **Build** — `npm run build`

## Architecture

```
src/
├── main.js              # Bootstrap
├── styles/              # Design system (CSS custom properties)
├── lib/                 # Core libraries (state machine, recorder, cloud APIs, storage)
│   ├── graph/           # Knowledge graph subsystem (task-store, node-registry, vector-utils)
│   └── integrations/    # External service connectors (Slack, GitHub, Linear, Jira, Notion)
├── components/          # UI components (vanilla JS, no framework)
└── apps/                # Pluggable app modules (WordPress-model architecture)
```

Key principles:
- **Zero runtime dependencies** — only Vite for build tooling
- **State machine driven** — recording lifecycle is a finite state machine
- **Vanilla JS** — no framework, ES modules, web standards
- **CSS custom properties** — design tokens for consistent theming
- **WordPress-model architecture** — App Shell + decoupled apps, each self-registering via `app-manager.js`

## Code Style

- Modern JavaScript (ES2020+, ES modules)
- Meaningful variable names, short focused functions
- JSDoc comments for public APIs
- No `var`, prefer `const` over `let`

### Canonical APIs

**Task/Step access** — Always use `task-helpers.js`:
```javascript
import { getTaskTitle, isStepDone, getStepDoneCount, areAllStepsDone, isTaskPending } from '../lib/task-helpers.js';

// ✅ Correct
const title = getTaskTitle(task);
const done = isStepDone(step);

// ❌ Never access directly
const title = task.title;       // use getTaskTitle()
const done = step.status === 'completed';  // use isStepDone()
```

**Time constants** — Always use named exports from `utils.js`:
```javascript
import { MS_PER_HOUR, MS_PER_DAY } from '../lib/utils.js';
// ❌ Never use magic numbers: 86400000, 3600000
```

## Testing

### Automated Tests

Takus uses **Vitest** with JSDOM and fake-indexeddb:

```bash
npm test              # Run all 1,176+ tests (75 files)
npm run test:watch    # Watch mode during development
```

**Adding a new test:**
1. Create `src/lib/__tests__/your-module.test.js`
2. Import from `vitest`: `import { describe, it, expect } from 'vitest'`
3. The setup file (`src/lib/__tests__/setup.js`) auto-loads `fake-indexeddb` and `crypto.subtle` mocks
4. Use `vi.mock()` for modules with side effects (storage, API calls)

**Test patterns:**
- State machine: deterministic transition testing
- Storage: real IndexedDB operations via fake-indexeddb
- AI engine: mock API responses, test extraction logic
- Pure functions: direct input/output assertions

### Manual Testing

- Test in Chrome, Firefox, and Edge
- Test the full recording flow (start → pause → resume → stop → upload)
- Verify cloud upload works with real credentials (Google Drive and/or OneDrive)
- Check different quality settings and long recordings
- Test error states (denied permissions, offline, expired token)

## Pull Requests

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make focused, atomic commits
3. Update documentation if adding features
4. Test thoroughly
5. Submit PR with a clear description of what and why

## Areas for Contribution

- 🌐 Browser compatibility improvements
- 🎨 UI/UX enhancements
- 📊 Recording quality optimizations
- 🛡️ Error handling and resilience
- 📝 Documentation and examples
- ♿ Accessibility improvements
- 🌍 Internationalization

## Security

If you find security issues, email the maintainer directly instead of opening a public issue.

## License

By contributing, your work is licensed under the same MIT license as the project.
