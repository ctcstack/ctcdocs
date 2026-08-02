# Changelog

All three packages share a version and are released together.

## 0.2.0

### Added

- The full index of the corpus is published at `/documents/` on every
  deployment, as a route the platform injects. It is the address a folder
  heading has (`/documents/#<folder>`), which is where a folder card or a
  breadcrumb segment lands when that folder has no page of its own. See
  [ADR-017](docs/ADR/017-full-index-page.md).
- `home.recentLimit` and `home.corpusIndex` in `site.config.json`. The first
  sets how many documents the "recently updated" band lists; the second decides
  whether the home page carries a copy of the full index or links to the page.
  Both are optional and default to what the home page did before — six rows and
  an index — so an existing configuration keeps its home page unchanged.

### Changed

- `documents` is a reserved slug. A new Drive folder or document whose name
  yields it is allocated a suffixed address instead of one the new route would
  shadow. A corpus that already publishes `/documents/` keeps its address and
  `ctcdocs-sync validate` reports the clash, which is fixed by renaming the
  source in Drive.
- Folder anchors address `/documents/` rather than the home page. Where the
  home page keeps the index, a folder card without a folder page now opens that
  page instead of scrolling within the home page; the content is the same.
- The default `sidebarPrefix` links "All documents" beside "Home". A project
  that passes its own prefix links the page itself.

### Fixed

- `ctcdocs-verify-search` no longer fails on a search index it has just built.
  Pagefind's `writeFiles` resolves while the backend's buffered writes are
  still in flight, so the check could serve an empty `pagefind-entry.json` and
  report it as unparseable JSON — a failure with nothing behind it. The check
  now writes the bundle itself, and serves no bundle before every file the
  search runtime starts from is on disk and non-empty.

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
