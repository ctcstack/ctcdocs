# Changelog

All three packages share a version and are released together.

## 0.23.0

### Added

- **Documents by format, for assistants.** The MCP server's `search` and
  `recent` give each document its `format` — `doc`, `pdf`, `sheet`, `video`
  or `audio`, the value `fetch` reports — and `browse` gives it to each
  document that is not a Google Doc. Every folder of a `browse` tree, and the
  answer itself, counts its documents by format in `formats` beside `count`,
  collapsed folders included, so one `browse` without a folder says how many
  documents of each format a reader may open, without reading any. All three
  tools take an optional `format` to keep to one, and the descriptions and
  the server's instructions say so (ADR-044).

### Fixed

- **A `browse` tree that leaves documents out keeps to its budget.** The
  `omitted` count was added after the budget was spent, and could take the
  answer a few dozen characters past `mcp.browseCharacters`.

### Upgrade note

Bump the packages and the workflow pins, and deploy. No sync is needed: the
build already records each document's format.

## 0.22.2

### Fixed

- **A PDF shows on its page again.** 0.22.0 gave the private deployment's
  Content Security Policy a `frame-src` for Google Drive's player, which
  replaced the default for frames rather than adding to it, and browsers
  frame a PDF's `<object>`: every PDF was blocked. `frame-src` now admits the
  site's own files beside Drive, and the Worker's test asserts both.

### Upgrade note

Bump the packages and the workflow pins. No sync is needed.

## 0.22.1

A calmer reading interface, and one statement of the kinds of published page.

### Changed

- **The sidebar.** Folders are named at the size of the documents in them,
  at weight 600 in the muted ink; the folders that hold the current page take
  the strong ink. Rows are taller, with 0.4rem of inline padding, a thin
  chevron and clearer hover and current-page fills. The sidebar is 20.75rem
  wide.
- **Format icons.** A PDF, spreadsheet, video or audio page carries a colored
  tile of its format — the letters PDF, a grid, a play button, sound bars —
  after its title in the sidebar, and before it in the section listing, the
  full index, the recency band and the home page's folder cards, in place of
  a badge or the outline of a page. The file-type colors are the one
  exemption from the reserved accent in `DESIGN.md`.
- **Breadcrumbs** are set at 0.8125rem and weight 500 with chevron
  separators, and the title sits 1rem below them.
- **Headings.** The sync drops bold that covers a whole heading, as editors
  add it in Google Docs, and the page draws bold inside a heading at 700.
- **A spreadsheet's page** records whether it is a Google Sheet, which the
  source link's label reads instead of the address.
- **The header's mark** is the project's `brand.faviconPath`, not a fixed
  `/favicon.svg`, and keeps the file's own shape.

### Added

- **`brand.faviconDarkPath`**, optional: the mark drawn for a dark ground. The
  header shows it under the dark theme the reader chose on the site, whatever
  the system's setting, and a browser with a dark interface shows it in the
  tab.

### Internal

- `@ctcstack/ctcdocs-core/document-format` names the kinds of page, their
  `sourceType`, badges, nouns and MCP formats once. The sync, the site and
  the Worker read them from there, and the PDF, spreadsheet and recording
  facts a page records are one zod schema each.

### Upgrade note

Bump the packages and the workflow pins, then run a sync. `NORMALIZER_VERSION`
and `SHEET_VERSION` moved, so that sync exports every Google Doc and reads
every spreadsheet again once, and the MCP server stores every document again
on its next schedule. Until it runs, headings keep their bold and a Google
Sheet's label is read from its address, as before.

## 0.22.0

Video and audio files get pages
([ADR-047](docs/ADR/047-publish-a-page-for-each-video-and-audio-file.md),
proposed): every video or audio file, and every Google Vids video, in a
published folder gets a page written from its Drive metadata, and an uploaded
one plays on it in Google Drive's own player. Nothing is downloaded, hosted
or transcribed.

### Added

- **Recording pages.** `sourceType: drive-media`, marked `Video` or `Audio` in
  the sidebar, `video` or `audio` in `data/docs-index.json`, `llms.txt` and the
  MCP server's `format`. The title is the Drive name without its extension.
  The page opens with a sentence of facts, its length and frame size when
  Drive reports them, then the description written in Drive, whose first line
  is its summary; its web and mail addresses become links.
- **Drive's player on the page.** An uploaded recording's card frames
  `drive.google.com/file/d/<id>/preview` in the video's own shape, with a link
  to it in Drive below. Drive's sharing decides who may play it. Google Vids
  has no player to frame, so its card has the link alone.
- **Content health** notes a recording with no description in Drive
  (`media-undescribed`). The sync report's `summary.published` gains `media`.
- **The manifest** records `exportMode: video` or `audio`, and for a recording
  a `sourceChecksum` of the metadata its page is written from, so a page is
  written again when its description or length changes.
- The inventory asks Drive for each file's `description` and
  `videoMediaMetadata`.

### Changed

- **The private deployment's Content Security Policy** admits frames from
  `https://drive.google.com`, and from nowhere else.
- **A link to a recording**, by its Drive or Google Vids address, leads to its
  page, as a link to a published PDF does.
- **Video and audio are no longer listed as not on the site.** The
  `media-file` reason is retired; a report that names it still validates until
  the next sync replaces it.

### Upgrade note

Bump the packages and the workflow pins, then run a sync: every recording in
the published folders gets a page on it. No existing page changes. In Safari,
or any browser that blocks third-party cookies, Drive's player cannot use the
reader's Google sign-in and shows an error or a sign-in request; the link
below it always opens the recording in Drive.

## 0.21.4

### Fixed

- **A deployment no longer fails between a platform upgrade and the next
  sync.** The sync report records the version of the Markdown its lengths
  were measured on, `documentLengths.markdownVersion`, and the gate compares
  the content health page's length notes with what the MCP server returns
  only when that version is the one the build writes. After 0.21.0 changed
  the Markdown, every deployment before the first sync failed on notes the
  last sync had measured on the old text.

`PUBLISHED_MARKDOWN_VERSION` in `@ctcstack/ctcdocs-core/published-markdown`
moves whenever the Markdown version of a page changes.

## 0.21.3

### Fixed

Spreadsheet pages read the way a model is laid out:

- **A note beside an input stays with it.** A column of text beside a
  block, on rows the block fills, joins it even across an empty column, and
  a label and value with notes reads `Label: value — note`. It used to be cut
  off into a list of its own after the inputs.
- **A table split by empty rows keeps its header.** A table whose first row
  is data, written with a currency, a percent, a fraction or more than four
  digits, takes the header of the table above it on the same columns, and
  its formulas are named by that header. It used to take its first row of
  data for a header. A header of years is still a header.
- **A sentence on its own line is a paragraph.** A caption is a heading when
  it is at most 80 characters and does not end like a sentence.
- An empty column a block spans is no column of its table.

`sheetVersion` moves to 2, so the next sync reads every spreadsheet again
once, unchanged uploaded files included.

## 0.21.2

### Fixed

- **The browser suite's spreadsheet test reads a real corpus.** It opens the
  spreadsheet with the fewest table rows among those it can filter, rather
  than the first, and audits accessibility with the first fifty rows of each
  table left on the page: on a page of thousands of rows the audit outlasted
  the test's thirty seconds and stopped a sync's build.

## 0.21.1

### Fixed

- **A column of single values is a list again.** Its first line was taken
  for a caption over the rest, line after line, so every value became a
  heading, and a column of a few thousand values, a list of keywords,
  overflowed the stack and stopped the sync. A caption is now a line on its
  own above a table, or above a single note.
- **One spreadsheet no longer stops a sync.** Whatever stops a
  spreadsheet's conversion holds back that spreadsheet (ADR-026), with the
  kind of error as its detail, and the rest of the site is published.
- **An unexpected sync failure names the kind of error**, such as
  `RangeError`, and still never its message.

## 0.21.0

Spreadsheets are published
([ADR-046](docs/ADR/046-publish-spreadsheets-as-tables.md), proposed): a
Google Sheet, an Excel workbook or a CSV file in a published folder gets a
page with each visible sheet as tables, and a sheet with formulas says how it
calculates.

### Added

- **Spreadsheet pages.** `sourceType: drive-sheet`, marked `Sheet` in the
  sidebar, `sheet` in `data/docs-index.json`, `llms.txt` and the MCP server's
  `format`. A Google Sheet is exported as `.xlsx`; an uploaded `.xlsx`,
  `.xlsm`, `.csv` or `.tsv` file is downloaded, and not again while Drive's
  checksum is unchanged. Hidden sheets, rows and columns are left out, and
  the page never names a hidden sheet. A CSV file may be UTF-8, UTF-16 or
  Windows-1251.
- **"How it is calculated"** under a sheet with formulas: each distinct
  formula once, the cells it uses named by their row and column labels or the
  workbook's defined names, then its inputs and results.
- **A spreadsheet's tables hold their header, filter and sort** on its page.
- **Content health** lists a spreadsheet cut short (`sheet-truncated`), one
  with charts or images the page does not show (`sheet-not-shown`), and a long
  one (`sheet-long`). The sync report's `summary.published` gains `sheets`.
- **The manifest** records `exportMode: sheet` and `sheetVersion`.
- **`numfmt`** 3.2.6 is a dependency of the sync package, for Excel's number
  formats.

### Changed

- **The Markdown version writes tables without padding, and splits a table
  longer than about 3,000 characters** into parts that each repeat its header,
  so a passage an assistant reads still says what each column is. Every
  page's Markdown, and so each document's stored copy and its measured length,
  changes once.
- **A link to a Google Sheet** in the corpus leads to its page, and one
  outside it is noted like a link to a Google Doc outside it.
- **`.xls` and `.ods` files** are listed as "Spreadsheets in an older format",
  with the advice to save them as Google Sheets.

### Upgrade note

Bump the packages and the workflow pins, then run a sync. Every spreadsheet
in the published folders gets a page on that sync, and every page's Markdown
version is rewritten once for its tables, so the MCP server stores every
document again on its next schedule.

Spreadsheets are published to everyone their folder's rule names. Before the
first sync, tell editors that a spreadsheet in a published folder is now on
the site, and that hiding a sheet, a row or a column, or moving the file out
of the published folders, keeps it off.

A platform older than this cannot read a manifest that records a spreadsheet.

## 0.20.0

An assistant's search shows the chunks that match whole, never cut, and lists
the other documents it found, fifteen in all; `browse` lists a folder as a
tree within a budget; and every tool gives a document's date, length and
format the same way
([ADR-044](docs/ADR/044-assistants-list-a-folder-and-recent-changes-and-narrow-a-search.md),
still proposed). A project measures its search with the platform's own code.

### Added

- **`search` takes `limit` and `compact`**: fewer documents, or titles,
  links, folders and dates alone.
- **`characters` on every document a tool lists**, the length of the text
  `fetch` returns, so an assistant knows what reading one costs; `fetch`
  gives the whole document's length however much it returned.
- **`fetch` names its `format`**, `doc` or `pdf`, and a PDF's `pages`, which
  the build reads from a new `ctcdocs:pdf-pages` meta on the document's page.
- **`browse` takes `depth`**, to cap the levels of its tree.
- **`mcp.browseCharacters`**, the budget of a `browse` tree, 24,000 unless a
  project sets another, and **`mcp.recent.defaultResults`** and
  **`mcp.recent.results`**, twenty and fifty: the numbers `browse` and
  `recent` used to fix.
- **`ctcdocs-eval-search`** runs a project's own questions,
  `evaluation/search-questions.json`, through the Worker's `searchDocuments`
  against its AI Search instance, under variants that change one setting
  each, and writes each run to `evaluation/results/<date>-<label>/`: rank,
  recall, and whether the passages of the documents a question needs show the
  words its answer holds. It writes no document text.

### Changed

- **`search` no longer cuts a passage.** It takes the chunks that count in
  the index's order, across documents, and shows each whole while the budget
  holds, at most `passagesPerResult` of one document; a chunk that does not
  fit is left out and counted in `morePassages`, and a chunk a shown one of
  its document already holds is shown once. The other documents found are
  listed without `text`. Measured on one deployment's corpus, the answers
  shown rose from 23 to 25 of 32 and the recall of the list from 0.859 to
  0.916.
- **`mcp.search.results` lists 15 documents unless set**, not ten.
  `mcp.search.passageCharacters` takes 1,000 or more, no longer 100 for each
  result, so every configuration 0.19.0 accepted is still accepted.
- **`browse` returns a nested tree**: what is directly in the folder, then its
  folders level by level, those taking the fewest characters first, each
  listed whole or collapsed with its name and count. A document is listed
  with its id, title, day and length, and one `links` pattern replaces a URL
  on each entry. Without a folder it lists the whole knowledge base, as far as
  the budget holds.
- **Dates are `YYYY-MM-DD`** in `search`, `browse` and `fetch`, and to the
  minute in UTC in `recent`, instead of Drive's time to the millisecond.
- **`fetch` puts `metadata` before `text`**, and an unknown id says to find
  one with `search`, `browse` or `recent`.
- **A note for the assistant is a `note` field of the answer**, not a text
  item beside the JSON: Claude Code gives the model only a result's structured
  content, so it never saw the notes `search` and `browse` sent.

### Upgrade note

Bump the packages and the workflow pins. Assistants see the new shapes after
their next tool listing; a script that parsed the old ones, `search` results
always carrying `text` or `browse`'s flat lists, needs updating.

Every passage is now a whole chunk, so the instance's chunk size decides how
many fit the budget: about seven of AI Search's default 1,024 tokens. Measure
an instance of smaller chunks over the same bucket with
`ctcdocs-eval-search --instance <name>` before binding it; on the corpus
measured, 800 tokens ranked best in both of its languages. Keep
`mcp.search.contextChunks` at 0: neighbouring chunks now lengthen every
passage instead of being cut away.

## 0.19.0

Assistants can list a folder and the latest changes, and keep a search to a
folder or a date
([ADR-044](docs/ADR/044-assistants-list-a-folder-and-recent-changes-and-narrow-a-search.md)).
Admins get an access review page that shows who may read each folder
([ADR-045](docs/ADR/045-an-access-review-page-shows-admins-who-may-read-each-folder.md)).
Both records are proposed.

### Added

- **`browse` and `recent`**, two more read-only MCP tools. `browse` lists a
  folder by its path, as results return it: its folders, each with how many
  documents under it the reader may open, and its documents. `recent` lists
  the documents changed last in Drive, newest first. Both read the build's
  catalog, judged per reader as `fetch` is, and name no folder the reader may
  open nothing in.
- **`search` takes `folder` and `changedSince`.** The Worker asks AI Search
  only for the matching documents, or excludes the rest, by short ID, and
  keeps only matching documents in any case. Nothing is reindexed.
- **An access review page for admins**, at `/access-review/`, built for a
  project with access rules. Folders are rows and the groups the rules name
  are columns; it lists what needs attention (folders without a rule,
  documents with fewer readers than their folder, drifted rules), reads the
  site as a set of groups or a machine key, and lays over the rules what holds
  now: each group's size, a group that admits no one, a stale directory. It
  names no person. The admin-only status route also answers how many people
  read each class, and the machine keys, as counts.
- **`home.start`** names the hand-authored page a newcomer reads first; the
  home page links to it by its title.

### Changed

- **Every search's filter stays within AI Search's limits**, which it does
  not document: keyword search takes at most 40 values in one list, and a
  hybrid search with more silently ranks by meaning alone; past 100 the
  search fails; and a filter's JSON is under 2,048 bytes. A reader of more
  than 40 classes lost keyword search on every search; their classes now go
  as `$nin` of the others when those fit.
- **Links that leave the site open in a new tab**, with
  `rel="noopener noreferrer"`; links to any of the site's own hostnames stay.
- The home page no longer links every deployment to `/about-wiki/`: it links
  to `home.start`, or to nothing.
- The sync accepts links to any hand-authored page, not only the home page
  and `/about-wiki/`.
- The search check accepts the full stop Pagefind ends a home page title
  with.
- On the access review page, what a reader cannot open is labelled and set
  in the secondary ink rather than faded.

### Upgrade note

Bump the packages and the workflow pins. A project whose home page linked to
`/about-wiki/` sets `"home": { "start": "about-wiki" }`, or the address of its
own page, to keep the link. Assistants see the new tools after their next
connection or tool listing; nothing else changes for them.

## 0.18.0

Every document converted from Google's HTML export, which is every document
with an image, keeps its bold, italic and struck text, its tables' marks and
links, and loses Google's wrappers in a merged table. The MCP server stores and
returns a document without its front matter, `fetch` names its folders and its
source, and the first measurement of search sets its defaults; see
[ADR-042](docs/ADR/042-an-assistants-search-returns-the-passages-that-match.md),
still proposed.

### Changed

- **Bold, italic and struck text from Google's HTML export.** Google draws
  them with classes of its stylesheet, which the converter removed without
  reading, so every document with an image lost every mark. The rules that
  name one class are read first, and a span that draws a mark becomes
  `**`, `*` or `~~`. A heading's bold is not repeated, marks Google splits
  over several spans are joined, and where Markdown would not read the
  delimiters (punctuation inside the mark and a letter or another mark beyond
  it) the mark is written as its HTML element.
- **Markdown tables keep their cells' marks, links and paragraphs.** A cell
  was its plain text: marks and links were lost, and paragraphs ran together.
  A cell's paragraphs and line breaks are now `<br>`, and a pipe is escaped.
- **Tables with merged cells** keep their cells without Google's paragraph
  and span wrappers, its no-break spaces and its default `colspan="1"
rowspan="1"`.
- The converter version is `hybrid-v4`, so the next sync exports every
  document again, once.
- **The MCP server keeps each document without its front matter.** The copy
  in R2, and so the index, no longer holds the sync's bookkeeping; the
  catalog hashes that text, so a sync that changes only the front matter
  rewrites nothing. The content health page measures the same text.
- **`fetch`** adds `path`, the folders as a list, and `source`, the Google Doc
  or PDF in Drive, to its `metadata`. A document cut at `mcp.fetchCharacters`
  ends with a line saying it continues and where the whole of it is, and is
  never cut inside a character.
- **`search`** cuts a passage with no sentence end between words, not inside
  a word or a tag.
- **`mcp.search.contextChunks` defaults to 0.** With AI Search's default
  1,024-token chunks, neighbouring chunks changed no ranking and only added
  text the Worker cut away.
- `mcp.search.vectorThreshold` is described as it behaves: AI Search ignores
  it while reranking is on.
- ADR-042 records the first measurement of search: 34 questions in English
  and Russian, one setting varied at a time, and 512-token chunks on a second
  instance. ADR-043 measures the text `fetch` returns. The runbook says how
  to see documents an index left in error or running.

### Upgrade note

Bump the packages and the workflow pins. The next sync is a full export
(`hybrid-v4`), and a targeted sync is refused until it has run. After the
deploy that follows, the MCP server rewrites every document in its bucket
once and AI Search reindexes them. A project that set
`mcp.search.contextChunks` to 0 may drop the line.

## 0.17.0

AI assistants can read a private deployment as the person who connected
them, through an MCP server the site's Worker serves; it is off unless a
project turns it on. Search returns the passages that match, and the content
health page names documents too long for an assistant to read whole. See
[ADR-041](docs/ADR/041-agents-read-the-site-through-an-mcp-server-as-their-reader.md),
[ADR-042](docs/ADR/042-an-assistants-search-returns-the-passages-that-match.md)
and
[ADR-043](docs/ADR/043-content-health-names-documents-too-long-to-read-whole.md);
the last two are proposed, and their numbers are starting points, each a
setting.

### Breaking

- The `sync` section of `site.config.json` refuses a setting it does not
  know, as `mcp` does, so a misspelled line fails instead of falling back to
  its default. Remove any stray key from it.

### Added

- **An MCP server**, with `"mcp": { "enabled": true }` in `site.config.json`,
  on a deployment whose every environment is private and has `signIn`.
  - Any assistant connects at `https://<host>/mcp` — claude.ai, ChatGPT,
    Claude Code, Cursor — by CIMD or dynamic registration, through one
    consent page and the site's own Google sign-in. The grant keeps the
    person's Google ID only, and every request needs the `kb:read` scope.
  - `search` and `fetch` read the person's groups from the directory snapshot
    on every request, so an assistant sees exactly what its person may open
    on the site, and a stale snapshot opens only what every member reads. A
    document is judged by the build's own list, never by the bucket.
  - `search` returns up to ten documents, each with up to three passages that
    matched, its folders and when it changed. A passage counts only when the
    reader may read the class it came from. `fetch` returns a document's
    Markdown, cut at `mcp.fetchCharacters`.
  - Every five minutes the Worker publishes the build's Markdown to an R2
    bucket and asks AI Search to index it; a rollback publishes its own build.
  - `mcp.search` and `mcp.fetchCharacters` tune the search per project, each
    optional and checked against the range AI Search accepts.
  - `ctcdocs-sync validate` requires, with the server on, each environment's
    own `OAUTH_KV` namespace, `KB_DOCUMENTS` bucket and `KB_SEARCH` instance,
    the `global_fetch_strictly_public` flag and the five-minute cron. With it
    off, the bindings may stay.
  - The access smoke test checks that `/mcp` asks for a token after a deploy;
    after a rollback, which may restore a version without the server, it does
    not require it.
  - The denial suite publishes the fixture build and asks both tools for
    every document as each reader.
- **Long documents on the content health page.** The sync measures every
  page's Markdown version, the text `fetch` returns, and notes a Google Doc
  over `sync.largeDocumentCharacters` (40,000 characters unless the project
  sets it) under Improve, as worth splitting, and one over
  `mcp.fetchCharacters` (100,000 with the server off) under Fix next, since
  assistants read only its beginning. A long PDF is noted, not told to split.
  The sync report records the lines it measured against, and the denial suite
  requires the documents `fetch` cuts to be the ones the report names.
- `@ctcstack/ctcdocs-core/published-markdown`, the one serializer of a
  page's Markdown version, which the site serves and the sync measures.

### Changed

- The Pagefind check searches for the first document of each format before
  the rest, so a PDF's page is always among its cases.
- The rollback workflow tells the smoke test that it restores an older
  version.

### Upgrade note

Bump the packages and the workflow pins. Check that the `sync` section holds
only `generatedBy`, `commitBotName`, `defaultLocale`, `largeImageMegabytes`
and `largeDocumentCharacters`. The next sync writes the length notes.

To turn the MCP server on, follow
[Step 16](docs/NEW_PROJECT.md#step-16-let-ai-assistants-read-the-site-optional)
and [Cloudflare setup](docs/CLOUDFLARE_SETUP.md#the-mcp-server): per
environment, an OAuth namespace, a documents bucket and an AI Search instance,
and the account's AI Search token once.

## 0.16.2

### Fixed

- **Sign out** took about 25 seconds in Chrome: the `Clear-Site-Data: "cache"`
  header it sent makes Chrome clear the whole cache before it moves on. The
  header is gone; instead a page is served `private, no-cache`, so it is
  checked with the Worker every time it is shown and none read before signing
  out is shown from the cache afterwards. Markdown, images and search data keep
  their minute.
- The Content Security Policy blocked a font the build inlines as `data:`,
  and a PDF's page, which shows the file in an `<object>`. It now allows
  `font-src 'self' data:` and `object-src 'self'`.

## 0.16.1

### Fixed

- A signed-in reader who asks for a missing address gets the 404 page again,
  not a plain "Not found". The Worker asked the asset store for `/404.html`,
  which `auto-trailing-slash` answers with a redirect the Worker does not
  follow; it now asks for `/404`, and fetches any `.html` file by the address
  the store serves it at. The denial suite's asset store now redirects as the
  real one does, and checks that a missing page is the 404 page.

## 0.16.0

A private deployment now signs its readers in itself and opens each folder
only to the Google groups allowed to read it. Cloudflare Access is no longer
part of the platform. See
[ADR-038](docs/ADR/038-a-private-deployment-signs-readers-in-itself-with-google.md),
[ADR-039](docs/ADR/039-open-a-folder-only-to-the-google-groups-its-rule-names.md)
and
[ADR-040](docs/ADR/040-a-worker-cron-keeps-a-snapshot-of-group-membership.md),
which supersede ADR-004.

### Breaking

- A deployment with any private environment must be served through the
  platform's Worker: `ctcdocs-sync validate` fails until `site.config.json`
  has `signIn`, `wrangler.jsonc` deploys the gate, and
  `wrangler.directory.jsonc` exists. Move off Cloudflare Access as the
  upgrade note below describes; a rollback refuses any version deployed
  before the gate.
- `.ctcdocs/` must be ignored by Git on every deployment, and a private one
  may not have `public/_redirects`.
- `auth`, `pagefind` and `assets` are reserved addresses; a corpus already
  holding one fails validation until the source is renamed in Drive.
- The smoke environments take `CTCDOCS_MACHINE_KEY`, and the rollback caller
  passes a `restore_older_secrets` input.
- The manifest gains `publishedReaders`, `publishedChain` and `readersHeld`
  when an `access` section exists; older manifests still load.

### Changed

- **A deployment with any private environment is served through the
  platform's Worker**, `@ctcstack/ctcdocs/worker`, which runs before every
  asset. Readers sign in with Google — an OAuth client of the organization's
  own, with an Internal consent screen — and are identified by their Google
  user ID; a session lasts twelve hours and is honored only while the directory
  lists the reader as active. Every file is served only to the readers its
  access class names, over HTTPS only, with the response headers `_headers`
  used to set, `Strict-Transport-Security` and a Content Security Policy; the
  Worker follows no redirect from the asset store. The Worker uses
  web-standard APIs only, with Cloudflare confined to its entry points.
- `ctcdocs-sync validate` requires of such a deployment a `signIn` section, a
  `wrangler.jsonc` that deploys the platform's Worker with `run_worker_first`,
  the access map alias, a `KB_STATE` namespace and a `GOOGLE_CLIENT_ID`
  variable in each environment, and a `wrangler.directory.jsonc` with no route;
  it refuses `public/_redirects` there. Every project must keep
  `.ctcdocs/` out of Git.
- `ctcdocs-access-smoke` proves admission with a machine key
  (`CTCDOCS_MACHINE_KEY`), and also sends an Access service token while one is
  configured; a redirect to sign-in counts as a denial. It picks a document
  every member may read from the configuration and the manifest, reads the
  project's `.env` without overriding the environment, and `--anonymous` runs
  on a project that has not synchronized yet. The Playwright access suite
  takes either credential.
- The deployment workflow runs the denial suite, deploys the directory Worker
  before the site, with retries, and tags every version of a gated deployment
  `ctcdocs-gate-v1`. The rollback workflow refuses a version without that tag,
  passes the smoke key to its boundary check, and refuses a version older than
  a change to the Worker's secrets — which a rollback restores — unless called
  with `restore_older_secrets`. The reusable CI and sync workflows run the
  denial suite too.
- `auth`, `pagefind` and `assets` are reserved addresses.

### Added

- `signIn.workspaceDomains` in `site.config.json`: the organization's domains,
  whose accounts may sign in.
- A directory Worker, `@ctcstack/ctcdocs/worker/directory`, which reads the
  members of every group the rules name, and the users of each domain, every
  ten minutes through the Directory and Groups Settings APIs, and writes one
  snapshot to KV. Groups are pinned to their Google IDs. A group that is
  nested, holds the organization, lets people join themselves, admits
  outsiders, was recreated, or whose members or settings cannot be read admits
  no one, and the rest is still written. A failure that may pass stops the run
  and keeps the last snapshot, and so does a result that loses more than a
  fifth, and at least five, of the users or of a group's members beyond those
  listed as suspended or archived — unless an operator sets
  `directory-accept-next`. With no snapshot no session is admitted; with one
  older than two hours a reader reads only what every member reads. Failures
  are logged by stage and status, never by address.
- Machine keys for the smoke test and for agents: `ctcdocs-machine-key`
  issues one, valid for at most 90 days, and prints the record the
  environment's `machine-keys` list in KV keeps — a hash, a name, an owner,
  groups and an expiry. A key is never an administrator.
- `/auth/sign-in`, `/auth/callback`, `/auth/sign-out` and `/auth/signed-out`;
  **Sign out** in the header and the mobile menu, which also clears the
  browser's cache of the site; a page for someone the directory does not list,
  who gets no session; `/_kb/classes`, which lists a reader's search bundles;
  and `/_kb/status`, where an administrator reads the snapshot's age and
  counts.
- `ctcdocs-verify-gate`, the denial suite: the real gate in front of the real
  build, asked for every file as nobody, a members-only key, a key per
  restricted class and an administrator, without a network.
- `project-probe.yml`, a reusable workflow that asks production anonymously
  for a page, a Markdown file, the agent index and the search runtime, on the
  caller's schedule, and fails when any is admitted.
- An optional `access` section in `site.config.json` names who may read each
  Drive folder: admin groups, and per folder the Google groups that may read
  it, or `"*"` for every member. A document's readers are the groups every
  rule on its folder chain names; a folder with no rule is closed to all but
  the admins.
- A move in Drive never widens a document's readers by itself. A rule change
  takes effect at once; a document moved to a place whose rules would let more
  people read it is published to the readers both places allow, listed under
  Fix now ("More people would read the document than before") and shown by
  title alone on its folder's page, until a rule on its new chain is added or
  changed. The manifest records `publishedReaders`, `publishedChain` and, while
  a move waits, `readersHeld`.
- The content health page and the sync job summary list folders closed for
  want of a rule, rules whose label no longer matches the folder, rules for a
  folder the corpus does not have, and groups a rule names that the rule above
  does not. With an `access` section, the content health page is readable by
  administrators only.
- The `llms.txt` indexes describe a document only in an index of its own
  access class and list the rest by title and address, and a home page folder
  card takes its description only from a document every member may read.
- Every build writes an access map, `.ctcdocs/access-map.json`, outside
  `dist`: the access class of every built file, which the Worker is bundled
  with. Once rules exist, a file the map cannot place fails the build, and so
  does a listing that shows an image of a document with fewer readers.
- Search is split by access class: Starlight's own Pagefind run is off, and
  the platform writes `/pagefind/` for every member and `/pagefind-<class>/`
  for each other class. The search box and the 404 page merge the bundles the
  Worker lists for the reader at `/_kb/classes`, and search `/pagefind/` alone
  where that route does not answer. `ctcdocs-verify-search` searches each
  document in its own class's bundle and checks that no narrower document is
  found in `/pagefind/`.
- Once rules exist, the build fails when a file readable by a wider class
  repeats a run of eight words found only in documents of a narrower class —
  an index description, a listing excerpt, a quoted heading. Titles, folder
  names, navigation and addresses are not counted, line breaks and alt text
  stay inside their paragraph, and the failure names the file, the document
  and the word offset, never the words.

### Upgrade note

A private deployment fails validation on this release until it is moved off
Cloudflare Access. Follow
[Cloudflare setup](docs/CLOUDFLARE_SETUP.md#moving-a-deployment-off-cloudflare-access),
which keeps Access in front until the Worker is proven. In short:

- In Google: per environment, an OAuth client with an Internal consent screen
  and its redirect URI; a directory-reader service account with a JSON key per
  environment, a custom admin role granting Users → Read and Groups → Read
  assigned by a super administrator, the Admin SDK and Groups Settings APIs
  enabled; an administrators group. See
  [Google Workspace setup](docs/GOOGLE_WORKSPACE_SETUP.md#sign-in).
- In Cloudflare: Workers Paid; Always Use HTTPS; a KV namespace per
  environment; the secrets `GOOGLE_CLIENT_SECRET` and `SESSION_SECRET` on the
  site Worker and `DIRECTORY_KEY` on the directory Worker; the smoke key's
  record in `machine-keys`; a deploy token without Workers KV permissions.
- In the project: `signIn` and, if folders are to be closed, `access` in
  `site.config.json`; `wrangler.jsonc` and a new `wrangler.directory.jsonc`
  following the fixture project; `.ctcdocs/` and `.dev.vars` in `.gitignore`;
  no `public/_redirects`; `deploy:dry-run` covering both Workers.
- In GitHub: `CTCDOCS_MACHINE_KEY` in each smoke environment; the rollback
  caller passing a `restore_older_secrets` input; a caller of
  `project-probe.yml` on a schedule; and, once Access is gone,
  `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` removed.
- A public deployment needs only `.ctcdocs/` in `.gitignore`.

## 0.15.0

### Changed

- The content health page is ordered by priority: **Fix now**, **Fix next**,
  **Improve**, **Tidy up**, and the proposed title convention last, which is
  not required yet. Every group of findings, whether a check, a reason a file
  is not on the site or a note, sits under one of them, each in its own color
  with an icon and a label, quieter as the priority falls. See
  [ADR-037](docs/ADR/037-rank-the-content-health-page-by-priority.md), which
  supersedes ADR-024 and ADR-028 in part, and ADR-011 in part for status
  colors on this page.
- The page opens on the whole knowledge base: the number of files in the most
  urgent state, with a link to them, how many files are on the site, and a bar
  of every file by its most urgent task, its states named apart from the
  priorities. "Where the work is" follows: tasks by section and by last
  editor, and choosing a row filters the page to it.
- A group is folded to one line, what it is, what to do, how many files and
  where, except under Fix now; within a priority, files not on the site come
  first under their own heading, and the largest group first. A file leads with
  "Open in Google Docs" or "Open in Google Drive"; its page is a quieter link.
  A letter typed in the other alphabet is named in words and marked in its
  heading. The checks that were all clear are listed under their priority.
- The section and editor filters sit in a toolbar that stays at the top of a
  wide screen, with a chip per priority, and narrow every task list and count.
  The address keeps the filter, a filtered view offers to copy its link, and
  such a link opens on the tasks, unfolded when there are 15 or fewer.
- The old section anchors `#not-on-the-site`, `#notes`, `#fix`, `#convention`
  and `#note` are replaced by `#fix-now`, `#fix-next`, `#improve`, `#tidy-up`
  and `#proposal`. A group keeps its own anchor.
- Each title check carries a short action, as reasons and notes do, written to
  `data/title-report.json`. The page leaves it out for a report written before.

### Added

- `--kb-red`, `--kb-orange`, `--kb-blue`, `--kb-green` and `--kb-purple`, with
  a `-low` step each, read in the adapter from Starlight's aside palette, which
  sets them per theme. Only the content health page uses them.

### Removed

- `HealthSummaryTable.astro`: a group's folded line replaces its row.

## 0.14.0

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
- The content health page checks a Google Doc's headings: "A heading skips a
  level", judged as the page shows it, and "Two headings say the same", both
  under "Worth a look", with a link to the line in Google Docs. See
  [ADR-034](docs/ADR/034-check-headings-summaries-and-outside-links.md).
- Two notes: "The page has no summary", for a Google Doc with no paragraph of
  plain text, and "A link leads to a Google file that is not on this site",
  for a link to a Google Doc or Drive file outside the published folders.
  Spreadsheets, slides, folders and `open?id=` links, whose address does not
  say what the file is, are not counted.

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
- A link to a Google Doc copied from a signed-in account
  (`/document/u/<n>/d/…`), to a Google Doc's other views (none, `preview`,
  `mobilebasic`, `pub`) and to a Drive file (`/file/d/…`) now opens the site's
  page when the file is published, such as a PDF. A link asking for a copy or
  a download stays as it is.
- The source facts in `data/title-report.json` are version 4. The first normal
  sync after upgrading exports every Google Doc once more to read them: it
  takes as long as a full sync, and, like one, rewrites a page wherever
  Google's export or the link handling now differ from when the page was last
  written.
- A folder's page now opens its sidebar group, as "Overview", when the folder
  holds no document with a landing title, numbered or not, and no subfolder
  labeled like it, so a group never lists two entries with one name. The
  label is the first of `navigation.landingDocumentTitles`. The item names its
  folder in `aria-label`, "Reference: Overview", which the previous and next
  links now show in place of the sidebar label. The page is highlighted in
  the sidebar when open, and takes its place in previous and next. See
  [ADR-035](docs/ADR/035-open-a-folder-with-its-page-when-it-has-no-landing-document.md),
  which supersedes ADR-014 in part. The sidebar changes on the next sync.
- The browser suite runs its accessibility audits once the page's running
  animations have finished, waiting two seconds at most. Switching the theme
  fades a sidebar link's background over 150 ms while its text changes at
  once, and an audit in between failed on a frame no reader stops on.

### Fixed

- The home page is found in search by its title alone. Its folder cards,
  recent documents and interface text were indexed, so it came back beside
  nearly every document a search found, and the 404 page could offer it in
  place of the page a stale address named. A folder with no page of its own is
  now found by its name at its heading in the full index, which was the only
  text naming it that the home page's exclusion would otherwise take away. See
  [ADR-036](docs/ADR/036-index-the-home-page-by-its-title-and-a-folder-where-it-has-its-address.md),
  which supersedes ADR-017 in part.
- `ctcdocs-verify-search` checks again that interface text stays out of the
  search index. It searched for a sentence no component renders any more, so
  the check passed on every build without testing anything. Elements whose
  text must stay out of the index are now marked `data-ctcdocs-unindexed`; the
  check fails when a build marks nothing, and when any marked element on any
  page lacks `data-pagefind-ignore`. Pagefind itself then confirms that a
  marked page indexes the same as the page without its marked elements, and
  that the home page indexes only its title. A project that replaces the
  platform's components keeps the marks.

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
