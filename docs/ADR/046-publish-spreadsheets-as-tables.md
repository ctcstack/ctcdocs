# ADR-046: Publish spreadsheets as tables

- Status: Proposed
- Date: 2026-10-08
- Owners: CTCDocs maintainers
- Supersedes: ADR-025 in part: spreadsheets are no longer listed as files the
  site does not publish, except the formats named below

## Context

Teams keep spreadsheets next to their documents: price lists, channel
budgets, unit economics, intake templates, request forms. ADR-025 lists each
one as a file the site does not publish and asks its editor to link it from a
document or paste a small table into one. The list keeps growing, and what
the spreadsheets hold is exactly what people and their assistants ask about.

They do not divide into easy and hard ones. One sheet holds two rows; another
holds a dozen tabs, several tables per tab and a model of formulas that refer
to each other. Any rule that publishes the easy ones and lists the rest would
have to be tuned file by file, and would still leave the most valuable files
off the site.

Most of them are Excel workbooks uploaded to Drive, not Google Sheets. Both
are the same format to read: an `.xlsx` file stores each formula with the
value it last computed and the number format it is shown with, and Drive
exports a Google Sheet as one. AGENTS.md kept Sheets out of scope; this record
takes them in.

## Decision

**A spreadsheet under the publication root is a document.** It gets a page,
an address, a permanent link, a place in the sidebar marked `Sheet`, an entry
on its section page, in the full index and in `llms.txt`, like a Google Doc
or a PDF. Its title and address come from its Drive name without the
extension.

These are spreadsheets:

- a Google Sheet, which the sync exports as `.xlsx`, under Google's 10 MB
  limit for exports (ADR-026 holds one back above it);
- an Excel workbook, `.xlsx` or `.xlsm`, which it downloads, up to 100 MiB,
  as it downloads a PDF; macros are never run;
- a CSV or tab-separated file, which it downloads.

An `.xls` or `.ods` file is still listed (ADR-025), with the advice to open it
in Google Sheets and save it as one.

**The file itself is not published; its cells are.** The page links to the
file in Drive. The sync reads the workbook's parts with the archive reader the
HTML export already uses, so the same limits on size, entries and compression
apply, and parses its XML with the parser it already has. Every value is
written as the workbook shows it: the value a formula last computed, formatted
by the cell's number format through `numfmt` 3.2.6 (MIT, no dependencies),
which implements Excel's format codes. Nothing in a cell becomes markup: the
page is built as a Markdown tree and serialized. A cell's link becomes a link
when its scheme is one the site allows, and a link to a Google Doc on the site
points at its page, as in a document.

**Every visible sheet is published, and its shape decides its form.** There is
no rule of simple and complex.

- Each visible sheet is a section headed with its name, unless the workbook
  has one. A hidden sheet is left out: hiding a tab is how an editor keeps it
  off the site. A chart sheet has no cells and is left out with a note.
- A sheet is cut into blocks at its empty rows and columns. A block of two
  columns or more is a table whose first row is its header; a single line of
  text above it is its caption. A block of one column is a list of its lines,
  and a single cell is a paragraph.
- A merged cell's value is repeated in every cell it covers, so each row reads
  on its own. A column whose cells are all numbers is aligned right.
- The table of contents lists the sheets only.

**A sheet with formulas says how it calculates.** Below its tables, a section
lists each distinct formula once, with the cells it fills: formulas in
adjacent cells that differ only by their offset, as a row of monthly totals
does, are one entry. Each entry names the cells it refers to by their labels:
the cell's row label, the text at the left of its row in its block, and its
column label, the header of its column, or a name the workbook defines for
it. The section then lists the inputs, the constant cells formulas depend on,
and the results, the formula cells nothing else uses, each with its label and
value. A person sees what to change and what changes; an assistant can explain
the model and recompute it under other inputs. Each list stops, at 200
formulas, 100 inputs and 50 results per sheet, and says how many it left out.

**Limits keep a page readable.** A sheet past 2,000 rows, or a workbook past
50,000 filled cells or 100 visible sheets, is published up to the limit, and
the page says where it stops. An uploaded file over 50 MB is held back
(ADR-026), as is a file that is not a workbook. Charts, images and drawings are not shown. The content health page
lists both with the status `incomplete` (ADR-025), so the editor knows the
page lacks them.

**Long tables repeat their header for assistants.** In the Markdown version a
table longer than about 3,000 characters is split into parts of about 2,000
characters, each opening with the table's header row, so that a passage AI
Search returns (ADR-042) still says what each column is. Tables are written
without padding, which one long cell would otherwise add to every row. This
applies to every page's tables, a Google Doc's included. The page keeps one
table.

**The page is made for reading tables.** A spreadsheet's page shows each table
with its header row held in view while it scrolls. A table of more than ten
rows gets a filter field and columns sorted by a click on their header, in the
browser, without changing what search indexes.

**Nothing is read twice.** An uploaded file whose SHA-256 is unchanged is not
downloaded again, as a PDF is not (ADR-027); a Google Sheet is exported again
when Drive reports it changed. A better conversion reads every spreadsheet
again once.

**The data records it.** The manifest's `exportMode` gains `sheet`; a
spreadsheet's record carries `sourceChecksum` for an uploaded file and
`sheetVersion`. The page's frontmatter says `sourceType: drive-sheet` and
records the number of sheets and formulas it publishes. `data/docs-index.json`
and the MCP server's metadata give its format as `sheet`.

## Consequences

### Positive

- The numbers people ask about are on the site, in search and in the
  assistants' index, with the file one click away.
- Editors keep working in the spreadsheet as they do. Nothing is pasted into
  a document and left to go stale.
- A model is explained by its own formulas, not only shown as its last result.
- Every long table, in a spreadsheet or a document, keeps its header in each
  passage an assistant reads.

### Negative

- A spreadsheet is published to everyone its folder's rule names. Price lists
  and client economics that sat unread in Drive become searchable by every
  reader of that folder and their assistants. Editors should hide or move what
  is not for them.
- Values are what the workbook last computed. An Excel file saved without
  recalculation, or a formula that reads another file, publishes a stale
  value. A Google Sheet's `NOW()` or `RAND()` changes on every export, so a
  full sync rewrites its page.
- Labels are inferred from the layout. A sheet laid out as a form rather than
  a grid gets formulas named by cell address where no label is found.
- Charts, images, comments, conditional formatting and data validation are not
  shown. The page lists charts and images as missing; the rest is not counted.
- The cut into blocks follows empty rows and columns. Two tables that touch
  read as one, and a table broken by an empty row reads as two.
- `numfmt` is a new production dependency of the sync package, and the
  workbook reader is new code that parses files editors upload.
- A platform older than this cannot read a manifest that records a
  spreadsheet. Downgrading needs a run without them first.

### Follow-up

- Offer each sheet as CSV to assistants if they need to compute over a whole
  table rather than read it.
- Combine two header rows into one where the first groups the second.
