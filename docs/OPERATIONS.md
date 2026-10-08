# Operations runbook

## Release flow

The content and release paths are intentionally separated:

```text
Google Drive
→ Knowledge Base sync
→ allowlisted generated commit on main
→ optional protected development deployment and smoke test
→ production deployment and smoke test
```

When generated output changes, the sync workflow passes the exact committed
SHA to the reusable production deployment workflow. The deployment workflow
never reads Google Drive. A failed sync, verification, denial suite, boundary
check, build, deployment, or post-deploy smoke leaves the previous generated
commit or Worker version available for recovery.

Promotion through a development environment is a project's choice: it calls
the deployment workflow once per environment, and makes production `needs:` the
development job when development should gate it.

## GitHub environments

Create these protected GitHub Environments before enabling the workflows.
Restrict deployment branches to `main`, add required reviewers where the
current GitHub plan supports them, and do not copy a credential between
environments.

### `development-deploy`

Variable:

```text
CLOUDFLARE_ACCOUNT_ID
```

Secret:

```text
CLOUDFLARE_API_TOKEN
```

Use a development-only deploy token.

### `development-smoke`

Variable:

```text
CTCDOCS_BASE_URL=https://docs-dev.example.com
```

Secret:

```text
CTCDOCS_MACHINE_KEY
```

Use a development-only smoke key; see [Machine keys](#machine-keys).

### `production-sync`

Variables:

```text
GCP_PROJECT_ID
GCP_WIF_PROVIDER
GCP_SYNC_SERVICE_ACCOUNT
GOOGLE_DRIVE_ID
GOOGLE_ROOT_FOLDER_ID
GOOGLE_IGNORED_FOLDER_IDS
```

Optional secret:

```text
SYNC_FAILURE_WEBHOOK_URL
```

The Google identity must have read-only Drive access. The workflow obtains a
short-lived `drive.readonly` access token through GitHub OIDC and Workload
Identity Federation.

### `production-deploy`

Variable:

```text
CLOUDFLARE_ACCOUNT_ID
```

Secret:

```text
CLOUDFLARE_API_TOKEN
```

Scope the token to the project's account and project's zone. It may deploy
`example-docs-production` and `example-docs-directory-production` and manage
the configured custom-domain binding, but it must not hold Workers KV
permissions — deploying a binding does not need them, and without them it can
neither write the directory snapshot nor mint a machine key — nor manage
unrelated Workers, broad DNS administration, or account settings.

### `production-smoke`

Variable:

```text
CTCDOCS_BASE_URL=https://docs.example.com
```

Secret:

```text
CTCDOCS_MACHINE_KEY
```

The smoke key reads what every member reads, and nothing else. It is not a
Cloudflare credential and grants no API access.

## Scheduled and manual sync

`project-sync.yml` carries no schedule of its own — the project's calling
workflow decides when it runs, and should also offer `workflow_dispatch`. Twice
daily is a reasonable default; offsetting from the start of the hour reduces
exposure to peak GitHub Actions scheduling load. Scheduled execution is
best-effort in any case, so use the manual run when a content update is
time-sensitive.

Normal manual sync:

1. Open **Actions → Knowledge Base sync**.
2. Select **Run workflow** on `main`.
3. Leave **Export every managed Google Doc** disabled.
4. Review the job summary and the generated commit. The summary names every
   file in the published folders that is not on the site, with the reason
   ([ADR-025](ADR/025-name-every-file-left-off-the-site.md)).

Full regeneration:

1. Run the same workflow.
2. Enable **Export every managed Google Doc**.
3. Confirm the generated diff contains only allowlisted paths.
4. Confirm the production deployment and protected smoke job succeed.

The sync job checks out `main`, writes through the atomic output writer, checks
the complete working-tree diff against the shared generated-path allowlist,
runs `pnpm verify`, scans every changed generated file for secrets, stages only
generated paths, and pushes without force. A concurrent human merge causes a
safe non-fast-forward failure; the next run starts from the new `main`.

No-op syncs create no commit. A successful content commit uses:

```text
chore(content): sync Google Drive content
```

## Local read-only diagnostics

Run the safe preview before any local write:

```bash
pnpm sync:dry-run
```

Inventory-only integration should normally use the protected **Google WIF
smoke test** workflow:

```text
Google Drive inventory dry-run passed.
Items visible: <count>
Folders selected: <count>
Documents selected (Google Docs, PDF files and spreadsheets): <count>
Unsupported items selected: <count>
Ignored items: <count>
Warnings: <count>
  <warning code>: <count>
```

Investigate unexpected count reductions, graph warnings, authentication or
permission errors, and exhausted retry budgets before synchronizing. Never
print the JSON inventory or document bodies into production Actions logs.

## Ordering the wiki from Drive

The sidebar, and with it the previous and next links, follows the order the
Drive names declare. Nothing in this repository has to change to reorder the
wiki. The rule is recorded in
[ADR-013](ADR/013-editorial-navigation-order.md); operationally it reads:

1. A folder's landing document comes first — the titles in
   `navigation.landingDocumentTitles`, matched without regard to case.
2. Then the numbered items, ascending.
3. Then everything else, alphabetically.

A number is one to three digits, followed by `-`, `–`, `—`, or `.`, or wrapped
in square brackets. A space alone is not a separator, so a name opening with a
year or a quantity keeps it.

```text
01 — Company     ordered      2024 Annual Report   not ordered
1 - Overview     ordered      01 Company           not ordered
02. Products     ordered
[003] Playbooks  ordered
```

The number never reaches the page: it is stripped from the sidebar label, the
heading, and the URL. Renumbering therefore breaks no links and creates no
redirect. Renumbering a folder rearranges navigation only; renumbering a
document re-exports that one document.

Numbering in steps of ten leaves room to insert without touching the
neighbours.

Three arrangements leave the order undefined and are reported as sync warnings:
two siblings claiming the same number, two landing documents in one folder, and
a name opening with digits and a space in a folder already using the
convention. `pnpm sync:inventory` counts them by code; adding `--json` names
the item behind each one.

### Letters from one alphabet

A word in a Drive name uses letters of one alphabet
([ADR-020](ADR/020-letters-from-one-alphabet.md)). A Cyrillic `С` typed into
`Company` looks right, but it would become part of the permanent address of
the item and, for a folder, of everything in it.

A document or PDF named so is held back
([ADR-027](ADR/027-publish-pdf-files.md)): it is not published under that
name, the rest of the sync goes on, and the content health page lists it under
"The name uses letters from another alphabet" with the letters to retype. A
folder named so stops the sync at inventory, before anything is exported,
whatever `SYNC_FAIL_ON_WARNING` says:

```text
ERROR [INVENTORY_GRAPH]: mixed_script_name
ERROR [INVENTORY_GRAPH]: mixed_script_name itemId=<Google file ID> U+0421 Cyrillic at character 1
```

Open the folder by its ID, retype the letter at that position, and rerun the
sync. Only Latin, Cyrillic and Greek are checked against each other, and words
are split at spaces, hyphens and punctuation, so `SEO-продвижение` is accepted.

A project whose names are all in one alphabet can say so with
`navigation.nameScripts` (see [Configuration](CONFIGURATION.md)). A letter of
any other script is then reported as `disallowed_name_script`, which also
catches a whole word typed on the wrong layout.

An item published before the rule keeps its address when its title is
corrected. Changing the address is a slug reseed, below.

## PDF files

A PDF in a published folder is published
([ADR-027](ADR/027-publish-pdf-files.md)). Its page shows the file in the
browser's PDF viewer, with links to open and download it, and its text below,
which is what search finds. Its title and address are its Drive name without
`.pdf`, and the sidebar marks it `PDF`.

The page carries what the file's size allows:

| Size            | On the page                                  |
| --------------- | -------------------------------------------- |
| Up to 25 MB     | The file and its text                        |
| 25 MB to 100 MB | The text, and a link to the file in Drive    |
| Over 100 MB     | A link to the file in Drive; nothing is read |

The content health page lists the last two, and a PDF with no text to read —
scanned pages, a password — as "Incomplete on the site".

A PDF is downloaded when it is new or its content changed; Drive's checksum
says which, so a full sync does not download the others again. Every published
version of a PDF stays in the repository's history.

## Spreadsheets

A Google Sheet, an Excel workbook (`.xlsx`, `.xlsm`) or a CSV or
tab-separated file (UTF-8, UTF-16 or Windows-1251) in a published folder is
published
([ADR-046](ADR/046-publish-spreadsheets-as-tables.md)). Its title and address
are its Drive name without the extension, and the sidebar marks it `Sheet`.
The file itself is not published: its page links to it in Drive.

Each visible sheet is a section of the page, cut into tables, lists and
paragraphs at its empty rows and columns. Every value is shown as the workbook
shows it, with the value a formula last computed. A sheet with formulas ends
with "How it is calculated": each distinct formula once with the cells it
fills, named by the labels around them, then the inputs it depends on and the
results it produces. On the site a table of more than ten rows keeps its
header in view, filters and sorts; the Markdown version splits a long table
into parts that each repeat its header, for assistants.

What editors control:

- **Hide a sheet, a row or a column** to keep it off the site. What is hidden
  is not read, and the page never names a hidden sheet.
- **Move the file** out of the published folders to keep all of it off.
- An `.xls` or `.ods` file is listed as not published, with the advice to save
  it as a Google Sheet.

A page stops at 2,000 rows of a sheet, 50,000 filled cells and 100 sheets, and
says where. The content health page lists a spreadsheet cut short, and one
with charts or images the page does not show, as "Incomplete on the site". A
Google Sheet over 10 MB is held back like a document; an uploaded file over
50 MB, or one that is not a workbook, is held back with the reason.

An uploaded file is downloaded when it is new or its content changed, as a
PDF is. A Google Sheet is exported again whenever Drive reports it changed, so
a sheet with `NOW()` or `RAND()` changes its page on every full sync.

## Linking to a section

Every folder below the publication root has an address of its own,
`/<folder-slug>/`, derived from the folder path the same way a document slug
is. The address is reserved whether or not a page is served at it, so it never
changes when the switch below is flipped.

With `navigation.sectionIndexPages` enabled, that address serves a generated
page: the folder's name and a listing of its subfolders and documents in the
same order the sidebar uses, each with the description it publishes. A folder
with nothing in it still gets its page and says so.

The page is absent from search. In the sidebar it opens its folder's group,
labeled with the first of `navigation.landingDocumentTitles` ("Overview") and
named "Folder: Overview" for screen readers and in the previous and next links,
unless the folder holds a document with one of those titles, or a subfolder
labeled like the page; so a group never lists two entries with one name
([ADR-035](ADR/035-open-a-folder-with-its-page-when-it-has-no-landing-document.md)).
It is also reached by its URL, by the folder cards on the home page, and by the
breadcrumb above every document in it. Where a folder has no page, those two fall back to the
folder's heading in the home index, which is how they behaved before. Renaming
a folder does not move the address — the manifest owns it exactly as it owns a
document slug.

An overview document is not this page. It keeps its own address and appears in
the listing like any other document. See
[ADR-014](ADR/014-section-index-pages.md).

## Content health

Every sync writes `data/title-report.json`
([ADR-023](ADR/023-title-report.md)), and the site publishes what it found at
`/content-health/` ([ADR-024](ADR/024-content-health-page.md)). Send editors
there. It is not in the sidebar or in search.

The page is ordered by priority
([ADR-037](ADR/037-rank-the-content-health-page-by-priority.md)). It opens on
the whole knowledge base: the number of files in the most urgent state, how
many files are on the site, and a bar of every file in the published folders
by its most urgent task. "Where the work is" gives the tasks by section and by
last editor; choosing a row filters the page to it. Then every group of
findings, under its priority:

- **Fix now**: a reader runs into a mistake, or a document cannot reach the
  site. A heading that mixes alphabets, a document that opens with another
  document's title, an empty document; a document held back
  ([ADR-026](ADR/026-hold-back-a-document-that-cannot-be-exported.md)) by a
  name in another alphabet, over 10 MB, downloading turned off or content
  refused; a cropped image the site could not crop and shows whole
  ([ADR-031](ADR/031-apply-the-crop-google-docs-makes.md)); an image or a link
  conversion left out; a code block never closed.
- **Fix next**: files the site does not show
  ([ADR-025](ADR/025-name-every-file-left-off-the-site.md)), by kind — Word
  and text files, presentations, archives, images, diagrams, spreadsheets in
  an older format, video and audio, other files, shortcuts — PDFs with no
  readable text or too large for the site, and spreadsheets cut short
  ([ADR-046](ADR/046-publish-spreadsheets-as-tables.md)); files in one folder
  the site cannot tell apart; a
  merged cell split, formatting removed; a document longer than AI agents read,
  `mcp.fetchCharacters`
  ([ADR-043](ADR/043-content-health-names-documents-too-long-to-read-whole.md)).
- **Improve**: images with no alt text
  ([ADR-029](ADR/029-say-when-an-image-has-no-alt-text.md)), a page with no
  summary, images larger than `sync.largeImageMegabytes` (2 MB unless the
  project sets it), a link to a Google file outside the published folders, a
  link to a heading that opens the top of a page, a PDF only partly
  searchable, a heading that skips a level and a heading with the words of an
  earlier one ([ADR-034](ADR/034-check-headings-summaries-and-outside-links.md)),
  a second landing document, a document longer than
  `sync.largeDocumentCharacters` (40,000 characters unless the project sets
  it), worth splitting, a long PDF or spreadsheet, and a spreadsheet with
  charts or images the page does not show.
- **Tidy up**: Drive names with "Copy of", a file extension, underscores or
  extra spaces; order numbers used twice or not read; an ignored folder that
  is no longer there.
- **Proposed convention: one Title line.** A document opens with its name as
  one line in the Title style, and uses Heading 1 to 3 for sections. It is not
  required yet and does not count against a file.

A group is folded to one line — what it is, what to do, how many files, where
— except under Fix now. Opened, it gives the instruction, and each file opens
in Google Docs or Drive, straight to the line concerned when there is one,
with its section, who last edited it and a link to its page. Each priority
also lists the checks that were all clear. A document held back keeps
its published version if it had one, the page says when that version was
edited, and it is tried again on every sync. Folders the site is configured
to leave out are listed last.

Filter by section, or by last editor, to hand out the work: every task list
and count below the overview follows, and the address keeps the filter. "Copy
link" copies it, so send each editor the link to their own view; it opens on
their tasks. The page is rebuilt on every sync, so a fixed item
disappears after the next one. When a release adds a check read from the
documents' structure, the next normal sync exports every Google Doc once more
to read it; nothing else changes, and the sync after that is quick again.

The job summary of every sync has three parts
([ADR-028](ADR/028-legible-sync.md)):

- **Sync run**, from the sync step: the pages the run added, changed and
  removed, linked, and addresses that moved. A run that changed nothing says
  so.
- **Knowledge Base**, from the summary step: the overview, then "Not on the
  site as it is in Drive" and "Notes" as on the page — a table per section and
  a folded list per group, up to 100 rows each.
- **Content health**: the title checks as counts, naming no document.

A sync that fails writes **Sync failed** instead: what stopped it, what that
means, what to do, and the log lines. The run log itself prints only codes and
counts.

At a terminal, the same report reads:

```bash
pnpm exec ctcdocs-sync titles
pnpm exec ctcdocs-sync titles --list
```

The first prints counts only. `--list` names documents, quotes their headings
and prints Google Docs links, so run it at a terminal, not in a CI log.

A document is inspected when a sync exports it. After upgrading to a platform
that records more about each document, the page counts documents as not yet
inspected until they are exported again. Run the sync once with `full` to
inspect every document.

## Content lifecycle operations

Re-export one managed document locally:

```bash
pnpm sync --file <google-file-id>
```

Intentionally allocate a new slug and preserve the old URL as a redirect:

```bash
pnpm sync --reseed-slug <google-file-id>
```

Use slug reseeding only for an approved URL change. A normal rename or move
must retain the existing slug. Deletions disappear only after a complete
inventory confirms that the document is outside the managed corpus.

### Addresses that follow names

While a corpus is still being arranged, set `navigation.addresses` to
`follow-names` ([ADR-021](ADR/021-addresses-may-follow-names.md)). Every sync
over the whole corpus then gives each folder and document the address its
current Drive path yields. A renamed folder moves with everything below it,
and two documents can swap titles and addresses. The sync summary reports how
many addresses moved:

```text
Addresses moved (redirects kept): 3
```

Each item keeps one earlier address as a redirect, so an address copied from
the browser survives one rename. The redirect goes when the item moves again,
or when another item is named after that address. Renumbering moves nothing,
because the order prefix is not part of an address. A sync targeted at one
file keeps every address where it is.

A reader who opens an address that no longer exists lands on the 404 page,
which searches the site for the name in that address. Anyone who needs a
link that lasts copies the page's permanent link instead (see below).

Switch back to `stable` once people have started sharing addresses. The
addresses stay where they are, and so do the redirects.

In either mode, the redirects that point at a folder or document are removed
when it leaves the corpus.

### Permanent links

Every document and section page answers at `/d/<short ID>/`, for example
`/d/3f2a1c/` ([ADR-022](ADR/022-permanent-short-ids.md)). The short ID is
recorded in the manifest when the page is first synchronized and never
changes, so the link survives every rename and move. **Copy link** on the page
copies it.

Links between documents are stored the same way. The sync writes a link to
another document, whether a Google Docs link or a pasted address of this site,
as its permanent link. The site resolves it to the current address when it
builds. The first sync after upgrading to a platform with permanent links
exports every document again, because the converter version changed.

## Deployment

Every push to `main` starts `.github/workflows/deploy.yml`:

1. run the canonical verification gate, then the denial suite, which asks the
   platform's gate for every built file as different readers;
2. deploy and verify the same commit on a development environment first, if
   the project declares one and gates on it;
3. prove that production anonymous requests are denied and its separate smoke
   key is admitted;
4. rebuild from the exact commit without transferring build artifacts;
5. deploy the site Worker, tagged `ctcdocs-gate-v1`, and the directory Worker
   through Wrangler;
6. verify protected HTML, raw Markdown and its headers, Pagefind, the agent
   index, `robots.txt`, and the 404 response.

A Worker deployment reaches every edge location shortly after Wrangler reports
success, so a route added by the deployed commit can still answer from the
previous version. Step 6 therefore retries each unsatisfied check against a
single shared 90-second deadline and logs every wait. Anonymous-denial and
machine-key assertions are never retried: a boundary finding fails the run
immediately.

The committed Wrangler configuration disables both `workers.dev` and version
preview URLs for both named environments and binds only the approved
development and production hostnames.

Before the first real-content deployment, run:

```bash
pnpm verify
pnpm exec ctcdocs-verify-gate
pnpm exec ctcdocs-access-smoke --preflight
```

Do not deploy real content from a feature branch or before the boundary check
passes.

The complete bootstrap and release procedure is maintained in
[Development and production deployment](DEPLOYMENT.md).

## Sign-in and the directory

A private deployment decides every request in its Worker against a snapshot
of group membership that its directory Worker refreshes every ten minutes
(ADR-038, ADR-040). Nothing about a reader's groups is stored in their session.

### Who may read what

Once the project has access rules, the site publishes `/access-review/`, for
admins only
([ADR-045](ADR/045-an-access-review-page-shows-admins-who-may-read-each-folder.md)).
It opens on every document split by who may read it — every member, some
groups, admins only — and then what needs attention: folders without a rule,
documents with fewer readers than their folder, groups a rule names that a
rule above does not, and rules that drifted. The content health page keeps the
same folders as tasks and links each one here.

Below, each folder is a row: its readers in words, where they come from, a
link to the folder in Drive, its documents, and a column per group the rules
name, marked where the rule on the folder names the group, where a rule above
does, and where a rule names a group no rule above admits. A folder without a
rule offers the rule to paste into the configuration.

- **Who may read this?** Find the document by its title; its folder's row
  answers.
- **What does someone read?** Choose their groups under "Read as", or a
  group's column; what they cannot open is dimmed, or hidden on request, and
  the page counts what is left.
- **Send a view.** The address keeps it after `#`, which never reaches the
  server, and "Copy link" copies it.

The page also asks the Worker what holds now, at `/_kb/status`, and lays it
over the rules: when the directory was read, each group's active members in
its column, how many people may read each folder, admins included, and the
machine keys, each with the groups it reads as and when it expires. "Right
now", above what needs attention, names a group that admits no one and the
folders it leaves with fewer readers or to admins alone, and says when the
directory is stale. "Read as" follows the gate: a group that admits no one
reads only what every member reads, a machine key reads as its groups, and a
stale directory serves what every member reads to anyone. Without an answer —
a local preview, or a Worker that cannot read the directory — the page shows
the rules alone and says so.

The page names groups, never people: who is in a group is managed in Google
Admin. It does not cover Drive's own sharing, and everyone who can read the
project repository reads every folder.

### When a reader leaves or changes groups

Membership changes in Google take effect at the next refresh plus up to a
minute of caching in the Worker: about ten minutes. A suspended or deleted
user loses every session at the same moment, because a session is honored only
for a user the snapshot lists as active; they, and a new account the directory
has not been read for yet, see a page saying their account is not in the
directory. A session otherwise lasts twelve hours, and **Sign out**, in the
header and the mobile menu, ends it on the site — pages are checked with the
Worker each time they are shown, so none is served from the browser's cache
afterwards — without signing the reader out of Google.

### The directory snapshot

An admin reads its state at `/_kb/status`, and the access review shows it:
when it was taken, its age, whether it is stale, the number of active users,
each named group, by address, with its active members and the reason, if any,
it admits no one, the people who may read each access class now (`classes`,
by class identifier, admins included), and the machine keys that admit
something, with their owner, the groups they read as and their expiry
(`machineKeys`). It names no person, and no key's hash.

| What you see                                               | What it means                                                                                                                  | What to do                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The site says the directory has not been read              | There is no snapshot; no session is admitted                                                                                   | Read the directory Worker's logs for `directory-refresh-failed`: its `stage` and `status` say whether the key, the token, the users list or Google itself failed |
| `stale: true`                                              | No refresh has succeeded for two hours                                                                                         | Signed-in readers read only what every member reads until one does; read the logs                                                                                |
| `directory-refresh-refused` in the logs                    | The result lost more than a fifth, and at least five, of the users or of a group, beyond those listed as suspended or archived | If a failed read, fix it. If a genuine change, let the next refresh through, as below                                                                            |
| A group with `admitsNoOne: cannot be read`                 | The directory refused the group: deleted, renamed, mistyped in a rule, or out of the role's sight                              | Fix the rule or the group; the next refresh reads it                                                                                                             |
| A group with `admitsNoOne: its settings could not be read` | The Groups Settings API refused it, often because the API is disabled                                                          | Enable the API in the directory reader's Cloud project                                                                                                           |
| Another `admitsNoOne` reason                               | It is nested, holds the organization, lets people join themselves, admits outsiders, or was recreated                          | Fix the group in Google; for a recreated group, reset its pin, as below                                                                                          |

The directory Worker's logs carry counts, durations, closed groups by their
place in the sorted list with their reason, and failures by stage and status —
never an address, an ID or a membership:

```bash
pnpm exec wrangler tail example-docs-directory-production
```

**Accepting a large change.** Set `directory-accept-next`; the next run, within
ten minutes, writes its reading without comparing it with the last, and clears
the flag. Until then the last snapshot keeps deciding.

```bash
pnpm exec wrangler kv key put directory-accept-next yes --binding KB_STATE --env production --remote
```

**Resetting a group's pin.** The refresh records each group's Google ID the
first time it reads it, and a different group later found under the same
address admits no one. After confirming the new group is the intended one,
remove its entry from the `directory-pins` value:

```bash
pnpm exec wrangler kv key get directory-pins --binding KB_STATE --env production --remote > pins.json
jq 'del(.["team@example.com"])' pins.json > pins.next.json
pnpm exec wrangler kv key put directory-pins --path pins.next.json --binding KB_STATE --env production --remote
```

A malformed entry is ignored rather than failing the refresh. These commands
need a login or a token with KV permissions; the deploy token does not have
them.

### Machine keys

The smoke test and any agent a team runs read the site with a machine key.
Issue one per use, per environment:

```bash
pnpm exec ctcdocs-machine-key --name <name> --owner <who answers for it> --group <address> --days 90
```

It prints the key once and a record. Give the key to its user, and add the
record to the `machine-keys` list in the environment's KV namespace — the
list is the only copy of the records, and holds only hashes, so read it back
from there:

```bash
pnpm exec wrangler kv key get machine-keys --binding KB_STATE --env production --remote > keys.json
jq --argjson record '<the record>' '. + [$record]' keys.json > keys.next.json
pnpm exec wrangler kv key put machine-keys --path keys.next.json --binding KB_STATE --env production --remote
```

The first time, start from `[]`. A key reads as the groups its record names —
none means what every member reads — never as an administrator, and stops
working at its expiry, at most 90 days away; the Worker refuses a record whose
expiry is further. Changes reach every location within about a minute.

To revoke a key, remove its record from the list the same way, by its `name`.
Nothing else holds it, and a rollback does not bring it back.

## AI assistants

With `mcp.enabled`, people read the site from their AI assistants through
`https://<host>/mcp`
([ADR-041](ADR/041-agents-read-the-site-through-an-mcp-server-as-their-reader.md)).

### Connecting an assistant

Each person connects their own assistant, from any account:

- **claude.ai or Claude Desktop:** Settings → Connectors → Add custom
  connector, with the URL above. On a Team or Enterprise plan an owner can add
  it once for everyone; each person still connects with their own sign-in.
- **ChatGPT:** Settings → Apps → Advanced → Developer mode, then create an app
  with the URL. On Business or Enterprise an admin can publish it for the
  workspace.
- **Claude Code:** `claude mcp add --transport http <name> https://<host>/mcp`,
  then `/mcp` and **Authenticate**.
- **Cursor and other clients:** add the URL as a remote MCP server.

The site asks once whether to connect the named assistant, then signs the
person in with Google unless they are already signed in. The assistant reads
what that person may open, decided on every request: a change of groups or a
departure applies within the directory's refresh. A connection lasts 30 days,
then the person connects again. Signing out of the site does not disconnect an
assistant.

### Publishing and search

Every five minutes the site Worker checks whether the documents in its
`KB_DOCUMENTS` bucket match its build, and when they do not, rewrites what
changed and starts an AI Search sync. The bucket holds each document's
Markdown version without its front matter, the text `fetch` returns; a
release that changes that text rewrites and reindexes every document once. Its
log shows `agents-published` with the counts written and deleted, and
`agents-publish-incomplete` when a document could not be written: the others
are published and indexed all the same, and the next run tries the missing
ones again. The last published build is recorded in the bucket itself, as
`agents-published.json`, so a new or emptied bucket is filled on the next run.
To publish everything again, delete that object; the next run compares every
document and syncs:

```bash
pnpm exec wrangler r2 object delete <bucket>/agents-published.json --remote
```

AI Search's own jobs show whether the index has caught up, and its stats
whether every document made it:

```bash
pnpm exec wrangler ai-search jobs list <instance name>
pnpm exec wrangler ai-search stats <instance name>
```

A job can end with a document in `error`, such as `workers_ai_timeout_error`,
or with documents still `running`: indexing a new instance once left one and
eight. Neither is searchable until indexed. Start another job, and check the
stats again until nothing is in `error`, `queued` or `running`:

```bash
pnpm exec wrangler ai-search jobs create <instance name>
```

`search` asks AI Search for up to 50 chunks, matching any word of the query,
reranks them with `bge-reranker-base` without dropping any, and returns up to
fifteen documents with their folders and their date: the best matching chunks
whole, as many as the budget holds, and the other documents by title
([ADR-042](ADR/042-an-assistants-search-returns-the-passages-that-match.md),
[ADR-044](ADR/044-assistants-list-a-folder-and-recent-changes-and-narrow-a-search.md)).
A chunk is never cut, so the instance's chunk size decides how many fit.
A search may be kept to a folder or to documents changed since a date, and
to fewer documents or to their titles alone, without passages. Two more tools
list documents without searching: `browse`, a folder's folders and documents,
as a tree as deep as one answer allows, and `recent`, the latest changes in Drive
([ADR-044](ADR/044-assistants-list-a-folder-and-recent-changes-and-narrow-a-search.md)).
They read the build's list of documents, not AI Search, and name no folder
the person may open nothing in.
All of it is set in each request, so the instance needs no setting of its own,
and every number is the project's `mcp.search` setting, with these defaults
([configuration](CONFIGURATION.md#ai-assistants-mcp)): to tune search, change
it and deploy. Measure a change first against the project's own questions:

```bash
pnpm build
pnpm exec ctcdocs-eval-search --label <what-changed>
```

It reads `evaluation/search-questions.json`, searches the instance
`wrangler.jsonc` binds, or the one `--instance` names, through the Worker's own
code, and writes a run to `evaluation/results/<date>-<label>/` without any
document text. `CLOUDFLARE_API_TOKEN` needs AI Search Read and Run
([ADR-044](ADR/044-assistants-list-a-folder-and-recent-changes-and-narrow-a-search.md)).
The Worker checks every passage against the person asking, so the instance's
similarity cache, on by default, cannot show one person another's results.

The Worker logs each tool call by tool and outcome only, never the query, the
folder, the person or the document. A `tool-failed` event names a tool whose
bucket or index failed, by the error's name; the assistant is told only to try
again.

### Disconnecting assistants

A departure or a removal from a group needs nothing: the next request is
judged against the directory. To end connections themselves:

- **One person:** their grants and tokens are the keys starting
  `grant:<Google user ID>:` and `token:<Google user ID>:` in the `OAUTH_KV`
  namespace. The user ID is the person's ID in the Admin console, the same
  one the directory snapshot lists. List them with
  `wrangler kv key list --namespace-id <OAuth namespace ID> --prefix "grant:<ID>:"`,
  do the same for `token:<ID>:`, and delete each key.
- **Everyone:** create a new OAuth namespace, put its ID in `wrangler.jsonc`
  and deploy. Every grant stays in the old namespace, unreachable; delete it
  afterwards.
- **The server itself:** set `mcp.enabled` to `false` and deploy; the
  bindings in `wrangler.jsonc` may stay. `/mcp` and the OAuth routes stop
  answering; turning it back on revives the grants that have not expired, so
  pair it with a new namespace if that is not wanted.

## Failure handling

The sync workflow reports aggregate counts through `$GITHUB_STEP_SUMMARY`.
When `SYNC_FAILURE_WEBHOOK_URL` is configured, failure notification contains
only:

```text
Documentation sync failed
Run: <GitHub Actions run URL>
Stage: <configuration|authentication|sync|generated-validation|build|final-generated-validation|secret-scan|commit|push>
Errors: 1
```

It never includes document bodies, titles, tokens, private URLs, or exception
payloads. A secret scan failure is reported by its stage alone: the rule, the
file and the document stay in the run log. GitHub notifications remain the fallback when the webhook is absent
or unavailable.

For a failed sync:

1. identify the failed stage from the job summary and safe log category;
2. do not commit or copy partial staged output;
3. fix the source or pipeline on a short-lived branch;
4. run `pnpm verify`;
5. retry the workflow from a clean `main`.

A failed Google request ends the sync step with one line:

```text
ERROR [GOOGLE_<CATEGORY>]: status=<HTTP status> reason=<code> fileId=<Google file ID> requestId=<ID>
```

`reason` is the machine-readable code Google returned, and `fileId` the file
the request was about — the document being exported or inspected, or the
configured root folder. Each is left out when there is none. Google's own error
message is never printed, because it can quote a title or a URL. A file ID
names a document without revealing it: the manifest already records every
published one, and opening it still takes access to the Drive.

| Category                     | Reason                                       | What to do                                                                                                     |
| ---------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_RATE_LIMIT`          | `rateLimitExceeded`, `userRateLimitExceeded` | Already retried with exponential backoff before failing. Rerun later.                                          |
| `GOOGLE_RATE_LIMIT`          | `dailyLimitExceeded`                         | A daily quota; not retried. Review the Drive API quotas of the Cloud project.                                  |
| `GOOGLE_EXPORT_SIZE_LIMIT`   | `exportSizeLimitExceeded`, or none           | Google exports at most 10 MB, images included. Split the document or reduce its images.                        |
| `GOOGLE_DOWNLOAD_RESTRICTED` | `cannotExportFile`, `cannotDownloadFile`     | The document stops viewers from downloading it. Lift that restriction; do not raise the identity above Viewer. |

A full or scheduled sync no longer stops on these two, or on content that
conversion refuses: it holds that document back, publishes the rest and lists
it under "Not on the site"
([ADR-026](ADR/026-hold-back-a-document-that-cannot-be-exported.md)). The line
above appears when a targeted `--file` run fails on the document it was asked
for.
| `GOOGLE_PERMISSION` | `SERVICE_DISABLED`, `accessNotConfigured` | The Drive or Docs API is not enabled in the Cloud project. |
| `GOOGLE_PERMISSION` | any other, or none | The identity cannot read the file. Check that it is still a Viewer of the Shared Drive and the file is inside that Drive. |

The command exits with 2 for `GOOGLE_AUTHENTICATION`, 3 for `GOOGLE_PERMISSION`
and `GOOGLE_DOWNLOAD_RESTRICTED`, and 1 otherwise.

A failure at the `secret-scan` stage has a procedure of its own:
[Secret scan findings](#secret-scan-findings).

For a failed deployment:

1. confirm that the previous Worker deployment is still active;
2. fix forward when no internal content was exposed;
3. use the rollback workflow for a user-visible regression;
4. treat any anonymous content response as a security incident.

## Secret scan findings

A sync commit is pushed with the workflow's own token, and a push made with it
starts no other workflow, so the project's CI never scans it. The sync therefore
scans every generated file the run added or changed before it commits. It uses
the gitleaks release the CI gate runs, and the project's own `.gitleaks.toml` and
`.gitleaksignore`. The decision is recorded in
[ADR-018](ADR/018-secret-scan-before-sync-commit.md).

A finding fails the run at the `secret-scan` stage. Nothing is committed or
pushed, so `main` and the deployment keep the last good output, and every other
document's update waits with it. Each finding is one line:

```text
ERROR [SECRET_SCAN]: rule=<gitleaks rule ID> path=<generated file> line=<line> fileId=<Google file ID>
```

`fileId` is the document — or the folder, for a section page — that the
manifest records for the file. It is left out for the outputs no single file
owns: the sidebar, the redirect map and the data files. `line` counts lines of
the generated Markdown, not of the Google Doc. The value is never printed, and
neither is the text around it: the scanner redacts its report, writes it
outside the repository, and the report is deleted once read.

The command exits with 5 for findings. It exits with 1 when the scan could not
run or its result could not be trusted: the scanner is missing or failed,
`.gitleaks.toml` is missing, or `.gitleaks.toml` exempts a file the run changed.
The scanner's own messages are withheld from the log; reproduce a scanner
failure by running `gitleaks dir --no-banner .` in a checkout of the project.

For a finding:

1. Find the value in the document the file ID names. To see the exact line,
   export that one document locally with `pnpm sync --file <google-file-id>`
   and open the generated file at the reported line. With the pinned gitleaks
   on `PATH`, `pnpm exec ctcdocs-sync scan:generated-diff` then repeats the
   scan, and confirms an allowlist entry before it goes to review.
2. **A credential:** treat it as exposed to everyone who can read the document.
   Rotate it, then remove it from the document and rerun the sync. It never
   reached Git or the site.
3. **Not a credential** — an example key, a placeholder, an identifier shaped
   like one: accept it in a reviewed pull request to the project, then rerun the
   sync. Prefer an allowlist scoped to the rule and naming the value:

   ```toml
   [[allowlists]]
   description = "Placeholder key in the integration guide's examples"
   targetRules = ["generic-api-key"]
   regexes = ['''^<the exact placeholder value>$''']
   ```

   The alternative is a line in `.gitleaksignore` copied from the finding,
   `<path>:<rule>:<line>`. It silences that rule at that line of that file, for
   the sync and for both CI scans. It stops matching when an edit above the
   value moves it, and it keeps silencing whatever later lands on that line.

Two routes are refused. A `paths` exemption covering generated files is rejected
by both `validate` and the scan. `gitleaks:allow` written into the document is
ignored, because the sync scans with `--ignore-gitleaks-allow`: an allowlist
entry goes through review, and document text does not. Anchor path exemptions
at the repository root (`^dist/` rather than `(^|/)dist/`), so that a Drive
folder whose slug matches one cannot exempt its documents.

The scan reads only what a run changes. A value an earlier sync committed is
what the CI gate's history scan reports, on whichever pull request runs next.
Rotate it first, then remove it from the document so the next sync removes it
from the corpus. History still holds it. Either rewrite history, which is the
project's decision and requires every clone to be refreshed, or record the
finding's commit-qualified fingerprint, `<commit>:<path>:<rule>:<line>`, in
`.gitleaksignore`. Use the commit-qualified form here. The short form would also
let through a new value that lands on the same line of the same document.

## Rollback

Cloudflare Worker versions are immutable and include the static asset
deployment. To restore a known-good version:

1. Open the `example-docs-production` Worker **Deployments** page.
2. Identify a previously smoke-tested version ID.
3. Open **Actions → Production rollback**.
4. Enter the version ID and type `ROLLBACK`.
5. Approve the `production-deploy` environment gate.
6. Wait for the post-rollback protected smoke test.

The workflow checks the boundary before `wrangler rollback`, refuses a version
of a gated deployment that lacks the `ctcdocs-gate-v1` tag, refuses — unless
run with `restore_older_secrets` — a version older than a change to the
Worker's secrets, which a rollback would bring back, sends 100% of traffic to
the selected version, and verifies the protected surface afterwards. With
the MCP server on, the restored version publishes its own documents to the
bucket within five minutes. Record the incident, restored version, root cause, and subsequent
fix in a private issue or incident system.

If the boundary fails — the probe or a smoke test finds content served
anonymously, or a reader sees what their groups should not:

1. take the custom domain off the site Worker in the Cloudflare dashboard; the
   site is then unreachable rather than open;
2. stop sync and deployment workflows;
3. remove or disable any public alternate route;
4. rotate `SESSION_SECRET` without keeping the previous one, which ends every
   session; with the MCP server on, move to a new OAuth namespace, which ends
   every assistant's connection (see [Disconnecting assistants](#disconnecting-assistants));
   and revoke exposed deploy tokens or machine keys;
5. inspect Cloudflare, GitHub, and Google audit logs;
6. restore the domain on a gated version only after `ctcdocs-verify-gate`
   reproduces the failure and passes with the fix, and the anonymous smoke
   passes.

## Credential rotation

### Google WIF

1. create or validate the replacement read-only identity;
2. update `production-sync` variables;
3. run the Google WIF smoke workflow;
4. run a sync dry-run;
5. remove the old impersonation binding.

Do not introduce a service account JSON key for the synchronization identity
during routine rotation. The directory reader is the only identity with a key.

### Cloudflare deploy token

1. create a new account- and zone-scoped token;
2. replace `CLOUDFLARE_API_TOKEN` in `production-deploy`;
3. run a manual production deployment;
4. revoke the previous token after the protected smoke succeeds.

### Session secret

Every session and sign-in in flight is sealed with `SESSION_SECRET`. To rotate
it without signing everyone out:

1. copy the current value into `SESSION_SECRET_PREVIOUS`;
2. put a new random value of at least 32 characters into `SESSION_SECRET`;
3. after twelve hours — the longest a session lasts — delete
   `SESSION_SECRET_PREVIOUS`.

To sign everyone out at once, replace `SESSION_SECRET` and delete the previous
one. Each environment has its own. A rollback to a version from before a
rotation brings the old secret back; the rollback workflow refuses that unless
asked.

### Google client secret

1. add a second secret to the environment's OAuth client in Google Cloud;
2. replace `GOOGLE_CLIENT_SECRET` on that environment's site Worker;
3. sign in once;
4. delete the old secret in Google Cloud.

### Directory reader key

Rotate each environment's key at least every 90 days:

1. create a new JSON key for the directory reader's service account;
2. replace `DIRECTORY_KEY` on that environment's directory Worker, from the
   file, then delete the file;
3. confirm the next run logs `directory-refreshed`;
4. delete the old key in Google Cloud.

### Smoke key

Before the smoke key expires, issue a new one as in
[Machine keys](#machine-keys), add its record beside the old one, replace
`CTCDOCS_MACHINE_KEY` in the smoke environment, run a deployment, then remove
the old record.

## Dependency maintenance

Dependabot opens weekly npm and GitHub Actions updates. For every dependency
change:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm audit --audit-level high
actionlint
zizmor .github/workflows
gitleaks git --no-banner .
```

Keep all third-party actions pinned to full commit SHAs. The gitleaks release
and checksum in `project-sync.yml` and `project-ci.yml` move together, so the
sync scan and the CI gate apply the same rules; a test fails when they differ. Update Wrangler's
compatibility date deliberately, review Cloudflare release notes, and run a
protected deployment smoke after merging runtime or deployment-tool changes.

## Repository policy

`main` should require pull requests for code, resolve review conversations,
require CODEOWNERS review, disable force-push and deletion, and require:

```text
Quality and production build
Workflow and secret scanning
Dependency vulnerability audit
```

The sync bot is the only exception and may push only a verified generated
commit. If the GitHub plan cannot express a narrow bot bypass, replace direct
push with a dedicated GitHub App or a generated-content pull request. Never
weaken the general branch policy to make sync convenient.
