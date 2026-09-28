# ADR-026: Hold back a document that cannot be exported, not the corpus

- Status: Proposed
- Date: 2026-09-28
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

A sync writes nothing unless every document converts, so a failed run leaves
the last known-good output in place. That is right for a failure that says
nothing about the content: a lost credential, an exhausted quota, a network
error. It is wrong for a failure that belongs to one document and repeats on
every attempt.

Google refuses to export a document larger than 10 MB. An owner can turn off
downloading for viewers, and the sync reads as a viewer. Conversion refuses an
archive or an image it cannot publish safely. In each case the same document
fails the next run and every run after it, until an editor changes it. Until
then nothing else in the corpus is published either: not the edits to other
documents, not new ones. A deployment has lost several days of syncs to one
oversized document, and noticed only through the failure notice.

## Decision

**A document that fails for a reason of its own is held back, and the rest of
the corpus is published.** The reasons are:

- the Google export is over the size limit (`export_size_limit`);
- downloading is restricted for the file (`download_restricted`);
- conversion refuses its content: an unsafe archive, an unsafe image, an HTML
  export it cannot read, or Markdown it cannot normalize.

A Google error counts only when it names that document's file ID. Any other
failure — authentication, permission, rate limits, a server error, the
network, validation — still stops the run and changes nothing.

**What stays on the site depends on whether the document was published.**

- A document the manifest records keeps its published version: its generated
  file, its assets, its manifest record, its address and its permanent link
  stay as they were. It is planned where the manifest last saw it, under its
  recorded name and folder, so the sidebar and the section pages show it as
  the site has it. Its address is pinned even when addresses follow names
  (ADR-021) and a folder above it was renamed, so no redirect is made for it
  and links from other documents still resolve.
- A document the manifest does not record is left out, as if it were not in
  Drive yet.
- A recorded document whose recorded folder is gone is left out.

Either way the sync report lists it with the reason (ADR-025): out of date, or
not on the site.

**The run plans again rather than patching its plan.** Addresses, link targets
and section pages are decided before any document is exported, and a document
held back changes them. When a pass meets such a failure, nothing has been
written yet: it starts over with that document held back. Exports and
inspections already made are remembered for the run, so no document is
fetched from Google twice. Each pass holds back at least one more document, so
the run ends.

**A held document is tried again on every run.** Its recorded edit time no
longer matches Drive, so the next run exports it again. Once it succeeds, it is
published like any other change and leaves the list.

**A targeted run is not isolated.** `--file` asks for one document, so its
failure is the answer and stops the run.

## Consequences

### Positive

- One document can no longer stop every other update from reaching the site.
- A document that stops exporting keeps its last good version instead of
  disappearing, and its readers keep their links.
- The failure is named with the fix in the report, the job summary and the
  content health page, instead of an error line and a file ID.

### Negative

- A run with such a failure succeeds. The failure notice does not fire, so the
  job summary and the content health page are where it shows.
- The site can show an out-of-date version for as long as nobody fixes the
  document. The page says so and shows when that version was edited.
- A new document that fails adds itself to the corpus on every attempt, so
  each run exports the whole corpus again before holding it back, as any added
  document does today.
- A held document's generated page carries the folder path it had when it was
  last published, even after its folder is renamed.

### Follow-up

- Consider a notification for a document out of date for longer than a set
  time, if the page alone does not get it fixed.
