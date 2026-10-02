# ADR-039: Open a folder only to the Google groups its rule names

- Status: Proposed
- Date: 2026-10-02
- Owners: CTCDocs maintainers
- Supersedes: ADR-033 in part: what `llms.txt` may say about a document of
  another access class; ADR-032 in part: the 404 page searches only what the
  reader may open; and ADR-024 and ADR-037 in part: the content health page is
  read by admins only and lists folders without a rule

## Context

Every reader of a private deployment can read every document. Some folders are
meant for some people only, and the site must follow while staying a build of
the Drive corpus that is served, not rendered per request.

Google Workspace manages people in groups, and one group can be given a Drive
folder and a part of the site alike. The reader is identified by the sign-in of
ADR-038; their groups come from the snapshot of ADR-040. Folders are renamed and
moved, and addresses may follow names (ADR-021). Rules for single documents,
and rules read from the groups a Drive folder is shared with, are expected
later and should not need a second mechanism.

Body text reaches these files beyond a document's page:

- its Markdown version and its original files;
- the images Astro optimizes from those originals;
- Pagefind's fragments;
- the descriptions in `llms.txt`, where a top-level folder's index lists its
  whole subtree;
- the home page's folder cards, which show a landing document's description;
- the content health page, which quotes headings, names editors and lists the
  Drive names of files not on the site.

Titles and addresses alone reach navigation, previous and next links, the full
index, the home page's recent updates, the sitemap, permanent links and
redirects. A folder page lists only its direct children, which share its
folder.

The project repository holds every generated document and its history.

`AGENTS.md` rules out per-section access control; this record reverses that.

## Decision

### Rules

**A project names who may read each folder** in an `access` section of its
configuration: the admin groups, and a list of rules, each with a Drive folder
ID, the folder's current name as a label for review, and its readers. A
reader is a Google group address, or `"*"` for every signed-in member. A rule
may name the Drive root. Without an `access` section every document is open to
every member, as today. The section is rejected when any environment is
public, and an unknown key in it is an error.

**A document's readers are the groups every rule on its folder chain names.**
They are the set intersection of the rules on its folder and every ancestor,
where `"*"` names every member and leaves the set as it is. A rule below can
therefore only narrow, and a move can only keep or narrow what a rule above
allowed; a group a rule names that a rule above it does not is reported, since
it admits no one there. **A folder with no rule on it or above it is closed** to
everyone but the admin groups. The admin groups read everything.

**A sync is not stopped by the rules.** A malformed rule fails validation.
A label that no longer matches its folder's name, a rule whose folder has gone,
and every folder without a rule are listed on the content health page and in
the sync job summary instead.

**A document whose readers widen is held back.** When a sync would give a
document a wider reader set than the deployed build — its folder moved out
from under a narrower rule, or a rule removed — the document keeps its last
published version and readers, and is listed under Fix now, until a rule names
its folder. A document held back for another reason (ADR-026) takes the
narrower of the readers it was published with and those of its current folder.

### Groups

**A group is pinned to its Google ID.** The snapshot records each named group's
immutable ID the first time it resolves the address. If the address later
resolves to another ID — the group was deleted and recreated — the group
admits no one, and the status reports it, until an operator resets the pin. A
group whose settings let members join themselves, or admit members from outside
the organization, admits no one either, where the snapshot can read those
settings. Named groups are created by an administrator and joined by
invitation; that is part of the operations runbook, because the groups are the
access control.

### Classes and the access map

**A document's readers define its access class.** Documents with the same
reader set share a class. Each class gets a short opaque identifier at build
time, stable for the same reader set and checked for collisions, so paths stay
short and do not change when a group is renamed. Documents open to every member
form the members class.

**The build writes an access map**, at the end of the Astro build. It is kept
out of the published files and bundled into the Worker, so the map and the
files deploy and roll back as one version. It lists every built file by its
canonical path:

- A document's page, its Markdown version and its originals under
  `/assets/generated/<file ID>/` belong to the document's class.
- An optimized image belongs to every page that references it, and a reader may
  load it when they may open one of them. The build fails when a page that is
  not a document's own references an image that a document of a narrower class
  also references. An image no page references is readable by admins only.
- A folder page belongs to its folder's class.
- `/llms.txt` belongs to the members class. A top-level folder's `llms.txt`
  belongs to that folder's class. Each gives descriptions only of documents of
  its own class, and titles and addresses of the rest.
- The home page, the full index, the sitemap, permanent links, redirects and
  hand-authored pages belong to the members class. A home folder card shows a
  description only when the document it is taken from is in the members class.
- The content health page belongs to the admin groups once the project names
  them; without an `access` section it stays in the members class.
- Platform scripts, styles, fonts, the favicon and `robots.txt` are served to
  any signed-in reader.
- A signed-in reader who asks for a path the map does not list gets the 404
  page with status `404`.

**Search is split by class.** Starlight's own Pagefind run is turned off. The
platform indexes each class into its own bundle: the members class at
`/pagefind/`, every other class at `/pagefind-<class>/`, each with Pagefind's
runtime. The platform's search component asks the Worker which classes the
reader may open, at a `no-store` route under `/_kb/`, and merges those bundles
in the browser with Pagefind's `mergeIndex`; the Worker still refuses every
bundle the reader may not open. The 404 page's search does the same. Where no
Worker answers that route, the component merges nothing beyond the members
bundle.

**Rules take effect only where the Worker enforces them** (ADR-038). A build
with rules but without the Worker closes nothing, and its search covers the
members class only, so a deployment names closed folders only once its Worker
is live.

**A build check keeps body text inside its class.** The build fails when a
file readable by a wider class contains a run of words found only in documents
of a narrower class, beyond titles and addresses.

### Decisions on requests

**The Worker admits a request** when the file is in the members class, when the
reader is in an admin group, or when one of the reader's groups is among the
class's readers. A machine key reads as the groups it was issued (ADR-038). A
refused page shows a refusal page that names the groups able to grant access;
any other refused file is answered `403`.

**Titles stay visible to every member.** Navigation, previous and next links,
the home page, the full index, `llms.txt`, the sitemap, permanent links and
redirects show the title and address of every document, including closed
ones. Body text never leaves its class.

**The rules protect the site, not the repository.** Everyone who can read the
project repository, its workflow logs or a clone of it reads every folder.
Access to the repository is limited to the people a deployment would put in an
admin group.

## Consequences

### Positive

- A folder can be closed without changing how editors work in Drive. A rename
  changes nothing, and a move can only narrow access until someone confirms
  otherwise.
- Folders without a rule fail closed, and the reports say so.
- The site is still a build. On a production-sized build, a term from a
  restricted class was absent from every fragment of the members bundle, and
  the stock Pagefind interface returned it only after that class's bundle was
  merged. Indexing the whole site took well under a second, so a bundle per
  class costs almost nothing.
- Pinned group IDs and invitation-only groups keep a deleted or open group from
  becoming a way in.

### Negative

- Titles of closed documents remain visible to every member, so a reader can
  learn that a document exists and what it is called. Hiding them needs
  navigation and listings built per class, and is a later decision.
- The repository and its history are a complete copy of every folder, outside
  this boundary.
- The rules are a second statement of access next to Drive's own sharing, and
  the two can disagree until rules are read from Drive.
- A new folder stays invisible until someone adds a rule, and a widened
  document waits for one. Both are deliberate, and both add a step.
- The content health page leaves members' view.
- Folder IDs are harder to review than paths; the labels exist for that.
- The search component becomes a platform override of Starlight's, which a
  Starlight upgrade must follow.

### Follow-up

- Read a folder's readers from the groups its Drive folder is shared with,
  keeping configured rules as overrides. This needs the sync identity to read
  folder permissions, and Drive sharing by group rather than by person.
- Rules on single documents, by file ID, through the same map.
- Hide the titles of closed documents when that is needed.
- Hold the MCP server to the same map and decision.
- Decide where generated content lives once a deployment has closed folders,
  since the repository is outside this boundary.
- Update `AGENTS.md`, `docs/CONFIGURATION.md`, `docs/OPERATIONS.md` and the
  search verification (`bin/verify-search.mjs`), and add the group runbook.
