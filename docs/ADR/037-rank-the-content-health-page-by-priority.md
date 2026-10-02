# ADR-037: Rank the content health page by priority

- Status: Proposed; superseded in part by
  [ADR-039](039-open-a-folder-only-to-the-google-groups-its-rule-names.md), under which
  the page is read by admins only and lists folders without a rule
- Date: 2026-10-01
- Owners: CTCDocs maintainers
- Supersedes: ADR-024 and ADR-028 in part: how the content health page is laid
  out; and ADR-011 in part: status colors on this one page

## Context

The content health page grew a section with every release: files not on the
site (ADR-025), notes on published pages (ADR-028), images without alt text
(ADR-029), crops the site could not apply (ADR-030, ADR-031), headings,
summaries and outside links (ADR-034). Each section was laid out the way it
was added, in the order it was added. On the first deployment the page held
several hundred items and ran to dozens of screens, set in one grey, with the
mistakes a reader runs into, "Fix", at the very bottom, under more than a
hundred items of lesser weight.

The page is read by two kinds of people. A lead wants the state of the
documentation at a glance: how much is wrong, how badly, and where. An editor
wants the things that are theirs, in the order to do them. Neither question
was answered above the fold, and the sections were named for what the sync
knows — "Not on the site", "Notes", "Worth a look" — not for what a reader
should do first. Nothing on the page said what was already in order.

The reports group findings by what fixes them, and that stays right: a group
is one action. What was missing is an order between the groups.

## Decision

**Every group has a priority, and the page is ordered by it.** There are
four, and a fifth that is not work yet:

- **Fix now**: a reader runs into a mistake, or a document cannot reach the
  site. A heading in two alphabets, another document's title, an empty
  document; a document held back by its name, its size, its download setting
  or its content; an image shown with the part cropped away, an image or link
  conversion left out, an unclosed code block.
- **Fix next**: content that is in Drive and not on the site, or that a
  reader may misread. Word files, presentations, archives, images, diagrams,
  spreadsheets, video, other files and shortcuts; PDFs the site cannot read
  or serve; two files with one name; merged cells split, formatting left out.
- **Improve**: easier to find and to understand, for people, search and AI
  agents. Alt text, a summary, a smaller image, a link to a page instead of a
  Drive file, a link to a heading, a PDF only partly searchable, heading
  levels and repeated headings, a second landing document.
- **Tidy up**: names and order in Drive, which the site shows as they are.
  "Copy of", extensions, underscores, extra spaces, order numbers used twice
  or not read, an ignored folder that is gone.
- **Proposed convention**: the Title-line checks of ADR-024. They are shown
  last, with how many documents follow the convention, and do not count
  against a file.

The ranking is made in the site package, once, by code, because a reason or a
note has no severity and a check's severity says what kind of finding it is,
not how soon it matters. A code a newer sync writes and the site has not
ranked lands under Improve, or by its severity when it is a check. A unit test
reads the fixture reports, which carry the full catalogs, and fails when a
code has no rank of its own.

**The page leads with one figure and one bar, for the whole knowledge base.**
The figure is the number of files in the most urgent state any file is in,
"3 files to fix now", with a link to them. One line says how many files are
on the site and when the sync ran. The bar divides every file in the published
folders by its most urgent task. Then "Where the work is": tasks by top-level
section and by last editor, a bar per row on one scale, with the tasks to fix
now and all tasks as labelled numbers, the most urgent first. Choosing a row
filters the page to it. It is folded on a phone and on a filtered view.

**Files and tasks are counted apart, and named apart.** The overview counts
files, each once, by its worst task, and names them by state — "Need a fix
now", "Need a fix next", "Only improvements", "Only tidying", "All good" — never
by a priority's label. A priority counts tasks: one file in one group, and the
toolbar says how many tasks there are in how many files. A file with alt text
missing and an underscore in its name is one file under "Only improvements" and
two tasks on the page.

**A group is one line until it is opened.** Folded, it says what it is, what
to do in a few words, how many files or documents it holds, and the two
sections with most of them. Within a priority, files the site does not show
come first under their own heading, then the rest, each the largest group
first. Groups start folded except under Fix now. Opened, a group gives the
instruction and every file. A file leads with one action, opening it in Google
Docs or Drive; its page on the site is a quieter link. Title checks gain the
short action the other catalogs carry; a report written before has none, and
the page leaves it out. A letter typed in the other alphabet is named in words
and marked in the heading it is in, read from the form the sync writes it in,
which is shown as it is when it does not match.

**What is in order is shown.** Each priority lists the checks that were all
clear, folded, and a priority with no tasks says so in green.

**Filters narrow every task list, and the address keeps them.** Section and
last editor filter every list and task count below the overview, in a toolbar
that stays at the top on a wide screen, with a chip per priority to jump to.
The overview says it is the whole knowledge base and stays so. The choice is
written to the query string, and a filtered view offers to copy its link, so a
lead can send each editor theirs. Such a link opens on the tasks, and a list of
15 or fewer opens its groups.

**Status colors are allowed on this page.** ADR-011 keeps color to the brand
accent so that it carries meaning; here it carries the most important meaning
the page has. The hues come from Starlight's aside palette, which it sets per
theme, read as `--kb-*` tokens in the adapter: red, amber, blue, grey, purple,
green. The lower a priority, the quieter its hue, mixed toward grey, so red
draws the eye however many tasks the others hold; each mark keeps at least
3:1 against the page in both themes. A hue marks a dot, a bar, an icon, a rule
or a badge, and never text, which stays in ink; every hue comes with an icon
and a label. Only this page uses them.

The sync, its reports and their schema versions do not change, apart from
the short action on each check, which older readers ignore.

## Consequences

### Positive

- The first screen answers the lead's question, and the second the editor's:
  the toolbar, then what to fix now.
- The page reads from the top in the order work should be done, and a group's
  folded line is enough to decide whether to open it. On the first
  deployment the folded page is a few screens long instead of dozens.
- A filtered address is a work list that can be sent to its owner.
- Progress shows as a bar that turns green, after every sync.

### Negative

- The ranking is a judgment, made for every deployment by the platform. A
  team that weighs a finding differently cannot move it without a change
  here.
- The page has two units, files and tasks. They are named apart, but a
  reader comparing the bar with a priority's count will see different
  numbers.
- The overview does not follow the filters. A file's state for one editor
  would need every file's tasks in the browser; the overview says what it
  counts instead.
- Status colors are a second color system beside the accent, on one page.
  They are tokens, so a later page can reuse them, but each reuse should be as
  deliberate as this one.
- The old section anchors `#not-on-the-site`, `#notes`, `#fix`,
  `#convention` and `#note` are gone. A group's own anchor is kept.
- The page reads the sync's wording of a stray letter. If that wording
  changes, the page shows it as it is until it is taught the new one.

### Follow-up

- The design was reviewed against the first deployment's data by a reviewer
  taking a lead's and an editor's view; what was not taken up is below.

- Agree the ranking with the first deployment's editors after a few weeks of
  use, and move what they disagree with.
- Progress over time: the page shows one sync. A trend needs the counts of
  earlier syncs kept somewhere the build can read, written only when they
  change so a sync over unchanged input still changes nothing.
- An owner per section or document. The last editor stands in for one, and in
  a Shared Drive it is a weak stand-in.
