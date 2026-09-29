# ADR-031: Apply the crop Google Docs makes to an image

- Status: Proposed
- Date: 2026-09-29
- Owners: CTCDocs maintainers
- Supersedes: ADR-030 in part: a cropped image is published cropped, not
  whole, and is a note only when the site cannot crop it

## Context

ADR-030 recognized the crop Google Docs makes and counted it, publishing the
image whole. The first sync that counted, on the first deployment measured,
found 111 cropped images in 30 documents, most of them screenshots of
administration pages and forms, whose edges are where addresses, lead data
and keys appear. The site published each of them whole, in the page, in its
Markdown projection and in the project's Git history, and an agent reading the
projection read the part the editor had cut.

Leaving those images out would take 111 images off 30 pages. Applying the crop
needs a codec, which has to be lossless and give the same bytes for the same
image on any machine: the fixture corpus is regenerated on macOS and on Linux
and must match byte for byte, and a sync over unchanged input must change
nothing. It should add no native build and as little as possible.

The candidates were measured on the same crops: the middle three fifths of
each of the 368 PNG images of that deployment, an area the original files
spent 18.7 MB on. Every one was lossless and gave the same bytes on a second
run.

| Codec                                  | Kind       | Crops   |
| -------------------------------------- | ---------- | ------- |
| `@jsquash/png`                         | WASM       | 38.9 MB |
| `@jsquash/png` and `@jsquash/oxipng`   | WASM, two  | 15.8 MB |
| `fast-png`                             | JavaScript | 18.5 MB |
| `@cf-wasm/png`, best compression       | WASM       | 21.6 MB |
| `sharp`, level 9, the codec Astro uses | native     | 21.7 MB |
| `pngjs`, level 9, on Node's zlib       | JavaScript | 24.5 MB |

`sharp` is installed in every project for Astro, but as a native binary built
per platform, at a version the project chooses, so its bytes are not the
platform's to keep stable. No WASM build of oxipng newer than 9.1.1, from 2024,
is published; upstream is at 10.

## Decision

**The converter applies the crop to the file.** It reads the frame as ADR-030
does and turns the window the frame shows into the file's pixels, rounding each
edge inward so that no pixel cropped away is published. It decodes the image,
keeps those pixels, and encodes them again in the same channels and bit depth
at deflate level 9. A palette image is cut as the colors it shows. The color
chunks (`iCCP`, `sRGB`, `gAMA`, `cHRM`), and the transparent color of an image
without a palette (`tRNS`), are carried over; metadata is not.

**The codec is `fast-png`,** plain JavaScript pinned to one version: lossless,
the same bytes on any machine, one library to decode and encode, and within a
fifth of oxipng. oxipng would save about a sixth more, on cropped images only,
for a second dependency built in 2024. `fast-png` writes a palette's
transparency one entry out of place; the sync never writes a palette.

**A crop the site cannot apply publishes the image as it is, and is a
note:** a file other than a PNG, an image also rotated, grayscale packed below
eight bits, a file above 4096 × 4096 pixels, or one that does not decode.
Leaving the image out would lose what the editor meant to show; the note says
where the part cropped away is still shown. The note kind
`image-crop-not-applied`, "A cropped image is shown whole", comes first among
the notes and replaces `image-cropped`: a crop applied leaves nothing to check.

**An image is named by the bytes published,** so one image cropped two ways
is two files.

**The manifest keeps counting crops** as `croppedImages`, and records the
image processing a document's images were published with as `imageVersion`,
now 1. A normal sync exports again, once, a document with a crop and an older
`imageVersion`: those whose crops were published whole.

## Consequences

### Positive

- A page, its Markdown projection and its image files show what Google Docs
  shows, and nothing an editor cut.
- An agent opening a cropped image reads only the pixels that were kept.
- A cropped image is about as small as the part of the original it keeps, and
  carries none of the original's metadata.

### Negative

- The images published whole stay in each project's Git history. Whether to
  remove them is a decision for each deployment.
- A cropped image the site cannot crop, such as a JPEG, is still shown whole,
  the part cropped away included; the note is all that says so.
- The sync gains a production dependency, `fast-png`, with `fflate` and
  `iobuffer`. A new `fflate` may compress the same pixels differently, and so
  rewrite cropped images once.
- The sync decodes untrusted PNG files. The pixel limit bounds the memory that
  takes, and the decoder is JavaScript.
- How Google's export writes a rotated image has still not been seen; a
  rotated image that is also cropped is shown whole, with the note.

### Follow-up

- Confirm on a test export how Google writes a rotated image, and crop it if
  the frame can be read.
- Crop a JPEG too, if the note shows enough of them: a test export already had
  one.
- In each deployment with cropped images, decide whether to remove the whole
  images from Git history.
- If the weight of cropped images matters, measure oxipng on them again.
