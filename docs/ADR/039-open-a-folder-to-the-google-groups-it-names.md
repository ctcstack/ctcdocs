# ADR-039: Open a folder only to the Google groups its rule names

- Status: Proposed
- Date: 2026-10-02
- Owners: CTCDocs maintainers
- Supersedes: ADR-033 in part: what a site or folder `llms.txt` may say about a
  document a reader cannot open

## Context

Every reader of a private deployment can read every document. Some folders are
now meant for some people only, and the site must follow, while staying a
build of the Drive corpus that is served, not rendered per request.

The organization manages people in Google Workspace and has chosen Google
Groups as the unit of access: a group can be given a folder in Drive and the
same group can be given a section of the site. Membership is read by the Worker
from a snapshot (ADR-040); the reader is known from the sign-in of ADR-038.

Folders are renamed often, and a deployment may let addresses follow names
(ADR-021), so a rule tied to a path would break with a rename. Rules per
document, and rules derived from the groups a Drive folder is shared with, are
expected later and must not need a second mechanism.

Body text reaches more files than a document's page: its Markdown version, its
original images and files, the images Astro optimizes from them, the Pagefind
fragments, the `llms.txt` indexes, and folder pages that list a description of
each document. Navigation, the full index, the home page, the sitemap and the
permanent links carry titles and addresses, not body text. On a production-sized
build the descriptions in `llms.txt` and on folder pages were the only body text
outside a document's own files.

## Decision

**A project names who may read each folder.** The project configuration gains
an `access` section: a list of rules, each with a Drive folder identifier, the
folder's current name as a label for review, and its readers. A reader is a
Google group address, or `"*"` for every signed-in member. The section also
names one or more admin groups. Identifiers are used rather than paths so a
rename does not move a rule; `ctcdocs-sync validate` checks that each label
still matches the folder's name and that each identifier is still in the
manifest.

**A rule covers its folder and everything below it, and a rule below may only
narrow.** A folder's readers are those of the nearest rule on it or an
ancestor. A nested rule's readers must be a subset of the readers above it,
unless the rule above is `"*"`; validation rejects a rule that would widen
access. **A folder with no rule on it or above it is closed** to everyone but
the admin groups. The content health page and the sync job summary list every
such folder, so a new folder does not stay invisible unnoticed. The admin
groups read everything.

**A document's readers define its access class.** Documents with the same
reader set share a class, identified by a hash of that set, so no group
address appears in a path. Documents open to every member form the members
class. The class is computed at build time from the folder chain in the
manifest.

**The build writes an access map that assigns every served file a class.**

- A document's page, its Markdown version and its original files belong to the
  document's class.
- An image Astro optimizes belongs to every page that references it; a reader
  may load it when they may open any of those pages.
- A folder's page belongs to the folder's class.
- Search is split: one Pagefind bundle per class under `/pagefind/<class>/`, and
  the members class at `/pagefind/`. The search component asks the Worker which
  classes the reader may open and merges those bundles in the browser through
  Pagefind's `mergeIndex`.
- The home page, the full index, the content health page, the sitemap, the
  permanent links and redirects belong to the members class.
- Platform scripts, styles, fonts and the favicon are served to any signed-in
  reader. Any other file the map does not name is refused.

**Titles may be shown to every member; body text may not.** Navigation, the
home page and the full index keep listing every document by title, and
`llms.txt` keeps listing every document by title and address. A description,
summary or excerpt of a document appears only on a file of the document's own
class: a folder page lists a narrower document by title alone, and an
`llms.txt` index gives descriptions only for documents of its own class.

**The Worker decides on every request.** A request is admitted when the file's
class is the members class, when the reader is in an admin group, or when one
of the reader's groups is among the class's readers. A machine key reads as the
groups it was issued. A refused page shows a refusal page that names the
groups that can grant access; a refused file is answered `403`.

## Consequences

### Positive

- A folder can be closed to most readers without changing how editors work in
  Drive, and a rename does not open or close anything.
- The site is still a build. Splitting the search index was proven on a
  production-sized build: a term from a restricted class was absent from every
  fragment of the members bundle, and the stock Pagefind interface returned it
  only after that class's bundle was merged. Indexing the whole site takes
  well under a second, so one bundle per class costs almost nothing.
- Folders without a rule fail closed, and the reports say so.

### Negative

- Titles of closed documents remain visible to every member, in navigation,
  the full index and `llms.txt`. A reader can learn that a document exists and
  what it is called. Hiding titles needs navigation built per class, or
  rendering per reader, and is a later decision.
- The rules are a second statement of access, next to Drive's own sharing, and
  the two can disagree until rules are derived from Drive.
- A new folder is invisible until someone adds a rule. That is the intended
  default, and it adds a step to publishing a new section.
- Folder identifiers in a project configuration are harder to read in review
  than paths; the labels exist for that reason and are checked.
- The search component becomes a platform override of Starlight's, so a
  Starlight upgrade that changes its search must be followed.

### Follow-up

- Derive a folder's readers from the groups its Drive folder is shared with,
  keeping configured rules as overrides; this needs the sync identity to read
  folder permissions, and Drive sharing by group rather than by person.
- Rules on single documents, by file identifier, through the same access map.
- Hide titles of closed documents once there is a need, by building navigation
  and listings per class.
- Hold the MCP server to the same map and decision.
