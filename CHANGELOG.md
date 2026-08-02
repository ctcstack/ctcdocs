# Changelog

All three packages share a version and are released together.

## Unreleased

### Added

- `home.recentLimit` and `home.corpusIndex` in `site.config.json`. The first
  sets how many documents the "recently updated" band lists; the second decides
  whether the home page ends with the full index of every document. Both are
  optional and default to what the page did before — six rows and an index — so
  an existing configuration keeps its home page unchanged.
  `home.corpusIndex: false` is refused while `navigation.sectionIndexPages` is
  `false`, because folder cards and breadcrumbs resolve to headings inside that
  index when folders have no pages of their own.

## 0.1.1

### Changed

- `@ctcstack/ctcdocs-sync` starts its command line from `bin/ctcdocs-sync.mjs`
  rather than from the compiled `dist/cli.js`. Nothing changes for a project:
  the command is still `ctcdocs-sync`, and it still runs the same code. The
  entry point moved because a package manager creates the executable link at
  install time and skips one whose target does not exist yet.

### Internal

- Compiled output is built by `prepack` instead of being committed. It was in
  the repository only for as long as projects installed the packages from Git,
  where an install runs no build script.

## 0.1.0

First release. Extracted from the internal deployment that had been running the
same code, so the packages arrive with a production corpus behind them rather
than a fixture.

- `@ctcstack/ctcdocs` — an Astro/Starlight configuration preset, Starlight
  component overrides, the routes a documentation deployment needs, the
  interface stylesheet, and the accessibility and access suites a project runs
  against its own corpus.
- `@ctcstack/ctcdocs-sync` — one-way Google Drive to Markdown synchronization
  and the `ctcdocs-sync` command line. A run twice over unchanged input produces
  no diff.
- `@ctcstack/ctcdocs-core` — the configuration schema, the project layout, and
  the compile-time allowlist of paths the pipeline may write.
