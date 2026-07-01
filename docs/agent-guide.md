# Agent Guide

Use DeckSpec as a deterministic JSON deck compiler.

## Workflow

1. Edit `*.deck.source.json`, template JSON, or TypeScript source.
2. Run format/lint/type checks before larger smoke runs.
3. Run rendered smokes for template, layout, or PPTX changes.
4. Do not commit generated `dist/` or `render/` outputs.

## Commands

```bash
npm run format:check
npm run lint
npm run typecheck
npm run coverage
npm run verify:release
```

## Source policy

Do not add Markdown deck inputs or a Markdown compiler. Planning docs are fine, but the package contract is JSON source → normalized JSON → PPTX/render QA.
