# ADR-055: The secret scan reads generated Markdown as plain text too

- Status: Proposed
- Date: 2026-11-22
- Owners: CTCDocs maintainers
- Supersedes: none; amends ADR-018

## Context

ADR-018 made the sync scan every file it commits with gitleaks, and a finding
stop the run. The scan reads the generated Markdown as written. gitleaks finds
two kinds of secret: vendor formats it knows, and values matched by its
generic rule, which looks for a keyword, an assignment, a value, and then
whitespace, a quote or the end of the line.

People type credentials into documents as prose, and the converter writes
that prose as Markdown. The Markdown changes how a value ends:

- emphasis closes it with `**` (`**API Key:** value`);
- the converter escapes punctuation, and CommonMark keeps the escape inside an
  autolink (`API\_ID=value`);
- an autolink closes it with `>` (`<https://host/path?token=value>`);
- a URL joins its query parameters with `&`.

The generic rule reads none of these as the end of a value. An audit of a
deployment found credentials in published documents that the scan had passed,
and reproduced the miss with synthetic look-alikes against gitleaks 8.30.1:
written as Markdown, none was found; written as plain text, they were.

## Decision

**Generated Markdown is scanned twice: as written, and as plain text.** The
second scan reads a view in which the Markdown no longer shapes the text.

- **The view is made with the Markdown parser the sync already uses**
  (`remark-parse` with `remark-gfm`), and HTML inside it with `htmlparser2`.
  Text and code are written as they read, with emphasis gone and table cells
  kept apart by `|`. Every URL is written on its own, followed by each query
  parameter as `name=value`, after the converter's punctuation escapes are
  undone. The `resourcekey` that Drive writes into the address of a file
  shared by link is left out of a Google URL: it is part of the address Google
  hands out, which the document already publishes as a link, and the scan of
  the Markdown never matched it, so writing it apart would stop syncs that
  passed before over a value nobody typed.
- **Same paths, same line numbers.** The view has the file's line count, and
  every piece of text stays on its line: a link's URL on the line that holds
  it when the link text wraps, an HTML attribute on its own line, and HTML
  inside a list item or a quote on its lines although the parser strips the
  container's indent from it. A finding in the view has the
  fingerprint the file would give, so a `.gitleaksignore` entry covers both
  scans alike, and the gate's rules, configuration and pin are unchanged.
- **The view never leaves the scan.** It is written to the scan's temporary
  snapshot, next to the copy of the files, and removed with it.
- **A finding only the view shows says so.** It is logged as its rule, path,
  line and Google file ID, with `view=plain-text`. A place found by both scans
  is reported once.

## Consequences

- Values that Markdown hid from the generic rule are found before commit:
  tokens in autolinked URLs and query parameters, and assignments split by
  emphasis.
- The scan runs gitleaks twice when a run changes Markdown. The view is small
  next to the files, and the scan's cost is in starting the scanner.
- The view does not make the generic rule understand prose. A value after a
  dash (`API Key - value`), a value of too little entropy, or a credential of
  an unknown service is still not found by the default rules. A project adds
  rules for those to its own `.gitleaks.toml`, and they apply to both views.
- Secrets in images are not read by either scan.
- The project CI's history scan still reads the files as written; the view is
  a check of the sync's commit only, as ADR-018's scan is.
