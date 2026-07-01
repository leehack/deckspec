# PptxGenJS Feature Matrix

DeckSpec intentionally supports a stable authoring subset instead of mirroring every PptxGenJS option.

## Tiers

| Tier                | Meaning                                                           |
| ------------------- | ----------------------------------------------------------------- |
| First-class         | Strict DeckSpec fields with schema and semantic validation.       |
| Native pass-through | Allowed through `options` or `nativeOptions` after safety checks. |
| Deferred            | Not part of the deterministic Node pipeline.                      |

## Current status

| Feature                        | Tier                       | Evidence                                                |
| ------------------------------ | -------------------------- | ------------------------------------------------------- |
| Text/rich text                 | First-class                | tests + feature gallery                                 |
| Shapes/lines                   | First-class                | tests + feature gallery                                 |
| Images                         | First-class                | tests + feature gallery                                 |
| Tables                         | First-class                | tests + feature gallery                                 |
| Charts                         | First-class/native options | tests + feature gallery                                 |
| Media                          | First-class/native options | tests + feature gallery                                 |
| Sections/masters/slide numbers | First-class                | tests + feature gallery                                 |
| Speaker notes                  | First-class                | tests + PPTX integrity                                  |
| Browser DOM `tableToSlides()`  | Deferred                   | Browser DOM coupling is outside the Node JSON pipeline. |
| Raw OOXML/transitions          | Deferred                   | Avoids bypassing deterministic layout QA.               |

Rendered proof lives in `docs/rendered-feature-coverage.md` and JSON examples under `examples/`.
