# Rendered Feature Coverage

DeckSpec's practical support surface is proven by JSON source examples and rendered smoke decks.

## Smoke decks

- `examples/framework-smoke/deck.source.json` — minimal JSON deck, 2 slides.
- `examples/feature-gallery/deck.source.json` — dark theme feature gallery, 10 slides.
- `examples/feature-gallery-light/deck.source.json` — light theme feature gallery, 3 slides.

`npm run verify:release` validates, normalizes, QA-checks, builds, renders, and package-dry-runs these examples.

## Covered surfaces

| Surface                                | Evidence                      |
| -------------------------------------- | ----------------------------- |
| Text and rich text runs                | Feature gallery JSON          |
| Shapes and lines/connectors            | Feature gallery JSON          |
| Images from path and base64 data       | Feature gallery JSON          |
| Tables                                 | Feature gallery JSON          |
| Charts                                 | Feature gallery JSON          |
| Media                                  | Feature gallery JSON          |
| Sections, slide masters, slide numbers | Feature gallery JSON          |
| Speaker notes and hidden slides        | Tests + PPTX integrity checks |
| Light and dark themes                  | Dark/light feature galleries  |
| Native PptxGenJS pass-through options  | Tests + feature gallery JSON  |

Generated render outputs live under `render/` and are intentionally not committed.
