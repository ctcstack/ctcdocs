# ADR-018: A sync run scans what it commits, and a finding stops it

- Status: Proposed
- Date: 2026-09-23
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

A project's CI gate scans its complete Git history and its working directory for
secrets. The sync is not among the runs that reach it. `project-sync.yml`
commits generated output and pushes it with the workflow's `GITHUB_TOKEN`, and
GitHub starts no other workflow for a push made with that token. Whatever a
Google Doc says is committed and deployed without a secret scanner having read
it.

This has happened. A document carrying credential-shaped values — what gitleaks
reports as `generic-api-key` — was synchronized, committed and deployed. The
finding surfaced only when an unrelated pull request ran the history scan and
failed on it, by which time the value was in history and on the site.

Scanning with `gitleaks git` before the commit would leave three gaps, each
confirmed against gitleaks 8.30.1:

- It reads a diff, and a `.gitattributes` entry that marks generated files
  `binary` or `-diff` — a plausible way to quiet large generated diffs — leaves
  it nothing to read. It reports a clean scan.
- It skips a line containing `gitleaks:allow`. In a sync that line is written in
  Google Docs by a document's author, not reviewed in a pull request.
- A `paths` exemption in `.gitleaks.toml` that is not anchored, such as
  `(^|/)dist/`, also exempts a generated folder whose slug matches it. `validate`
  reports an exempt tracked file, but only after it is committed.

## Decision

**Before committing, the sync scans every generated file the run added or
changed, and a finding fails the run.** Nothing is committed or pushed, so the
project's `main`, and with it the deployment, keeps the last known-good output.

The scan is `ctcdocs-sync scan:generated-diff`. It runs after the final
generated-diff validation, and only when the run changed something.

- **Same scanner, same rules as the gate.** gitleaks is installed from the
  release and checksum `project-ci.yml` uses, and a test fails if the two pins
  diverge. It reads the project's own `.gitleaks.toml` and `.gitleaksignore`,
  so an allowlist entry means the same thing to the sync and to CI.
- **Files, not a diff.** The changed files are copied to a snapshot under their
  repository paths and scanned there with `gitleaks dir`. The scanner reads the
  bytes that will be committed, whatever Git would show. Its line numbers and
  `path:rule:line` fingerprints are the ones the gate reports for those files.
- **No allowlisting from content.** `--ignore-gitleaks-allow` is always passed.
  A false positive is accepted in reviewed repository configuration.
- **Fail closed.** The scan refuses to run when `.gitleaks.toml` is missing,
  when one of its path exemptions cannot be interpreted, or when one covers a
  changed file. A scanner that exits abnormally, writes no report, or
  contradicts its own report fails the run as well. Only a report that parses
  as empty passes it.
- **Say where, never what.** Each finding is logged as its rule, generated
  path, line, and the Google file ID the manifest records for that path. The
  scanner redacts its report, which is written outside the repository and
  deleted once read. Only those four fields are taken from it, never the value
  or the document text around it. The scanner's own output is discarded.
- **The notification names the stage and nothing else.** The failure webhook
  reports `secret-scan`, with no rule, path, file ID or count.

**A finding fails the run instead of warning.** A warning on a scheduled job is
read after the push, which is after the deployment. It would deliver the outcome
this decision exists to prevent.

**The whole run fails, not the one document.** Committing everything but the
offending document would publish a corpus shaped by a scanner verdict, leave a
manifest that describes output the run did not write, and teach the converter
about scanning. The run stays atomic.

**The diff is scanned, not the corpus.** A value already committed is the
gate's history scan to report. Re-reporting it on every sync would halt
synchronization for a condition the sync did not create.

## Consequences

### Positive

- Credential-shaped content no longer reaches Git history or the site through a
  sync.
- The failure happens in the run that brought the value in, and names the
  document, rather than in some later, unrelated pull request.
- A sync commit can no longer turn the gate red afterwards.
- Neither `.gitattributes` nor a marker typed into a document can hide a value
  from the sync.

### Negative

- One finding holds back every document's update until the source is fixed or
  the finding is allowlisted, which for a false positive awaiting review can be
  days.
- A `.gitleaksignore` entry is tied to a line. An edit above the value moves it,
  and the sync fails again. Rule-scoped allowlists are sturdier, and they are
  what the runbook recommends.
- The sync is stricter than the gate about `gitleaks:allow`: a value the gate
  would skip fails the sync.
- The scanner reads text. A credential in an image is not found, nor one in an
  SVG, which gitleaks' default rules exempt.
- The reported line is a line of the generated Markdown, not of the Google Doc.
- The sync workflow downloads one more binary, whose pin has to move with
  `project-ci.yml`.
- The workflow calls a command that first ships in the next package release. A
  project that moves its workflow reference has to move `@ctcstack/ctcdocs-sync`
  with it, or the scan step fails — closed.

### Follow-up

- The runbook for a finding is in
  [Operations](../OPERATIONS.md#secret-scan-findings).
- Projects should anchor their `.gitleaks.toml` path exemptions at the
  repository root (`^dist/` rather than `(^|/)dist/`).
- A value an earlier sync already committed is not reached by this scan. It is
  rotated and remediated as the runbook describes.
