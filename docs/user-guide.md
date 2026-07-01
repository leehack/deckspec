# User Guide

## Create a deck

Write a strict JSON source file:

```text
my-deck.deck.source.json
```

Start from `examples/framework-smoke/deck.source.json` for a minimal deck or `examples/feature-gallery/deck.source.json` for broader feature coverage.

## Validate and build

```bash
deckspec validate my-deck.deck.source.json
deckspec normalize my-deck.deck.source.json --out dist/my-deck.deck.normalized.json
deckspec qa dist/my-deck.deck.normalized.json --out dist/my-deck.layout-report.json
deckspec build dist/my-deck.deck.normalized.json --out dist/my-deck.pptx
```

Or run the end-to-end smoke gate:

```bash
deckspec smoke my-deck.deck.source.json --render --outDir dist/my-deck
```

## Render QA

With LibreOffice and Poppler installed, `--render` produces PDF, PNGs, and a contact sheet for visual review. Without those tools, omit `--render` to keep validation/build checks.

## Authoring notes

DeckSpec does not compile Markdown. Keep narrative plans or speaker notes in separate docs, then encode the actual deck in JSON.
