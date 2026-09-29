# Changelog

All three packages share a version and are released together.

## Unreleased

### Added

- `/llms.txt` lists every document that has a Markdown version, once, in the
  order the sidebar shows it: a heading per folder, and per document its
  title, the address of its Markdown version and its description. A PDF says
  so in its link text. A top-level folder with a page of its own also gets
  `/<its page>/llms.txt`, which the site index links to first. There is no
  `llms-full.txt`. See
  [ADR-033](docs/ADR/033-publish-llms-txt-indexes.md), which supersedes
  ADR-010 in part.
- Every page's head links to `/llms.txt`, a document's head to its Markdown
  version, and the home page, documents and folder pages describe themselves
  in JSON-LD: a document with its edit date, its source and its Markdown
  version. The home page's "For AI agents" block starts at `/llms.txt`.
- The fixture project's `typecheck` also type-checks the platform's
  build-time routes and modules that read generated types, through
  `tsconfig.platform.json`: the Markdown and asset routes, the `llms.txt`
  routes, the corpus and section helpers, and the content configuration.
  Nothing type-checked them before.

### Changed

- **Upgrade step:** a project's `public/_headers` needs rules for `/llms.txt`
  and `/*/llms.txt`, with the policy of its `/*.md` rule and
  `Content-Type: text/plain; charset=utf-8`; the fixture project's file shows
  them. `ctcdocs-sync validate` requires both on a private deployment.
- `ctcdocs-access-smoke` probes `/llms.txt`: denied to an anonymous request,
  and served with its charset, listing the document it reads as Markdown, to
  an admitted one. It reads the index up to 25 MiB, the largest file Workers
  Static Assets serves.
- The interface stylesheet and every component read the platform's own
  `--kb-*` design tokens instead of Starlight's `--sl-*` ones. One adapter
  block in `styles.css` assigns Starlight's tokens from the platform's, and
  reads back the few Starlight owns, such as its type steps, so the design
  language no longer depends on Starlight's names. A unit test keeps
  Starlight's token names out of components, routes, scripts and `lib`, and
  their reads out of `styles.css` outside the adapter. A project's
  `brand.css` is unchanged and keeps writing the accent triad under
  Starlight's names, and the Expressive Code overrides in the preset keep
  Starlight's names too, so the code stylesheet and its address do not
  change. Compared before and after on the fixture, 35 computed properties of
  every element were identical on all 20 pages, the permanent-link redirects
  aside, in both themes at desktop and
  phone widths, with the search dialog and its backdrop open, with the mobile
  menu open, across the first 25 keyboard focus stops, under the pointer on
  the first 20 links and controls of two pages, and in print.

## 0.13.1

### Fixed

- The 404 page offers the page a missing address named when that page is in
  a folder. It searched the whole address first, and the words of the folders
  are not indexed on a page but are on the home page, which names every
  folder: the home page was offered instead, and the browser suite failed for
  a project whose first document sits two folders deep. The page now searches
  the last segment of the address, then each of its words, and the folders
  only when the last segment has no word to search for. See
  [ADR-032](docs/ADR/032-search-a-missing-address-by-its-name.md).
- The browser suite checks the 404 page with the document deepest in folders
  instead of the first document of the corpus.

## 0.13.0

### Changed

- An image cropped in Google Docs is published cropped, as Docs shows it,
  instead of whole with the part cropped away. The crop is applied to the
  file without loss, with the image's color profile and none of its
  metadata, by `fast-png`, a new dependency of the sync. See
  [ADR-031](docs/ADR/031-apply-the-crop-google-docs-makes.md).
- A cropped image the site cannot crop, a file other than a PNG or an image
  also rotated, is published as it is, with the note "A cropped image is
  shown whole". It replaces the note "An image is cropped in Google Docs",
  which a crop applied no longer needs.
- The first sync after upgrading exports once more every document whose
  cropped images 0.12.0 published whole, and rewrites them cropped. The
  manifest records the image processing as `imageVersion`.
- Every dependency moves to its latest release within its major version, and
  the lockfile is resolved again from nothing. The sync takes `smol-toml`
  1.9.0, `yaml` 2.9.1 and `zod` 4.6.5. The site package takes
  `@astrojs/markdown-remark` 7.3.1, `@axe-core/playwright` 4.13.0, whose
  axe-core 4.13 runs the accessibility checks of the browser suite,
  `eslint-plugin-astro` 3.2.1, `globals` 17.12.0 and `typescript-eslint`
  8.70.1. The fixture project moves to `astro` 7.3.5, `sharp` 0.35.5,
  `@playwright/test` 1.63.0 and `wrangler` 4.142.0, and the workspace to
  `eslint` 10.11.0, `knip` 6.38.0 and `prettier` 3.9.9. Major releases are
  left for changes of their own: TypeScript 7, which `typescript-eslint` does
  not support yet, Vitest 5, Mermaid 12, Starlight 0.42, which the site
  package takes as a peer, `prettier-plugin-astro` 1 and `domhandler` 6.
- The site package now requires `astro` ^7.2.10. `astro` names the
  `@astrojs/markdown-remark` it works with as a peer, exactly 7.2.4 up to
  7.2.9 and ^7.3.0 from 7.2.10, and the site package builds its Markdown
  processor with the same one. A project on `astro` 7.2.9 or earlier raises
  it; the fixture is tested on 7.3.5.
- The refresh takes the `undici` releases that fix GHSA-3wwx-pv8p-q78v, a
  crash of its WebSocket client on a malformed compressed message (moderate):
  7.30.0 under `cheerio`, which the sync and the site package use, and 8.11.2
  under the font loader of `astro`. Neither path uses the WebSocket client,
  and both already allowed the fixed releases, so a project clears the
  advisories by refreshing `undici` in its own lockfile, with
  `pnpm update undici`. With pnpm 11.9.0 such an update can leave a
  package's platform binaries out of the lockfile, as it did here with
  Rolldown's, and the build then fails; `pnpm install --fix-lockfile` puts
  them back.
- `undici` under the fixture project's `wrangler` is raised to 7.29.1 by a
  workspace override. Miniflare pins 7.29.0 exactly in every `wrangler` up to
  4.143.0. The override applies only while that pin stands and does not reach
  projects. `pnpm audit` reports nothing at any severity.
- The override that held `astro-eslint-parser` at 3.0.0 is removed: 3.2.0
  parses every `.astro` component in this repository again.

## 0.12.0

### Added

- Notes: a page with images that have no alt text, and how many, with the
  instruction to add alt text in Google Docs. See
  [ADR-029](docs/ADR/029-say-when-an-image-has-no-alt-text.md).
- Notes: a page with images cropped in Google Docs, and how many. The site
  shows such an image whole, the part cropped away included; the note says to
  check that part and to crop an image before inserting it. Publication is
  unchanged. The manifest records the count as `croppedImages`. See
  [ADR-030](docs/ADR/030-note-images-cropped-in-google-docs.md).
- Notes: a page with images larger than a size the project sets, how many,
  and the largest. The size is `sync.largeImageMegabytes` in
  `site.config.json`, 2 MB unless set, read from the published files on
  every sync, so changing it needs no export. Nothing about the images
  changes.

### Changed

- An image without alt text is published with an empty alt instead of
  "Image from" and the document's title, which read as a description to AI
  agents and screen readers. A page that opens with such an image takes its
  summary from its first words instead.
- A heading that holds only an image is published as a paragraph, instead of
  a heading with no words in the table of contents.
- An image with a title and no alt text takes its title as its alt text,
  and a blank title is no longer carried into the page.
- The first sync after upgrading exports every document with images
  converted through the HTML export once more, to count them, and rewrites
  the pages the changes above reach: an image without alt text or with only a
  title, a heading that holds only an image, an image inside a table, which
  loses the blank title Google gives every image, and the section pages whose
  summaries change. Other pages are left as they are; the manifest records
  the count as `undescribedImages`.
- A page that comes out the same keeps its page, and its manifest record now
  follows what the conversion found: the export it came through and its
  warnings, as well as the count.

## 0.11.1

### Fixed

- A PDF whose page was written by an earlier text extraction is read again
  by a normal sync, as 0.11.0 said, and not only by a full one.
- Links to files in Drive no longer carry the `ouid` and `usp` parameters
  Drive adds, which name the account that owns a file and how the link was
  made, in the sync report, the job summary and the content health page.

## 0.11.0

### Added

- The content health page opens with an overview: pages on the site by kind,
  files not on it, notes and documents to fix, each linking to its section,
  and when the site last changed. "Not on the site" opens with a table of its
  groups — what, how many, where, what to do — before the lists. See
  [ADR-028](docs/ADR/028-legible-sync.md).
- Files the site does not publish are grouped by what to do with them: Word
  and text files (save as Google Docs), presentations (export as PDF),
  archives, images, diagrams, spreadsheets, video and audio, other files.
- Notes: pages that are on the site with something to know — an image or a
  link conversion left out, a link to a heading that now opens the top of a
  page, a merged cell split, a code block never closed, files in one folder
  with the same name, an order number used twice, an ignored folder that is
  not there.
- The job summary of a sync says what the run changed, page by page with
  links, and what stopped a run that failed, with what it means and what to
  do. The state of the site follows in the same grouped tables as the page.

### Changed

- The sync report moves to schema version 3: both catalogs, the notes, pages
  by kind, and how the pages were made. A run counts pages it added, changed
  and removed by their output, and documents it exported separately, so a
  full sync over unchanged documents reports nothing changed.

### Fixed

- The text of a PDF no longer runs words together where a slide or a table
  draws them as separate pieces, and a line in capitals is a paragraph of its
  own instead of running into the sentence before it. Every published PDF is
  read again once on the next sync.

## 0.10.0

### Added

- Every file in the published folders that is not on the site is named, with
  the reason and what to do: a kind of file the site does not publish, a
  shortcut, or a document the sync could not export. The content health page
  lists them first under "Not on the site", with a link to each in Drive, and
  the folders the configuration ignores with how much each holds. The job
  summary lists the same files by folder, name, type and reason. See
  [ADR-025](docs/ADR/025-name-every-file-left-off-the-site.md).

- PDF files in the published folders are published. Each gets a page like a
  Google Doc: an address from its name without `.pdf`, a permanent link, a
  `PDF` mark in the sidebar. The page shows the file in the browser's viewer,
  with links to open and download it, and its text, which search indexes and
  `index.md` serves. A PDF over 25 MB, the most the site can serve, is
  published as its text with a link to Drive; one over 100 MB is only linked.
  An unchanged PDF is not downloaded again. The content health page lists a
  PDF with no readable text, or too large for the site, as incomplete. See
  [ADR-027](docs/ADR/027-publish-pdf-files.md).
- `data/docs-index.json` gives each document a `format`: `google-doc` or
  `pdf`.

### Changed

- A document named with a letter from another alphabet is held back and
  listed with the letters to retype, instead of stopping the sync. A folder
  named so still stops it. ADR-027 supersedes ADR-020 in this.
- `@ctcstack/ctcdocs-sync` depends on `unpdf` to read the text of a PDF.
- A document that cannot be exported for a reason of its own — over Google's
  10 MB export limit, downloading turned off, or content conversion refuses —
  no longer stops the sync. It is held back: a document already published
  keeps that version and its address, a new one stays off the site, and the
  rest of the corpus is published. It is tried again on every sync. Failures
  that are not the document's own, and a targeted `--file` run, still stop the
  run. See [ADR-026](docs/ADR/026-hold-back-a-document-that-cannot-be-exported.md).
- `data/latest-sync-report.json` moves to schema version 2. It lists the files
  not on the site, the reasons and the ignored folders, and counts them. The
  first sync after upgrading rewrites it.
- The inventory report lists the ignored folders with their paths and item
  counts.

## 0.9.1

### Fixed

- A heading that mixes alphabets is found in every tab of a document and
  inside table cells, not only among the first tab's top-level paragraphs.
  Google's export flattens a one-cell table used as a frame into the page, so
  a heading inside one is published like any other and was missed. Its link
  opens the tab it is in. The source facts move to version 3, so a full sync
  after upgrading inspects every document again.

## 0.9.0

### Added

- The content health page at `/content-health/`. It groups what editors have
  to fix by the action that fixes it, with an instruction for each check.
  Each document links to its page and to Google Docs, at the line concerned
  when there is one. Filters narrow the list to one section or to whoever last
  edited the document. It is not in the sidebar or in search. See
  [ADR-024](docs/ADR/024-content-health-page.md).
- Checks in the title report:
  - a heading that mixes alphabets, now read from the source with a link to
    it;
  - a document that opens with another document's title;
  - an empty document;
  - the proposed one-Title-line convention (title styled as Heading 1, no
    title line, title not first, Title style on a section);
  - Drive names with "Copy of", a file extension, underscores or extra spaces.
- The sync's job summary lists the checks as counts, with a link to the page.
- Who last edited each document, from Drive's `lastModifyingUser` display
  name.
- `ctcdocs-sync validate` fails when the project's Prettier configuration
  would format a generated path, and names each one to add to
  `.prettierignore`. It asks Prettier itself, reading `.gitignore` and
  `.prettierignore` the way `prettier --check .` does, and it checks every
  path the allowlist names whether or not the sync has written it yet. A
  project that listed generated files one by one did not ignore
  `data/title-report.json` after 0.8.0, and learned so only when a full sync
  had exported everything and then failed its format check.

### Changed

- `content-health` is a platform route.
- The title report moves to schema version 2. It lists its checks, and each
  document lists its issues, section and last editor. Facts recorded by 0.8.0
  count as not inspected: run a full sync once after upgrading.
- Title similarity takes the better of character edit similarity and shared
  words, and a reordered title is classified as `reordered`.
- The Docs API request also reads each paragraph's heading ID.
- `@ctcstack/ctcdocs-sync` declares `prettier` 3 as a peer dependency. Every
  project already installs it for its format check; validation now uses the
  same copy, so the answer is the one the format check would give.
- `@ctcstack/ctcdocs` declares `prettier` 3 as a peer dependency as well. It
  ships the shared Prettier configuration, so it always needed one; the
  requirement is now stated rather than assumed.

## 0.8.0

### Added

- The title report. Every sync writes `data/title-report.json`: how each
  document opens (Title, Heading 1 or text), its title candidate and how that
  compares with the Drive name, whether a leading Heading 1 was dropped as a
  copy, and what the Drive name carries besides a title. It observes and
  changes nothing, so a title convention can be decided from numbers.
  `ctcdocs-sync titles` summarizes it, and `--list` names the documents. See
  [ADR-023](docs/ADR/023-title-report.md).
- Headings that mix alphabets inside a word are listed in the title report,
  and the sync summary counts the documents. They do not stop a sync.

### Changed

- The Docs API request made for each exported document also reads the named
  style and text of body paragraphs. Formatting is not requested.
- `data/title-report.json` is a generated file. A project's rules that list
  generated paths should include it.

## 0.7.1

### Fixed

- A deployment started by a sync runs its post-deployment check again. Since
  0.5.0 such a deployment skips the candidate verification it no longer
  needs, and the check after the deployment inherited that skip. The assets
  were deployed, the protected surface was never verified, and the run failed
  at `deployment did not complete: deploy=success, smoke=skipped`. The check
  now runs whenever the deployment succeeded.

## 0.7.0

### Added

- `navigation.addresses` in `site.config.json`. `stable`, the default, keeps
  an address through every rename and move, as before. `follow-names` gives
  every folder and document the address its current Drive path yields, on
  every sync over the whole corpus. Each item keeps one earlier address as a
  redirect, so redirects never outnumber pages. An address an item leaves is
  free for the next item named that way. Folders get redirects as documents
  do. See [ADR-021](docs/ADR/021-addresses-may-follow-names.md).
- Permanent links. Every document and section page has a short ID recorded in
  the manifest, and answers at `/d/<short ID>/` whatever it is renamed to. A
  page offers to copy it. `d` is now a platform route. See
  [ADR-022](docs/ADR/022-permanent-short-ids.md).
- The 404 page searches the site for the words of the missing address, and
  lists what it finds. It replaces Starlight's 404 page.

### Changed

- A link between documents is stored as the target's permanent link, and
  resolved to the target's current address when the site builds. A pasted
  address of this site becomes a permanent link as well. A renamed target no
  longer changes the documents that link to it. The converter version is now
  `hybrid-v3`, so the first sync after upgrading exports every document again.
- Generated documents and section pages carry `shortId` in their frontmatter,
  and manifest records carry it too.

### Fixed

- A redirect is removed when the folder or document it points at leaves the
  corpus. Until now it stayed in the manifest, and output validation rejected
  every later sync.

## 0.6.0

### Added

- A word in a Drive name has to use letters of one alphabet. A name with a
  Cyrillic letter typed into a Latin word, or the reverse, stops the sync at
  inventory with `mixed_script_name`, before the stray letter becomes part of
  a permanent address. The log names the item ID, the code point and its
  position, never the name. Latin, Cyrillic and Greek are checked against each
  other; a name in any one script is unaffected. See
  [ADR-020](docs/ADR/020-letters-from-one-alphabet.md).
- `navigation.nameScripts` in `site.config.json` lists the scripts a letter in
  a Drive name may belong to, such as `["Latin"]`. A letter of any other script
  stops the sync with `disallowed_name_script`. Without it, any script is
  accepted.

### Changed

- A sync that stops on a name-level inventory issue prints one line per
  finding after the list of codes.

## 0.5.2

### Fixed

- The search check finds a document whose slug leaves ASCII. Pagefind returns
  a result's address percent-encoded, and the check compared it with the slug
  as the corpus records it, so a document search returned first was reported
  missing and the sync failed. A Drive title typed with one Cyrillic letter was
  enough. Result paths are now decoded before they are compared, and a
  document with such a slug is always among the ones searched for, so the
  fixture corpus's Cyrillic document now exercises the case.

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
