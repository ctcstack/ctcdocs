# ADR-023: A report on how documents carry their titles

- Status: Proposed
- Date: 2026-09-27
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

A page's title is its Drive name, without the order prefix (ADR-013). A
document that opens with a Heading 1 equal to that name loses the heading as a
copy of the title. Every other Heading 1 is demoted to Heading 2.

Documents do not agree on where their title lives. Some open with the Title
style. Some open with a Heading 1 that is the title in a cleaner form than the
Drive name, which carries prefixes, underscores or a `.doc` left over from an
upload. Others open with a Heading 1 that is not a title at all, but the first
section. A page of the last kind shows its Drive name and then its first
section as a second heading. Taking the first heading as the title would fix
the second kind and break the third. How many documents fall in each kind is
not known.

The published output cannot say. The copy of the title is already gone from
the page, a demoted Heading 1 looks like any Heading 2, and the Markdown export
renders Title and Heading 1 alike. Only the source keeps the paragraph style an
editor chose.

A convention for editors and an algorithm for the pipeline both need these
numbers first.

## Decision

**The sync records how each document opens, and changes nothing.** The Docs
API request made for every exported document already exists. It now also asks
for each body paragraph's named style and text, and whether a block is a table
or a table of contents. Formatting is not requested. The Markdown or HTML
export already transfers the whole body, so no data leaves Google that did not
before. From the first tab, the sync records:

- the kinds of the first three non-empty blocks: title, subtitle, heading 1
  to 6, text, image, table, table of contents;
- the title candidate: the first Title paragraph, or else the first
  Heading 1, with its text and position;
- how many Title and Heading 1 paragraphs there are;
- whether the leading Heading 1 was dropped as a copy of the title.

**The report compares that with the Drive name.** For each document it
classifies the candidate against the page title as `identical`,
`normalized` (equal once case, spacing and punctuation are ignored),
`contains`, `contained`, `similar` (edit similarity of at least 0.6),
`different`, or `none`. It notes whether the Drive name carries an order
prefix, a prefix of underscore-joined words, underscores or a file extension.

**Headings that mix alphabets are reported, not refused.** Every heading in
the published body is checked with the rule ADR-020 applies to names. A word
mixing Latin, Cyrillic and Greek letters is listed with the heading's text and
the stray letter. A heading is content, so it does not stop a sync. The sync
log gives only the number of documents concerned.

**The report is generated data.** `data/title-report.json` joins the
generated files, written by every sync and validated against the manifest. It
carries a summary and one entry per document, sorted by address, with no
clock in it, so an unchanged corpus rewrites it byte for byte. A document that
is not exported again keeps the facts its last export recorded. Until then it
is reported as not yet inspected, and a full sync inspects every document.
`ctcdocs-sync titles` prints the summary, and with `--list`, the documents
behind each count.

## Consequences

### Positive

- A title convention and a title algorithm can be chosen from counts rather
  than impressions, and the report shows editors' progress once one is chosen.
- A heading with a letter typed on the wrong layout is found without stopping
  anything.

### Negative

- The Docs API responses are larger: they carry the text of every paragraph.
- The report quotes the title candidate and any heading with a stray letter,
  so a deployment's repository holds a little more of its documents' text.
  Its generated Markdown already holds all of it.
- Facts for a document not exported since the upgrade are missing until a
  full sync, or until the document is next edited.
- Only the first tab is read. A document whose title is in a later tab is
  reported as having none.

### Follow-up

- Decide the title convention and the algorithm in their own ADR once the
  report has numbers from a real corpus.
