# Changelog

All three packages share a version and are released together.

## 0.5.1

### Fixed

- The browser suite passes on a project that has just taken 0.5.0. The
  section-page check drew its sample from the manifest and always expected the
  new listing, but section pages generated before 0.5.0 record no entries and,
  as intended, keep their Markdown list until the next sync rewrites them, so
  the upgrade's own pull request failed until a sync had run. The check now
  reads the sample page's frontmatter: a page without entries must show its
  Markdown list, linking the subfolder, and no listing.

## 0.5.0

### Changed

- Among siblings nobody numbered, folders now come before documents: in the
  sidebar, and on section pages. A landing document still opens its folder, and
  a number in a Drive name still places an item exactly where it was numbered.
  The first full sync after upgrading reorders the sidebar of any folder mixing
  unnumbered subfolders and documents. See
  [ADR-019](docs/ADR/019-folders-before-documents.md).
- The Access preflight in `project-deploy.yml` runs beside the candidate
  verification instead of after it. It reads only the live hostname, and the
  deployment still waits for both.

### Added

- A section page tells folders from documents. Its frontmatter records each
  entry's kind, and for a folder, how many documents sit anywhere below it. The
  site draws a folder glyph and the count ("Empty" when there are none) for a
  folder, and a document glyph, the date its source was last edited and its
  description for a document. Each row's kind also reaches a screen reader as
  text. A page generated before this release keeps its plain list until the
  next full sync rewrites it.
- `project-deploy.yml` takes `candidate_verified`. A caller deploying a commit
  `project-sync.yml` produced passes it as `true` with `candidate_sha`, and the
  candidate verification job, a second `pnpm verify` of the tree the sync job
  had just verified, is skipped. The input fails the run without a SHA. A
  project opts in by adding `candidate_verified: true` to the deployment job
  of its sync workflow; without it nothing changes.
- The workflows cache the images Astro optimizes, in `project-sync.yml`,
  `project-deploy.yml` and `project-ci.yml`, keyed by the lockfile and the
  images under `src/assets/`. Encoding them was most of every build, and a sync
  that deploys builds the site three times.

### Fixed

- Dependencies are downloaded once per lockfile rather than in every job. The
  workflows cached the pnpm store through `actions/setup-node`, whose key
  names only the lockfile, and the dependency audit in `project-ci.yml`, which
  installs nothing, usually saved its near-empty store under that key first;
  every job after it restored that and fetched every package again. Each
  workflow now caches the store and pnpm's cache directory itself, under a key
  of its own, and the audit restores and saves nothing. Keeping the cache
  directory also keeps pnpm's record that the lockfile passed its supply-chain
  check. Entries under the old key are no longer read and expire on their own.

## 0.4.0

### Added

- The sync workflow scans every generated file a run added or changed for
  secrets before it commits, and a finding fails the run: nothing is committed,
  pushed or deployed. The scan runs `ctcdocs-sync scan:generated-diff` with the
  gitleaks release `project-ci.yml` pins, and the project's own `.gitleaks.toml`
  and `.gitleaksignore`. It logs each finding as
  `ERROR [SECRET_SCAN]: rule=<id> path=<file> line=<n> fileId=<id>`, never the
  value, and exits with 5. A `gitleaks:allow` written into a document is
  ignored, and a path exemption covering a changed generated file fails the run.
  The failure notification reports the new stage `secret-scan` and nothing else.
  The pushes a sync makes start no other workflow, so until now the project's
  CI never scanned them. See
  [ADR-018](docs/ADR/018-secret-scan-before-sync-commit.md) and
  [Operations](docs/OPERATIONS.md#secret-scan-findings).
- A project that moves its `project-sync.yml` reference to this release has to
  take this release of `@ctcstack/ctcdocs-sync` with it; the workflow calls the
  new command, and the scan step fails without it.

### Fixed

- The browser suite runs the same under an AI agent as without one, and
  `ASTRO_PREVIEW_BACKGROUND=1`, which 0.3.0 suggested for agents, is no longer
  needed. On macOS and Linux, `astro preview` from 7.2 onwards moves itself to
  the background when it detects an agent, so `test:ux` run by one either
  failed because the web server exited early, or passed and left the preview
  holding the port for the next run to reuse. `defineUxConfig()` now serves the
  build with `ctcdocs-preview`, a new binary of `@ctcstack/ctcdocs` that starts
  the same server through Astro's programmatic `preview()`, which detects no
  agent and keeps no lock file, and stays in the foreground for Playwright to
  stop. The suite no longer runs the project's `preview` script;
  `previewCommand` still replaces the command. A preview an earlier run left in
  the background still holds its port and is reused outside CI: stop it once
  with `pnpm exec astro preview stop`.

## 0.3.0

### Added

- `GoogleApiError` carries `reasons` and `fileId`. `categorizeGoogleApiFailure`
  and `isRetryableGoogleApiFailure` take the reasons into account;
  `categorizeGoogleApiStatus` and `isRetryableGoogleApiStatus` still judge the
  status alone.

### Changed

- The dependencies carrying advisories published since 0.2.3 are updated.
  `smol-toml` goes to 1.7.2 in `@ctcstack/ctcdocs-sync`, which reaches every
  project. The site package now requires `astro` ^7.2.8, the first release
  without a critical remote code execution through AVIF image optimization,
  and `sharp` ^0.35.4, the first without libheif's vulnerabilities. Its
  `@astrojs/markdown-remark` goes to 7.2.4, the version those `astro` releases
  expect. The fixture project moves to `astro` 7.2.9, `sharp` 0.35.4 and
  `wrangler` 4.131.2, whose Miniflare takes the patched `sharp`, and the
  workspace to `vitest` 4.1.11. `pnpm audit` reports nothing at any severity.
- A project that takes this release has to raise its own `astro` and `sharp`
  to those versions. On macOS and Linux, `astro preview` from 7.2 onwards starts
  in the background when it detects an AI agent, and the browser suite's web
  server then exits as soon as it starts. CI is unaffected. Under an agent,
  run the suite with `ASTRO_PREVIEW_BACKGROUND=1` until the platform handles it.

### Fixed

- A Drive or Docs request refused with 403 for a rate limit
  (`rateLimitExceeded`, `userRateLimitExceeded`) is retried with the same
  backoff as a 429, as Google directs, instead of failing the run as a
  permission error.
- A failed Google request says why and on what. The sync error line carries
  the reason codes Google returned and the ID of the file being exported or
  inspected, for example
  `ERROR [GOOGLE_EXPORT_SIZE_LIMIT]: status=403 reason=exportSizeLimitExceeded fileId=<id> requestId=<id>`.
  Only reason codes are kept from the response body, read up to 64 KiB; its
  messages are discarded. A document over the 10 MB export limit is reported
  as `GOOGLE_EXPORT_SIZE_LIMIT` (exit 1), whether Google or the pipeline
  refused it, and one that stops viewers from downloading as
  `GOOGLE_DOWNLOAD_RESTRICTED` (exit 3); both were a bare `GOOGLE_PERMISSION`
  or `GOOGLE_INVALID_RESPONSE`. What each category asks of an operator is in
  [Operations](docs/OPERATIONS.md#failure-handling).

## 0.2.3

### Changed

- The dependencies carrying published advisories are updated: `mermaid` to
  11.16.1, `smol-toml` to 1.6.1, and the fixture project's `wrangler` to
  4.129.0, whose Miniflare takes the patched `undici`. Refreshing the lockfile
  within the existing ranges clears the rest. A project that takes this release
  clears the two advisories it inherits from these packages.
- `astro-eslint-parser` is held at 3.0.0 by a workspace override. 3.1.0 fails
  to parse every `.astro` component in this repository, with or without the
  matching plugin release, so the lint step reports thirteen parsing errors
  instead of linting. The override is a stopgap and says so.

## 0.2.2

### Fixed

- The mobile check in the browser suite accepts a table that is wider than its
  frame. It required the table's width to match the wrapper's exactly, which no
  table with more than about three columns can do on a phone — the case the
  wrapper's horizontal scroller exists for. The suite now asserts what the
  layout owes a reader: the table is never narrower than its frame, an
  oversized one scrolls inside the wrapper rather than dragging the page
  sideways. The fixture corpus carries a six-column table so the scrolling case
  is exercised rather than assumed.

## 0.2.1

### Fixed

- `ctcdocs-verify-search` splits a document title into search terms on
  punctuation rather than deleting it. A title an editor is free to write, such
  as `Team_Roles_2026 Handbook`, became the single term `TeamRoles2026`, which
  no index holds: the check reported the document as unfindable while the
  search interface returned it first for the same words. A corpus whose titles
  carry underscores, ampersands or dots no longer fails synchronization.

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
