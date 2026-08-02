---
name: converter-change
description: Fixture-first workflow for changing Google Docs → Markdown conversion, normalization, slug allocation, manifest, or archive handling in packages/sync. Use before editing anything under packages/sync/src when the change affects generated output.
---

# Converter change

`AGENTS.md` mandates fixture-first development for conversion behavior, and
deterministic, idempotent output. Follow this order; do not implement first and
add a fixture afterwards.

## 1. Add a sanitized fixture

Fixtures live in `packages/sync/fixtures/`:

```text
fixtures/html/         Google HTML export snippets
fixtures/markdown/     golden Markdown output (byte-sensitive, prettier-ignored)
fixtures/svg/          safe and malicious SVG inputs
fixtures/inventory/    Drive inventory JSON
```

Rules:

- Never copy real Google Docs content, real document titles, real Drive file
  identifiers from production, or an exported archive containing internal
  material. Write a minimal synthetic input that reproduces the structure.
- Keep the fixture as small as the behavior under test allows.
- For security behavior, add both a safe and a hostile variant
  (see `fixtures/svg/malicious.svg`, `fixtures/html/malicious.html`).

## 2. Write the failing assertion

Co-located `*.test.ts` next to the module, Vitest. Match the existing style in
`packages/sync/src/markdown/normalize-markdown.test.ts`.

Use `fast-check` property tests — already a dev dependency — for:

- slug allocation and collision handling,
- path handling and archive entry names,
- deterministic serialization,
- malicious archive and URL inputs.

## 3. Implement the smallest complete change

- Prefer small explicit modules and standard library APIs over framework
  abstractions.
- Use structured parsing (`cheerio`, `unified`/`remark`, `jsonc-parser`, `yaml`)
  rather than regular expressions over generated Markdown, links, HTML, SVG, or
  archive paths.
- Do not add a production dependency without explaining why the specification's
  existing set is insufficient.
- Writes to generated output must be atomic, and a failed run must leave the
  last known-good output untouched.

## 4. Verify

```bash
pnpm test:unit
pnpm validate:content
pnpm verify:quick
```

Determinism check — two consecutive runs against unchanged input must produce a
zero diff:

```bash
pnpm sync:dry-run
```

## 5. Keep the commits separate

Converter logic and regenerated content go in different commits, and generated
content is never hand-edited. If the output looks wrong, fix the exporter or the
normalizer and run a controlled full sync.

Generated paths owned by the pipeline (writes are blocked in
`.claude/settings.json`):

```text
apps/wiki/src/content/docs/_generated/
apps/wiki/src/assets/generated/
apps/wiki/src/generated/
data/sync-manifest.json
data/docs-index.json
data/latest-sync-report.json
```
