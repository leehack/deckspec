# AGENTS.md — DeckSpec

Maintain DeckSpec as a publishable TypeScript npm package.

## Rules

- JSON is the only supported deck source format (`*.deck.source.json`). Do not reintroduce Markdown-to-deck compilation unless it reaches full JSON-source parity.
- Keep generated outputs out of git: `dist/`, `render/`, coverage, and package tarballs are local artifacts.
- Keep public examples anonymized and generic.
- Keep type-aware strict ESLint and Prettier gates green; prefer `npm run lint:fix` + `npm run format` before broad verification.
- Do not edit global git/npm config.

## Required checks

```bash
npm run verify:release
```

For focused edits, run the relevant subset first:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run coverage
npm run smoke
npm run smoke:gallery
npm run smoke:gallery:light
```
