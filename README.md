# DeckSpec

DeckSpec is a deterministic TypeScript toolkit for building QA-checked PPTX decks from strict JSON source files.

```text
deck.source.json
  -> normalized JSON with concrete geometry/styles
  -> layout-report.json
  -> PPTX
  -> optional PDF/PNG/contact-sheet render QA
```

## Install

```bash
npm install deckspec
```

Local development:

```bash
npm install
npm run verify:release
```

## CLI

```bash
deckspec validate examples/framework-smoke/deck.source.json
deckspec normalize examples/framework-smoke/deck.source.json --out dist/example/deck.normalized.json
deckspec qa dist/example/deck.normalized.json --out dist/example/layout-report.json
deckspec build dist/example/deck.normalized.json --out dist/example/deck.pptx
deckspec render dist/example/deck.pptx --outDir render/example
deckspec smoke examples/framework-smoke/deck.source.json --render
```

During local development, replace `deckspec` with `tsx src/cli.ts`.

## Source format

The supported authoring contract is `*.deck.source.json`. Narrative notes, planning docs, or Markdown drafts can live beside a deck, but DeckSpec does not compile Markdown into decks.

Deck elements include text, shapes, lines, images, image-in-shape masks, tables, charts, and media. Use `type: "imageShape"` when an image should fill a native PowerPoint shape while preserving shape line/rounding:

```json
{
  "id": "photo-frame",
  "type": "imageShape",
  "shape": "roundRect",
  "imagePath": "assets/photo.png",
  "x": 1040,
  "y": 140,
  "w": 560,
  "h": 360,
  "sizing": { "type": "cover", "w": 560, "h": 360 },
  "rectRadius": 0.25,
  "line": { "color": "34D399", "width": 2.25 }
}
```

The current `imageShape` implementation supports PowerPoint native preset shapes with picture fill, line styling, and `rectRadius` where applicable. Common verified presets include `rect`, `roundRect`, `ellipse`, `triangle`, `diamond`, `pentagon`, `hexagon`, `star5`, `heart`, `cloud`, and `trapezoid`. Use `ellipse` for oval/circle masks; `circle` is accepted as an alias that emits an `ellipse` preset, with equal `w`/`h` producing a circle. `sizing.type` is translated into native DrawingML crop/fill rectangles for image-in-shape masks: `cover` emits `<a:srcRect>` crop percentages, `crop` maps an explicit source-pixel crop box to `<a:srcRect>`, and `contain` emits `<a:fillRect>` padding. Custom geometry supports normalized polygon `points`, richer `paths` with `moveTo`, `lineTo`, `quadBezTo`, `cubicBezTo`, `arcTo`, and `close` commands, plus `rawXml` passthrough for a complete imported `<a:custGeom>` block when exact reference PPTX geometry is required.

See:

- `examples/framework-smoke/deck.source.json` for a minimal deck.
- `examples/feature-gallery/deck.source.json` for the supported PptxGenJS surface.
- `schemas/deck.schema.json` for the source contract.
- `docs/versioning.md` for schema IDs, SemVer, and release policy.

## Schema IDs and versioning

DeckSpec publishes versioned JSON Schema IDs from immutable Git tags. For `0.2.0`, the deck schema ID is:

```text
https://raw.githubusercontent.com/leehack/deckspec/v0.2.0/schemas/deck.schema.json
```

Use the package version as the schema version. Patch releases may clarify validation without changing accepted source shape; minor releases may add backwards-compatible schema fields; major releases are reserved for breaking source-schema or CLI/API changes. See `docs/versioning.md`.

## Publishing

This repo is prepared for npm publishing but does not publish during normal CI. Maintainers should run:

```bash
npm run verify:release
npm run publish:dry
```

Then publish from the GitHub Actions `Publish to npm` workflow or run `npm publish --access public` with a clean, tagged release checkout.

## Built-in layout catalog

The default `hybrid-keynote` template includes:

```text
cover
section-break
split-hero
three-card-row
comparison
timeline
code-walkthrough
data-viz
diagram
quote
metric-grid
image-hero
closing-qr
```

## Quality gates

DeckSpec uses Prettier for formatting and type-aware strict ESLint for code quality. ESLint is configured with `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, `projectService: true`, and `eslint-config-prettier` to avoid formatting-rule conflicts.

```bash
npm run format:check
npm run lint
npm run typecheck
npm run coverage
npm run verify:release
```

Use `npm run format` and `npm run lint:fix` for local cleanup before running the gates.

`verify:release` runs formatting, lint, typecheck, coverage, build, rendered smoke decks, and `npm pack --dry-run`.

## Render prerequisites

Render QA uses command-line tools when `--render` is enabled:

- LibreOffice `soffice` for PPTX → PDF
- Poppler `pdftoppm` for PDF → PNG

If those are unavailable, `smoke` without `--render` still validates, normalizes, QA-checks, builds, and verifies PPTX structure.
