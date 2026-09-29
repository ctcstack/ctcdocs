# ADR-034: Check headings, summaries and links that leave the site

- Status: Proposed
- Date: 2026-09-29
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

The content health page (ADR-024) and its notes (ADR-028) tell editors what to
fix in Google Docs. They cover titles, alphabets, images and what conversion
drops. They say nothing about a document's structure, which is what readers
navigate by and what an AI agent splits a page on. Documentation frameworks
lint authored Markdown for such things; here the Markdown is generated, so the
same questions have to be asked of the source and answered in Google Docs.

A first measurement on one deployment found a handful of documents whose
headings skip a level, about ten that repeat a heading, a few with no paragraph
of plain text, and dozens of links to Google Docs and Drive files that are not
on the site. The site shows those links as they are: a colleague with access in
Drive can follow them, a reader of the site outside Drive and an agent cannot.

The pipeline shows a Google Title and a Heading 1 at the page's second level,
beside a Heading 2, because the page's own title is its only first-level
heading. A Heading 3 and below keep their level.

## Decision

**The structure is read from the source, per tab.** The facts the Docs API
gives each exported Google Doc (ADR-023) gain the headings that skip a level
and the headings that repeat an earlier one, from each tab's top-level
paragraphs, with the heading ID and tab that open Google Docs at the line, ten
of each at most. Title paragraphs are left to the title checks. The facts' shape
is now version 4.

**A skip is judged as the page shows it.** A heading skips a level when its
level on the page is more than one below the previous heading's, or more than
one below the page's title for the first heading. A Heading 1 followed by a
Heading 3 is not a skip, because the page shows them one level apart; a
Heading 2 followed by a Heading 4 is. The detail names both styles, such as
"Heading 4 after Heading 2".

**A repeat is the same words.** Headings are compared after Unicode
normalization, case folding and collapsing whitespace, within a tab.

**Both are "Worth a look" checks** on the content health page:
`heading-skips-level` and `heading-repeated`.

**Two notes join the catalog.** `summary-missing`: a Google Doc with no
paragraph of plain text has no summary, so search results and its section
page show its title alone; it is read from the manifest,
which records the summary. A PDF is left out, because its summary is its
extracted text. `link-outside-site`: a link to a Google Doc or a Drive file
that is not in the corpus, recorded as the conversion warning
`link:outside_site` when the document is exported. Spreadsheets, slides and
folders are not counted, because the site does not publish them and an editor
could not move them onto it.

**Two more link forms are recognized.** A Google Doc link copied from a
signed-in account, `/document/u/<n>/d/<id>/`, and a Drive file link,
`drive.google.com/file/d/<id>/`, now resolve to the site's page when the file is
published, such as a PDF (ADR-027), and are noted when it is not.

**A normal sync reads new facts once.** A document whose recorded facts an
earlier shape wrote is exported again by the next normal sync, as images are
when their processing changes (ADR-031). A document with no recorded facts is
not forced, so an inspection that cannot run does not export it on every sync.

## Consequences

### Positive

- Editors see structural problems readers and agents meet, with a link to the
  line in Google Docs.
- A page that shows only its title in search and in the agent index is named,
  with the fix.
- Links that lead outside the site are listed per document, so an editor can
  publish what belongs in the documentation.
- A link to a published PDF through Drive now opens the PDF's page.
- The checks reach every document on the first sync after upgrading, with no
  full sync to remember.

### Negative

- The first normal sync after upgrading exports every Google Doc once, which
  takes as long as a full sync and spends the same API quota.
- An empty document is both a "Fix" check and a note without a summary.
- A skip that the page flattens, such as Heading 1 to Heading 3, is not
  reported, although Google Docs' own outline shows it.
- The link note does not say which link: the editor looks through the
  document, as for the other link notes.
- A repeated heading is sometimes intended, such as "Example" under two
  sections; the check asks for a look, not a fix.

### Follow-up

- Decide whether a Heading 1 and a Heading 2 should stay at one level on the
  page. Shifting every level down by one would keep the source's outline.
- Record which links lead outside the site, if the note alone proves too hard
  to act on.
