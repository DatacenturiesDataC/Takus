# 🤝 Contributing to Takus

Thanks for your interest in contributing! Takus is a free, privacy-first screen recorder that saves directly to Google Drive.

## Quick Setup

1. **Fork and clone**
   ```bash
   git clone https://github.com/yourusername/takus.git
   cd takus
   ```
2. **Install** — `npm install`
3. **Configure** — set your Google Client ID in `index.html` (see [setup-guide.md](setup-guide.md))
4. **Run** — `npm run dev`
5. **Build** — `npm run build`

## Architecture

```
src/
├── main.js              # Bootstrap
├── styles/              # Design system (CSS custom properties)
├── lib/                 # Core libraries (state machine, recorder, Google APIs, storage)
└── components/          # UI components (vanilla JS, no framework)
```

Key principles:
- **Zero runtime dependencies** — only Vite for build tooling
- **State machine driven** — recording lifecycle is a finite state machine
- **Vanilla JS** — no framework, ES modules, web standards
- **CSS custom properties** — design tokens for consistent theming

## Code Style

- Modern JavaScript (ES2020+, ES modules)
- Meaningful variable names, short focused functions
- JSDoc comments for public APIs
- No `var`, prefer `const` over `let`

## Testing

- Test in Chrome, Firefox, and Edge
- Test the full recording flow (start → pause → resume → stop → upload)
- Verify Google Drive upload works with real credentials
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
