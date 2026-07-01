# Architecture

DeckSpec is a JSON-first deck compiler.

```text
deck.source.json
  -> validate schema + semantic rules
  -> load template pack
  -> normalize tokens/slots into concrete geometry
  -> layout QA
  -> PPTX build
  -> optional PDF/PNG/contact-sheet render QA
```

## Core modules

- `src/types.ts` — public source/normalized deck types.
- `src/validation.ts` — strict JSON Schema plus semantic validation.
- `src/templates.ts` — template/theme/style/layout pack loading and validation.
- `src/normalize.ts` — token and slot resolution.
- `src/qa.ts` — geometry/layout checks before rendering.
- `src/pptx.ts` — PptxGenJS build and PPTX integrity checks.
- `src/render.ts` — optional LibreOffice/Poppler render pipeline.
- `src/smoke.ts` — end-to-end validate/normalize/QA/build/render smoke.
- `src/cli.ts` — public CLI.

## Source policy

Only `*.deck.source.json` is compiled into decks. Markdown can be used in consumer repos for planning or narration, but it is not a DeckSpec input format.

## Support boundary

DeckSpec supports a curated PptxGenJS surface through strict fields plus explicit `options`/`nativeOptions` pass-through. It does not aim to mirror all OOXML or every PptxGenJS option in schema form. See `docs/pptxgenjs-coverage.md` and `docs/pptxgenjs-feature-matrix.md`.
