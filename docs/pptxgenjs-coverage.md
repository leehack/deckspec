# PptxGenJS Coverage

DeckSpec exposes a curated, deterministic PptxGenJS surface through JSON source fields.

| Capability                               | Status         | Notes                                                                                     |
| ---------------------------------------- | -------------- | ----------------------------------------------------------------------------------------- |
| Text / rich text                         | Supported      | `text`, `runs`, font/color/alignment fields, selected native options.                     |
| Shapes / lines                           | Supported      | Deterministic geometry plus token resolution.                                             |
| Images                                   | Supported      | Path, base64 data, alt text, contain/cover sizing.                                        |
| Tables                                   | Supported      | Rows, column widths, row heights, common table options.                                   |
| Charts                                   | Supported      | Bar/line/pie/area examples with data/options pass-through.                                |
| Media                                    | Supported      | File/online media through curated fields.                                                 |
| Speaker notes                            | Supported      | Added to PPTX and integrity-checked.                                                      |
| Sections / slide masters / slide numbers | Supported      | Validated references and examples.                                                        |
| Raw OOXML                                | Not supported  | Out of scope for deterministic QA.                                                        |
| Full PptxGenJS option schema             | Not duplicated | Advanced options go through explicit `options` / `nativeOptions` after safety validation. |

See `docs/pptxgenjs-feature-matrix.md` for the tiered support model.
