# DeckSpec versioning and schema IDs

DeckSpec treats the npm package version, CLI version, and bundled JSON Schema version as the same release line.

## Canonical schema IDs

Published schemas use immutable Git tag URLs:

```text
https://raw.githubusercontent.com/leehack/deckspec/v<package-version>/schemas/<schema-file>
```

For the current release, the source deck schema ID is:

```text
https://raw.githubusercontent.com/leehack/deckspec/v0.2.0/schemas/deck.schema.json
```

Do not use `main` branch URLs as `$id` values in published schemas. `main` is mutable and can make older deck files validate against newer rules.

## Deck source `schemaVersion`

Deck source files may include:

```json
{
  "schemaVersion": "0.2.0"
}
```

The field is optional for now. When present, it must match the schema bundled with the package version validating the deck. Consumers that need long-lived reproducibility should store either `schemaVersion` or the exact npm package version used to normalize/build the deck.

## SemVer policy

- **Patch** (`0.1.x`): bug fixes, documentation updates, packaging fixes, and validation clarifications that do not reject previously valid deck sources.
- **Minor** (`0.x+1.0` while pre-1.0): backwards-compatible schema additions, new layouts, new first-class element fields, and new CLI commands/options.
- **Major** (`1.0.0+` once stable): breaking schema, CLI, exported API, or rendering-semantics changes.

During `0.x`, DeckSpec still follows SemVer intent: changes that can break existing deck sources require an explicit release note and version bump larger than a patch.

## Release checklist

1. Update `package.json` and `package-lock.json` version together.
2. Update schema `$id` URLs to the release tag.
3. Update `schemaVersion.const` in `schemas/deck.schema.json` and `DeckSpec.schemaVersion` in `src/types.ts`.
4. Add a `CHANGELOG.md` entry.
5. Run `npm run verify:release` and `npm run publish:dry`.
6. Tag the verified commit as `v<package-version>`.
7. Publish via the GitHub Actions `Publish to npm` workflow, or run `npm publish --access public` from the clean tagged checkout.
