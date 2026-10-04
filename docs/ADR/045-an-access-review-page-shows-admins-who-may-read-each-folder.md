# ADR-045: An access review page shows admins who may read each folder

- Status: Proposed
- Date: 2026-10-04
- Owners: CTCDocs maintainers
- Supersedes: ADR-037 and ADR-011 in part, once accepted: status colors are
  used on this page as well as on the content health page

## Context

ADR-039 opens each folder to the Google groups its rules name, and ADR-040
keeps a snapshot of who is in those groups. Neither says, in one place, who
may read what. An admin who wants to know has to read the `access` section of
the project configuration, work out the intersection of the rules down each
folder chain, find the documents whose move is waiting, and ask the status
route how many members each group has. The content health page lists folders
without a rule and rules that drifted, as tasks; it does not show the folders
that are in order, or who reads them.

An admin asks three questions:

- **Who may read this folder, or this document?** Before something sensitive
  is put there, or when a reader says a page is refused.
- **What does a person in these groups read?** When someone joins, leaves or
  asks for access.
- **Where is access not what the rules say?** A folder without a rule, a
  move that waits, a group that admits no one.

Access has two layers, and the answer needs both:

- **What the build declares.** A document's readers follow from the rules and
  the folder chain, and become its class in the access map. The map is
  bundled into the Worker, so what a build declares is what that version
  enforces.
- **What holds now.** A named group admits no one while it is recreated under
  its address, open to self-joining or to outside members, holds another group
  or the whole organization, or cannot be read (ADR-039, ADR-040). A snapshot
  older than two hours serves the members class only, to admins too
  (ADR-040). Membership changes every ten minutes without a build.

**The unit of access is the group.** The snapshot keys people by Google ID
and holds no address or name, by design (ADR-040). Who is in a group is
answered by Google Admin, which is the source of truth for it. Naming people
on a page would need their addresses stored where they are not stored today.

The site's rules are a second statement of access next to Drive's own
sharing, and the two can disagree (ADR-039). Everyone who can read the project
repository reads every folder. The MCP server is decided by the same map, as
the person an assistant reads for (ADR-041), and a machine key reads as the
groups it was issued (ADR-038).

A document's readers are its folder's, except while a move waits: then it is
narrower than its folder. A corpus has far fewer folders than documents.

## Decision

### A page at `/access-review/`, for admins only

**The site publishes an access review page** at `/access-review/`.
`access-review` is a platform route, reserved like `content-health`; a
deployment whose corpus already has that address keeps it, and validation
reports the clash, as for any platform route. The page is built only when the
project has an `access` section, which validation already rejects on a public
deployment. Without one, the address is not served.

**The access map places the page in the admins class.** It is not in the
sidebar, the search index, the sitemap, `llms.txt` or the full index. It
carries titles and folder names, which every member already sees (ADR-039),
and group addresses, which a refusal page names; it carries no body text.

**The page says what it covers.** One line under its title: who may read each
folder on this site, and through its MCP server when it has one, by Google
group; Drive's own sharing and the project repository are not covered. A
short section at the end says how access works: readers are the groups every
rule down the chain names; a folder without a rule is open to admins only;
titles are shown to every member and text only to readers; a rule change
takes effect with the deploy that carries it, a membership change within
about ten minutes.

### Built from the rules: who may read what

**The page is built at build time** from the same access model as the access
map, the corpus structure and the access findings. Its bytes depend on them
only.

**Folders are the rows.** A document reads as its folder, so the page lists
folders, not documents: the corpus as a tree, top-level folders first, each
with the number of documents under it. Each row shows:

- its readers: every member, the groups named, or admins only;
- for each named group, whether it reads the folder because a rule names it
  here, because a rule above does, or not at all, and whether a rule here
  names it where a rule above does not, so it admits no one;
- links to the folder's page, and to the folder in Drive, so its sharing there
  can be compared by hand;
- for a folder without a rule, the rule to paste into the configuration: its
  Drive ID and its name as the label, with the readers left to write, which
  validation refuses until they are.

A folder's row unfolds to the documents directly in it and to its
subfolders. **A document whose class is not its folder's** — a move that waits
— is listed under its folder even while the row is folded, with the readers it
has and the ones its place would give it once a rule there is confirmed.

**Groups are the columns** on a wide screen: every member, then each group the
rules name, sorted by address. The admin groups read everything and are named
once, above the table, rather than given a column. The table has a header for
every row and column, so a screen reader names the folder and group of each
cell, and every mark has a text label. With more groups than fit, the table
scrolls sideways with the folder column held in place. On a phone each folder
lists its readers instead.

**The page leads with one bar.** It divides every document by who may read
it: every member, some groups, admins only, with each count labelled. Below
it, what needs attention, most urgent first, each item linked to its row:
folders without a rule, documents whose move waits, groups a rule names that a
rule above does not, labels that drifted. The tasks themselves stay on the
content health page, which links each folder access finding to its row here,
and this page links back. When nothing needs attention, the page says so.

### Read as a set of groups

**A toolbar asks the second question.** "Read as" takes one or more named
groups, or, once the Worker has answered, a machine key, which reads as its
groups. The page then shows what
a reader in those groups may open: the folders and documents readable by one
of them or by every member, and how many documents that is of all. The rest is
dimmed, or hidden on request. Choosing a group's column header does the same
for that group. The admin groups are not offered, since they read everything.

**A title search** finds a document and unfolds its folder's row, which
answers who may read it.

The choice is kept in the address's fragment, which never reaches the server,
and a view offers to copy its link. The toolbar stays at the top on a wide
screen. Without script, every folder is listed and nothing is folded; the
toolbar and the live layer need script.

### What holds now, from the Worker

**The page asks the Worker** at the admin-only `no-store` status route under
`/_kb/` (ADR-040) once it loads, and lays the answer over what the build
declares. The status route gains:

- for each class in the map, the number of distinct active people who may
  read it now: the members of its groups that admit someone and of the admin
  groups, counted among the snapshot's active users; every active user for
  the members class; no one beyond the members class while the snapshot is
  stale;
- for each named group, its members counted the same way, among active users;
- the machine keys that admit something: each key's name, owner, groups and
  expiry, never its hash.

It answers counts and never a person's ID or address. A machine key never
reads it, as today.

**With the answer, the page shows:**

- when the membership was read, and, when the snapshot is stale, that every
  folder beyond the members class is refused to everyone, admins included,
  until a refresh succeeds;
- each group's active members in its column header, and a group that admits
  no one, with the reason, across its column; the folders it leaves to fewer
  readers, or to admins only, move to the top of what needs attention;
- how many people may read each folder, admins included;
- the machine keys, each with what it reads and how soon it expires;
- in "Read as", that a group which admits no one reads only what every member
  reads.

Without an answer — no Worker in a local preview, a refusal, a network error —
the page says that it shows the rules as built, and nothing else changes. No
decision depends on the page: it reports the map and the snapshot, and the
Worker decides every request by them, as before.

### Status colors

**This page uses the status hues of ADR-037,** under its rules: a hue marks a
dot, a bar, an icon or a badge, never text, and comes with an icon and a
label. A group that admits no one and a stale snapshot are red; a folder
without a rule, a move that waits and a group not admitted above are amber;
a label that drifted is grey. The bar's three reaches take blue, purple and
grey, which do not read as good or bad.

## Consequences

### Positive

- An admin answers who may read a folder or a document, and what a person in
  given groups reads, in one place, without working out intersections by hand.
- The declared part cannot disagree with what the Worker enforces: the page
  and the map come from one build and deploy as one version.
- What holds now is shown beside what was declared, so a group that admits no
  one, or a stale snapshot, is seen as the access it removes.
- Folders that are in order are shown, not only the ones that are not.
- No person's address or ID is stored, shown or sent, and the snapshot's
  shape does not change.

### Negative

- The page answers by group. "Can this person read it?" needs their groups
  from Google Admin first. Naming people would reverse ADR-040's choice to
  hold no address, and is not proposed.
- The page shows access to the site and the MCP server. Where Drive's sharing
  is wider or narrower, the page cannot say; a link to each folder in Drive
  only makes the comparison possible by hand.
- Machine key owners, as their issuers wrote them, are shown to admins.
- One more address is reserved. A deployment that already uses it keeps its
  page there and must resolve the clash before the review page can be served.
- Status colors are on a second page, which widens ADR-011's exception.
- The status route computes a count per class on every request. It is read by
  admins only, and its cost grows with groups times members.

### Follow-up

- Build it in two slices: the page from the build, then the status route's
  counts and machine keys with the live layer. The second changes the Worker,
  and needs tests that a non-admin person and a machine key are refused, that
  no count carries an ID, that a group which admits no one adds no one, that
  admins count in every class, and that a stale snapshot counts no one beyond
  the members class. The denial suite refuses the page to a non-admin.
- Show where Drive's sharing and the rules disagree once rules are read from
  Drive (ADR-039).
- Give a document its own row once rules on single documents exist
  (ADR-039).
- Mark ADR-037 and ADR-011 superseded in part when this record is accepted,
  and update `docs/CONFIGURATION.md` and `docs/OPERATIONS.md`.
