# Contributing to vsub-cli

Thank you for your interest in contributing to `vsub-cli`!

## Development Philosophy & Principles

1. **Trunk-Based Development**:
   - All contributions are integrated directly into `main` after passing automated CI checks.
   - Small, focused, and well-tested Pull Requests are preferred.

2. **Zero Breaking Design & Simplicity**:
   - `vsub-cli` aims to be a lightweight, resilient, and focused tool.
   - Large architectural changes or heavy new dependencies should be discussed in an issue first.

3. **License & Disclaimer (The Unlicense)**:
   - This project is released into the public domain under [The Unlicense](LICENSE).
   - Contributions are provided voluntarily, and maintenance is strictly best-effort.

---

## Local Development Setup

### Prerequisites
- Node.js 26 (or 24+)
- [pnpm](https://pnpm.io/) (`>= 11.22.0`)
- [FFmpeg](https://ffmpeg.org/) (installed in `PATH` or configured via `VSUB_FFMPEG_PATH`)

### Setup Commands

```bash
# 1. Install dependencies
pnpm install

# 2. Run in development mode
pnpm dev path/to/sample.mp4

# 3. Check linting and formatting (Biome)
pnpm check

# 4. Run tests (Vitest)
pnpm test

# 5. Build executable bundle
pnpm build
```

---

## Submitting Pull Requests

1. Ensure all checks pass locally:
   ```bash
   pnpm check && pnpm test && pnpm build
   ```
2. Write conventional commit messages (`feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`).
3. Open a Pull Request referencing any relevant issues.
