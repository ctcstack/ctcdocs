# ADR-029: Say when an image has no alt text

- Status: Proposed
- Date: 2026-09-28
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

The converter gave every image without alt text the alt `Image from <document
title>`. The text read as a description and said nothing about what the image
shows. A person using a screen reader heard only which document it was from.
An AI agent reading the Markdown projection could not tell it from an alt text
an editor wrote, so it could not decide whether the image was worth opening,
which costs it hundreds to thousands of visual tokens per image. A page that
opened with such an image took it as its summary, the first words of the page
that section pages list it by and that its metadata describes it with.

On the first deployment measured, nineteen image references in twenty carried
that text, and it was the summary of one page in seven. Nothing recorded it:
conversion left no warning, so the content health page could not say which
pages need descriptions, and editors had no way to see the work or their
progress on it.

Google's HTML export writes the Alt text dialog's Description as an image's
`alt` and its Title as `title`, each empty when the editor left it blank. The
converter kept a title only as a Markdown title, so an image an editor gave
only a title still received the made-up alt.

The sync must not write descriptions itself. AGENTS.md rules out an LLM content
transformation, and only the editor knows what an image is there to show.

## Decision

**An image with a title and no alt text takes its title as its alt**, said
once rather than as both. A blank title is dropped.

**An image without alt text or a title is published with an empty alt.**
`![](…)` in the Markdown and `alt=""` in HTML say plainly that there is no
description. A page takes its summary from its first words, not from an image.

**A heading that holds only an image is published as a paragraph.** A heading
style applied to a line with a picture would otherwise leave a heading with no
words, nothing to show in the table of contents or to link to.

**The converter counts the images it publishes without alt text.** Every
image kept on the page whose alt and title are both missing or blank counts,
each time it appears, inside a table as well. An image removed as unsafe is not
on the page and is not counted.

**The manifest records the count as `undescribedImages`** on every document
converted through the HTML export, zero included. A document converted from
the Markdown export has no images and carries no count, nor does a PDF.

**Each page with such an image is a note** (ADR-028) of the kind
`image-undescribed`, "An image has no description", with the number of images
as its detail and the instruction to add alt text in Google Docs. It follows
the notes about what conversion lost.

**A page with images recorded before they were counted is exported once
more** by a normal sync. It is written again where the decisions above change
it: an image without alt text or with only a title, a heading that holds only
an image, an image inside a table, which loses the blank title Google gives
every image. A section page is written again when a summary it lists changes.
Any other page is left byte for byte as it is. A document without images has
nothing to count and is not exported for it; it records its count, zero, the
next time it is exported.

**The record of a page left as it is follows its conversion.** The export it
came through, its warnings and its count are taken from the conversion just
made, not carried over, so a document whose export changes while its page does
not is recorded as it now is, and not exported again on every run.

The converter version does not change: that would export every document and
rewrite the synchronization time on every page. The count and the empty alt
ship together, so the one export that counts is also the one that writes the
empty alt.

## Consequences

### Positive

- An agent can tell a described image from one that is not, and page
  summaries are words from the page.
- Editors see which pages have images without descriptions and how many, next
  to what to do, on the content health page and in the job summary.
- Each description an editor writes reaches screen readers and agents through
  the page and its Markdown projection, and the committed report shows the
  progress.

### Negative

- A screen reader skips an image with an empty alt, as it would a decorative
  one, so its user no longer hears that an image is there.
- The first sync after upgrading exports every document with images converted
  through the HTML export once more, which takes time and Google API quota, and
  rewrites the pages the decisions above change.
- On a corpus where most images lack descriptions, the note is the longest
  group on the page, and a change in any count writes a new report.
- The count is per page, not per image. The note cannot point to the image in
  the document; an editor looks for it.
- The HTML export does not say whether an editor meant an image to go without a
  description, so an image that needs none is noted like the others.

### Follow-up

- If a count per page proves too coarse, locate each image from the Docs API
  structure, whose embedded objects carry the alt text as `title` and
  `description`, next to the heading it sits under.
