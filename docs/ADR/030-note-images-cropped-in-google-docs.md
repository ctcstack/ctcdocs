# ADR-030: Note images cropped in Google Docs

- Status: Proposed
- Date: 2026-09-28
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

Google Docs crops an image without changing it. The HTML export ships the whole
file, frames it in a `span` with `overflow: hidden`, and draws the image larger
than the frame or moves it with a negative margin; the part outside the frame
is what the editor cropped away. Two exports of a test document confirmed it:
the image files were byte for byte the same with and without the crop.

The converter keeps only `alt`, `src` and `title` on an image and not the
frame's style, so the site publishes the whole image: on the page, in its
Markdown projection, and in the project's Git history. Readers and AI agents
see what the editor cut. Nothing records it, so no deployment knows whether it
has cropped images, or how many.

What to do about them is not decided. Leaving a cropped image out loses content
the editor meant to show; applying the crop needs an image codec, which belongs
with the decision on how the sync processes images. Either choice starts with
knowing whether cropped images occur.

## Decision

**The converter recognizes a crop from the export's frame.** An image inside a
frame with `overflow: hidden` is cropped when, with its margins, it reaches
beyond the frame on any side, allowing half a pixel for the export's rounding.
Every image kept on the page counts, each time it appears.

**The manifest records the count as `croppedImages`** next to
`undescribedImages` (ADR-029), on every document converted through the HTML
export, zero included. The one export that counts images without alt text
counts crops too: a document with images missing either count is exported once
more by a normal sync.

**Each page with a cropped image is a note** (ADR-028) of the kind
`image-cropped`, "An image is cropped in Google Docs", with the number of images
as its detail and the instruction to check what was cropped away and to crop an
image before inserting it. It comes first among the notes: it is the one where
a reader sees what an editor meant to leave out.

**Publication does not change.** The page, its Markdown projection and its
images are what they were.

## Consequences

### Positive

- A deployment learns from its first sync after upgrading whether it publishes
  cropped images, and on which pages.
- Editors can check each part cropped away and replace an image with one
  cropped before it is inserted.
- What the sync should do with cropped images can be decided on numbers.

### Negative

- The site still publishes the parts cropped away; the note says so but does
  not prevent it.
- An image published whole stays in the project's Git history after it is
  replaced; the note speaks only of the images published now.
- This public repository describes the behavior before it is changed.
- How the export writes a rotated image has not been seen. A rotated image
  framed another way may not be recognized, and rotation alone is not noted.

### Follow-up

- Decide whether a cropped image is left out, or published with the crop
  applied, as part of the decision on image processing.
- Confirm on a test export how Google writes a rotated image, cropped and not.
- Where cropped images turn up, check what the project's Git history holds of
  them.
