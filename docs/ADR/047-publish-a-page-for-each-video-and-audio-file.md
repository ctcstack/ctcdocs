# ADR-047: Publish a page for each video and audio file

- Status: Proposed
- Date: 2026-10-09
- Owners: CTCDocs maintainers
- Supersedes: ADR-025 in part: video and audio files are no longer listed as
  files the site does not publish

## Context

Teams record their instructions: a walk through a tool's screens, a lesson in
a series, a call explained once and kept. The recordings sit in the same
folders as the documents that describe the same work, as uploaded files or as
Google Vids. ADR-025 lists each one as a file the site does not publish and
asks its editor to link it from a document. Few do, so neither readers
browsing a section nor their assistants know the recording exists.

The site cannot host them. Workers Static Assets serves files up to 25 MiB, a
recording is often larger, and the site's search reads text. Reading what a
recording says, by transcription or by a model that watches it, would be an
LLM content transformation, which AGENTS.md keeps out of the platform.

Drive already holds what a reader needs to choose one: its name, the
description its editor can write in Drive, and for a video Drive has
processed, its length and frame size. The inventory reads every file's
metadata on every run, so none of it costs a download.

## Decision

**A video or audio file under the publication root is a document.** It gets a
page, an address, a permanent link, a place in the sidebar marked `Video` or
`Audio`, an entry on its section page, in the full index and in `llms.txt`,
like a Google Doc, a PDF or a spreadsheet. These are recordings: any file
whose type is `video/*` or `audio/*`, and a Google Vids video. Its title and
address come from its Drive name, without the extension an uploaded file
carries.

**The page is written from Drive's metadata, and the file is never
downloaded.** The inventory also asks Drive for each file's `description` and
`videoMediaMetadata`. The page opens with one sentence of facts, what it is,
how long and at what size when Drive knows, and that it plays in Drive. Below
come the paragraphs of the description as plain text: nothing in it becomes
markup but its web and mail addresses, which become links by GFM's own rule
before the text is serialized. The first paragraph is the page's summary.

**An uploaded recording plays on its page in Drive's own player.** A card
above the text frames `https://drive.google.com/file/d/<id>/preview`, the
player Drive offers for embedding, in the video's own shape, and links to the
recording in Drive below it. The site neither hosts nor streams the file:
Drive decides who may play it, by the Google account the browser is signed in
with, as it does when the file is opened in Drive. The Content Security
Policy admits frames from `https://drive.google.com` and from nowhere else.
Google Vids has no player to frame, so a Google Vids video's card has the link
alone. The row under the title keeps its "Open in Google Drive" link, or "Open
in Google Vids", as on every page, so readers find it where they always do.

**A recording without a description is noted.** The content health page lists
it with the note `media-undescribed`, which says where the description is
written in Drive. Readers and assistants know a recording only by its name and
what its editor says about it.

**A page changes when what it shows changes.** The record's `sourceChecksum`
for a recording is a digest of the metadata its page is written from and the
version of the page's shape. A recording whose digest is unchanged is not
written again; one whose description or length changed is. Drive reports a
file modified when its description changes, so the page's date moves with
it; the digest also covers a change Drive does not report, at the cost of a
page whose date stays behind its text.

**Links follow it.** A link in a document to a recording, by its Drive or its
Google Vids address, now opens its page, as a link to a published PDF does. A recording moved out of
the published folders leaves its links pointing at Drive, as before.

**The data records it.** The manifest's `exportMode` gains `video` and
`audio`. The page's
frontmatter says `sourceType: drive-media` and records the kind, `video` or
`audio`, whether it is a Google Vids video, and the length in seconds and the
frame size, each `null` when Drive does not report it. `data/docs-index.json` and the MCP server's metadata give its
format as `video` or `audio`, and the sync report counts recordings apart.

## Consequences

### Positive

- Every recording is on the site, in search and in the assistants' index,
  beside the documents of its section, and one click from playing.
- Editors describe a recording where it lives. Nothing is copied into a
  document and left to go stale.
- A recording costs the sync no download and the site no storage.
- The page leaves room for a transcript later without changing its address.

### Negative

- A page without a description says little more than its name, and many file
  names are what a screen recorder chose. Until editors rename and describe
  them, search and assistants find such a recording only by its name.
- A recording becomes visible to every reader its folder's rule names. Drive's
  own sharing still decides who may play it, so a reader can find a recording
  they cannot open.
- The player works only where the browser lets a framed Google page use the
  reader's Google sign-in. Safari, and other browsers that block third-party
  cookies, show Drive's request to sign in or for access instead; so does a
  browser whose default Google account is not the one with access. The card
  says to open the recording in Drive then, and its link always works.
- A recording's page loads Google's player when it is opened, and the site's
  Content Security Policy now admits one outside origin, in frames only.
- Drive reports the length and size of an uploaded video only once it has
  processed it, and not for audio; whether it reports them for a Google Vids
  video is not documented. Pages without them say less.
- A platform older than this cannot read a manifest that records a recording.
  Downgrading needs a run without them first.

### Follow-up

- Transcribe recordings, or describe what a screen recording shows, once the
  owners decide where that processing may run. That is a separate decision,
  since it brings a model into the sync.
- Show a frame of a video on its page, if readers miss it.
