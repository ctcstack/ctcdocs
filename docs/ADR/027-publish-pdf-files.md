# ADR-027: Publish PDF files from Drive

- Status: Proposed
- Date: 2026-09-28
- Owners: CTCDocs maintainers
- Supersedes: ADR-020 in part: a document named with a letter from another
  alphabet is held back instead of stopping the run

## Context

Teams keep PDF files next to their Google Docs: signed policies, vendor
manuals, exported slides, scans. The sync published Google Docs only, so a PDF
in a published folder never reached the site. ADR-025 made that visible; it
did not make the PDFs readable where the rest of the documentation is.

A PDF cannot be converted into a page the way a Doc is. Its layout is the
content, and no conversion to Markdown keeps it reliably, let alone the same
way twice. What a reader needs is the file itself, and what search and agents
need is its text.

Cloudflare Workers Static Assets serves files of up to 25 MiB. Google's 10 MB
limit applies to exports, not to downloading a file stored in Drive. Generated
output is committed to Git (ADR-002), so every file the site serves is kept in
the project's history.

## Decision

**A PDF under the publication root is a document.** It gets a page, an
address, a permanent link, a place in the sidebar marked `PDF`, an entry on its
section page and in the full index, like a Google Doc. Its title and address
come from its Drive name without the `.pdf` extension.

**The file is published as it is.** The sync downloads it with `files.get`
and `alt=media`, which the read-only `drive.readonly` scope allows, and writes
it to `src/assets/generated/<file ID>/<name>.pdf`, the name being its title in
Latin letters and digits. The site serves it from `/assets/generated/`, behind
the same identity boundary and the same private, short-lived, `nosniff`,
`noindex` rule as the images there. The page shows it in the browser's own PDF
viewer, which runs apart from the page, with links to open it on its own and to
download it. A browser without a viewer, as on most phones, shows the links.

**Its text is on the page too.** PDF.js, through `unpdf` 1.8.1 (MIT, no
dependencies, PDF.js 6.1), extracts the text of every page, with font loading
and system fonts off. The text is built into a Markdown tree and serialized,
never concatenated, so nothing in a PDF becomes markup, a link or HTML on the
page; a bare web address becomes a link, as GFM makes any. Each page gets a
heading when there is more than one, and lines are joined into paragraphs by a
stated heuristic. The first paragraph that reads like text is the description.
Text beyond a million characters is left out. The text is what Pagefind
indexes, what `index.md` serves, what the secret scan reads (ADR-018), and it
is folded under the file on the page.

**Size decides what the page carries.**

- Up to 25 MiB: the file and its text.
- Over 25 MiB and up to 100 MiB: the text, and a link to the file in Drive.
- Over 100 MiB: the file is not downloaded, and the page links to Drive.

**Nothing is downloaded twice.** The inventory asks Drive for each file's
SHA-256, and the manifest records it. While it is unchanged, a sync, a full
one included, reuses the published file and text, moving the file when the
title changes.

**What is missing is listed** (ADR-025) with the status `incomplete`: a PDF too
large for the site to serve, one too large to read, and one with no text the
site can read — scanned pages, a password, damage — which is on the site but
not in search. A file Drive calls a PDF that is not one is held back as content
the site will not publish (ADR-026).

**The title report covers Google Docs only.** Its checks are about paragraph
styles, which a PDF does not have.

**A document named with a letter from another alphabet is held back**, not
refused. ADR-020 stopped the run for any such name, because the name becomes a
permanent address. That rule would now apply to uploaded files, which are named
on the computer they come from, and one of them would stop every update. A
document, Google Doc or PDF, named so is held back instead (ADR-026) and listed
with the letters to retype. It never gets the address, which was the reason for
the rule. A folder named so still stops the run: its name is part of the
address of everything in it.

**The data records it.** The manifest's `exportMode` gains `pdf`, and a PDF's
record carries `sourceChecksum`. The page's frontmatter says `sourceType:
drive-pdf`, turns off the table of contents, and records the file's name, size
and page count. `data/docs-index.json` gives each entry a `format`,
`google-doc` or `pdf`.

## Consequences

### Positive

- A PDF is read where the rest of the documentation is, found by search and
  read by agents through its text.
- An unchanged PDF costs nothing on later syncs.
- One uploaded file with an unexpected name no longer stops the sync.

### Negative

- Every version of every published PDF stays in the project's Git history,
  up to 25 MiB each. Removing a file from Drive does not remove it from
  history.
- The secret scan reads the extracted text, not the file. Text in the images of
  a scan, a file's metadata and files attached to a PDF are published unread.
- The file is published as it was uploaded, with its metadata and anything it
  embeds. Browser viewers do not run it with the page's privileges, but they
  do show attachments and forms.
- PDF.js parses files editors upload, in the sync job. It is a new production
  dependency of the sync package.
- The paragraph heuristic will misjudge some layouts. Tables and columns come
  out as runs of text.
- A PDF of scanned pages is on the site but not in search until someone
  replaces it with one that has text. The sync does no OCR.
- A platform older than this cannot read a manifest that records a PDF.
  Downgrading needs the PDFs removed first.

### Follow-up

- Consider OCR if scanned PDFs turn out to be common.
- Consider keeping PDFs out of Git history, in Git LFS or object storage, if
  they grow the repository beyond what is comfortable.
