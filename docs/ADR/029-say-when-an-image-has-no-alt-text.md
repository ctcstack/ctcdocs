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

The sync must not write descriptions itself. AGENTS.md rules out an LLM content
transformation, and only the editor knows what an image is there to show.

## Decision

**An image without alt text is published with an empty alt.** `![](…)` in the
Markdown and `alt=""` in HTML say plainly that there is no description. A page
takes its summary from its first words, not from an image.

**A heading that holds only an image is published as a paragraph.** A heading
style applied to a line with a picture would otherwise leave a heading with no
words, nothing to show in the table of contents or to link to.

**The converter counts the images it publishes without alt text.** Every
image kept on the page whose alt is missing or blank counts, each time it
appears, inside a table as well. An image removed as unsafe is not on the page
and is not counted.

**The manifest records the count as `undescribedImages`** on every document
converted through the HTML export, zero included. A document converted from
the Markdown export has no images and carries no count, nor does a PDF.

**Each page with such an image is a note** (ADR-028) of the kind
`image-undescribed`, "An image has no description", with the number of images
as its detail and the instruction to add alt text in Google Docs. It follows
the notes about what conversion lost.

**A page recorded before images were counted is exported once more** by a
normal sync. A page with an image without alt text comes out with the empty
alt and is written again; any other is left byte for byte as it is, and only
its record gains the count. The converter version does not change: that would
export every document and rewrite the synchronization time on every page. The
count and the empty alt ship together, so the one export that counts is also
the one that writes the empty alt.

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
- The first sync after upgrading exports every document converted through the
  HTML export once more, which takes time and Google API quota, and rewrites
  every page with an image without alt text.
- On a corpus where most images lack descriptions, the note is the longest
  group on the page, and a change in any count writes a new report.
- The count is per page, not per image. The note cannot point to the image in
  the document; an editor looks for it.
- The HTML export does not say whether an editor meant an image to go without a
  description, so an image that needs none is noted like the others.

### Follow-up

- Confirm on a sanitized real export how Google writes an image's alt text and
  title into the HTML export, add it as a converter fixture, and use a title as
  the alt when it is the only text an editor gave.
- If a count per page proves too coarse, locate each image from the Docs API
  structure, whose embedded objects carry the alt text as `title` and
  `description`, next to the heading it sits under.
