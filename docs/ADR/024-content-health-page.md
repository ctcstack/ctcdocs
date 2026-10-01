# ADR-024: A content health page that turns checks into work

- Status: Proposed; superseded in part by
  [ADR-037](037-rank-the-content-health-page-by-priority.md), under which the
  page is ordered by priority rather than by severity
- Date: 2026-09-27
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

ADR-023 made the sync record how each document carries its title, and list
headings that mix alphabets. That report is a JSON file and a terminal
command. It answers "how many", which is what an operator needs to decide a
convention. It does not answer the questions an editor asks: which documents
are mine to fix, what exactly is wrong in each one, and where in the document
it is.

A convention nobody can check will not be followed, and a list nobody can act
on will not be worked through. Editors do not use GitHub. The job summary of a
workflow run belongs to that run and expires. Comments in Google Docs would
reach editors where they write, but the sync's Google identity is
read-only by design, and it stays that way.

The site is where editors already are. It is behind the same Access policy as
everything they read, and it is rebuilt on every sync.

## Decision

**The report carries its checks.** Each check is one action a person can take
in Google Docs or Drive: a code, a severity, a title and an instruction worded
for the person taking it. The report lists the catalog once, and each
document lists the issues it has. An issue that concerns one paragraph records
that paragraph's heading ID. A link can then open Google Docs at the
paragraph. The checks are:

- **Fix.**
  - A heading mixes alphabets.
  - The document opens with another document's title, most likely copied
    with a template.
  - The document is empty.
- **Proposed convention: one Title line.** A document opens with its name as
  one line in the Title style, and uses Heading 1 to 3 for sections.
  - The title is styled as Heading 1: a single opening Heading 1 that does
    not read like a section.
  - The document has no title line.
  - The title is not the first line.
  - The Title style is used for a section.
- **Worth a look.** The Drive name starts with "Copy of", ends with a file
  extension, uses underscores, or has extra spaces.

"Reads like a section" is a heuristic, stated as one: a numbered heading, one
ending in a colon, or a generic word such as "Overview". Mixed alphabets are
now found in the headings of the source, with their IDs, instead of in the
published body. Title similarity takes the better of character edit
similarity and shared words, so a reordered title counts as the same title.

**Who last edited a document comes from Drive.** The inventory request asks
for each file's `lastModifyingUser(displayName)`, and the report records it.
The display name is the only personal field read. It is what lets the work be
shared out: each editor filters the page down to their own documents.

**The site publishes the page at `/content-health/`.** `content-health` is a
platform route, reserved like `documents`. The page is built from the report
at build time and groups issues by severity, then by check. For each check it
shows the instruction. For each document it links to its page on the site and
to Google Docs, at the paragraph when there is one, and shows its section, who
last edited it and the line concerned. Two filters, section and last editor,
narrow the list in the browser. Without script, the whole list stays visible.
The page is not in the sidebar or the search index. Before a sync writes a
report in this shape, the page says so and lists nothing.

**The job summary gets counts and a link.** After a sync, the workflow's job
summary lists each check with the number of documents that fail it, and links
to the page. It names no document. Titles and headings stay out of logs, as
before.

**Facts carry a version.** The report's source facts gained fields, so they
carry a version number. Facts recorded in an earlier shape count as not
inspected. The next export of a document records them again, and a full sync
does it for all of them.

## Consequences

### Positive

- An editor can be sent one address, filter it to their name, and fix each
  item from a link that opens the right line.
- Progress is visible on the page and in the job summary after every sync.
- A convention can be trialled before it is enforced. The page counts who
  already follows it.

### Negative

- Editors' display names are committed to the deployment's repository and
  shown on the site. Both are private to the organization, but it is personal
  data the platform did not hold before.
- The page lists document titles and headings. It is protected like every
  other page, and its address is not secret.
- "Reads like a section" will misjudge some headings. The page presents it as
  a proposal, not a rule.
- The report schema moves to version 2. The first sync after upgrading counts
  every document as not inspected, until a full sync.

### Follow-up

- Agree the title convention with the team using this page. Then decide in
  its own ADR whether the site takes a page's title from the Title line.
- Consider a weekly digest to a chat webhook if the page alone does not keep
  attention.
