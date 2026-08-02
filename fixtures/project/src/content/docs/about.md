---
title: About this site
description: What this synthetic deployment is for.
---

This is the fixture project of the CTCDocs platform: a complete deployment with
a corpus that nobody wrote by hand.

Every document under **Handbook** and **Reference** is produced by running the
real synchronization pipeline over synthetic Drive fixtures, so the pages here
exercise the same conversion, navigation, search and accessibility paths a real
deployment does. Platform CI regenerates the corpus on every run and fails if a
single byte differs, which is how the pipeline's idempotence doubles as a
staleness check.

Nothing here comes from a real Google Drive, and nothing here should. Real
documentation content must never reach this repository.

## What the corpus covers

- a document at the Drive root, and one inside a folder, for breadcrumbs and
  folder anchors;
- a folder whose landing document describes it, and one without, for the card
  description fallback;
- a table, a mermaid diagram, a code block, and an image;
- a Cyrillic document, for multilingual search and font subsetting;
- a retired slug, for the generated redirect map.

This page is the other half of the picture: a hand-authored page a project
writes itself, sitting next to the generated tree without being part of it.
