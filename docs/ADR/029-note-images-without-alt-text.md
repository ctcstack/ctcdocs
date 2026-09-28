# ADR-029: Note images that have no alt text

- Status: Proposed
- Date: 2026-09-28
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

The converter gives every image without alt text the alt `Image from <document
title>`. The page keeps an `alt` attribute, so the accessibility gate in the
browser suite holds, but the text says nothing about what the image shows. A
person using a screen reader hears only which document it is from. An AI agent
reading the Markdown projection learns what the image shows only by opening
it, which costs it hundreds to thousands of visual tokens per image.

On the first deployment measured, nineteen image references in twenty carried
that fallback. Nothing recorded it: conversion left no warning, so the content
health page could not say which pages need descriptions, and editors had no
way to see the work or their progress on it.

The sync must not write descriptions itself. AGENTS.md rules out an LLM content
transformation, and only the editor knows what an image is there to show.

## Decision

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
normal sync. When the page it produces is the one already published, the page
is left byte for byte as it is and only its record gains the count. The
converter version does not change: that would export every document and
rewrite the synchronization time on every page.

**The fallback alt stays.** The site does not describe images; it says where a
description is missing.

## Consequences

### Positive

- Editors see which pages have images without descriptions and how many, next
  to what to do, on the content health page and in the job summary.
- Each description an editor writes reaches screen readers, search and agents
  through the page and its Markdown projection, and the committed report shows
  the progress.
- Upgrading changes no published page.

### Negative

- The first sync after upgrading exports every document converted through the
  HTML export once more, which takes time and Google API quota.
- On a corpus where most images lack descriptions, the note is the longest
  group on the page, and a change in any count writes a new report.
- The count is per page, not per image. The note cannot point to the image in
  the document; an editor looks for it.
- The HTML export does not say whether an editor meant an image to go without a
  description, so an image that needs none is noted like the others.

### Follow-up

- Confirm on a sanitized real export how Google writes an image's alt text and
  title into the HTML export, and add it as a converter fixture.
- If a count per page proves too coarse, locate each image from the Docs API
  structure, whose embedded objects carry the alt text as `title` and
  `description`, next to the heading it sits under.
