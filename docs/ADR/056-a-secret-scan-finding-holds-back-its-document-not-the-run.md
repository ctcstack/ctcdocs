# ADR-056: A secret scan finding holds back its document, not the run

- Status: Accepted
- Date: 2026-11-23
- Owners: CTCDocs maintainers
- Supersedes: ADR-018 in part: the clause that the whole run
  fails, not the one document. The scan before the commit stays, and still
  stops the run for a finding no document is held back for.

## Context

ADR-018 made a sync scan every file it commits, and a finding stop the run.
It chose the whole run on purpose: committing everything but the offending
document would have published a corpus shaped by a scanner verdict, left a
manifest that describes output the run did not write, and taught the
converter about scanning.

ADR-026 has since given the sync a way to leave one document out without
those costs. A document that fails for a reason of its own is held back
before anything is written: the pass plans again without it, a published
document keeps its last version, a new one is left out, the manifest
describes exactly what the run wrote, and the sync report names it with the
fix.

The cost of a whole-run stop has also grown. ADR-055 lets the scan read
generated Markdown as plain text, and the content rules in
`docs/examples/gitleaks-content-rules.toml` catch credentials typed into
prose. Both find more, in documents that passed before. A credential typed
into one document, or a false positive waiting for an allowlist entry in
review, holds back every other document's update for as long as it takes, and
the deployments are internal documentation, where days without updates cost
more than one document out of date.

## Decision

**A document whose new output has a secret scan finding is held back, and the
rest of the corpus is published.** The reason is `secret-found`, a hold like
the ones ADR-026 lists: the published version stays, a new document is left
out, the pass plans again, and the run succeeds.

**The pass scans what it would write, before writing it.** After a pass has
exported its documents and before it assembles the corpus, it scans the
generated Markdown and the assets of each exported document whose bytes
differ from the file at the same path, and a new document's files. That is
what the scan before the commit would read for them, so a document exported
again to the same bytes is not held back for a value already published,
which stays the gate's history scan to report (ADR-018). The scan is the same
as the one before the commit:

- the gitleaks binary the workflow installed, named by
  `CTCDOCS_GITLEAKS_BINARY`;
- the project's own `.gitleaks.toml` and `.gitleaksignore`;
- the files written to a snapshot under their repository paths, so a finding,
  its line and its fingerprint are the ones the gate reports;
- generated Markdown scanned a second time as plain text (ADR-055);
- `--ignore-gitleaks-allow`, a redacted report read for its rule, path and
  line only;
- fail closed: a missing configuration, a path exemption that covers a
  scanned file, or a scan whose result cannot be trusted stops the run.

**The report says where, never what.** The held document's entry in the sync
report carries the rule and the line of the generated page for each finding,
such as `generic-api-key at line 12`. Content health ranks it under "Fix
now". The value, and the text around it, appear nowhere.

**A held document is tried again on every run.** The manifest does not record
a `secret-found` hold, unlike the holds ADR-053 keeps until Drive reports a
newer version: an allowlist entry in the project, not an edit in Drive, can
be what clears it. The document is exported and scanned again on each run,
and published on the first run that finds nothing.

**The scan before the commit stays.** It reads every changed file, and stops
the run for what no document is held back for: a finding in a file no single
document owns, such as the sidebar, a folder's section page or a data file,
and anything the scan in the pass did not see.

**When the pass does not scan, the run behaves as ADR-018 says.** A run
without `CTCDOCS_GITLEAKS_BINARY`, such as one on an editor's machine, holds
nothing back for a secret. A targeted run (`--file`) asked for the one
document, so its finding is the answer: the scan before the commit stops it.

## Consequences

### Positive

- A credential typed into one document, or a false positive in review, no
  longer holds back every other update.
- The finding is named in the sync report, the job summary and content health,
  beside the document and the fix, instead of only in a failed job's log.
- The value still never reaches Git or the site: the document it is in keeps
  its earlier version or stays off the site.
- The manifest and the generated output describe exactly what the run wrote,
  as with every other hold.

### Negative

- A run with such a document succeeds, so the failure notice does not fire.
  A real credential is seen when someone opens content health or the job
  summary, while everyone who can open the document has already seen it.
- Every run exports a held document again, and runs the scanner once more for
  each pass that holds one back.
- A published document stays out of date for as long as nobody removes the
  value or allowlists it.
- The scanner runs twice over a document's new output in a run that commits
  it: once in the pass, once before the commit.
- A finding in a folder's name or in a file no document owns still stops the
  whole run.

### Follow-up

- The publisher ADR-053 proposes must carry the scanner and set
  `CTCDOCS_GITLEAKS_BINARY` for its sync, or a finding stops its publish
  instead.
- Consider a notification for a document held for a secret, with ADR-026's
  follow-up for documents out of date for long.
