# Changelog

## 0.2.0

- Adds native preset-shape image fills via `type: "imageShape"` for image-in-shape use cases such as rounded photo frames.
- Adds an `imageShape` feature-gallery page that renders verified preset masks plus a custom path mask through the PPTX → PDF → PNG smoke path.
- Adds `customGeometry.points`, `customGeometry.paths`, and `customGeometry.rawXml` for native custom picture fills, including line, quadratic/cubic Bézier, arc, and imported `<a:custGeom>` geometry.
- Maps `imageShape.sizing` to native DrawingML `<a:srcRect>` / `<a:fillRect>` so cover, crop, and contain composition work inside shape picture fills.
- Updates bundled schema IDs and `schemaVersion` to the `v0.2.0` release line.

## 0.1.0

- Initial DeckSpec package release candidate.
- Provides strict JSON deck validation, normalization, layout QA, PPTX generation, render smoke tests, and bundled schemas/templates.
- Publishes versioned schema IDs under the `leehack/deckspec` GitHub repository tag namespace.
