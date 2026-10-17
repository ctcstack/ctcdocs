# ADR-052: The brand icons are served before sign-in

- Status: Proposed
- Date: 2026-10-17
- Owners: CTCStack
- Supersedes: ADR-038 in part: that nothing is served to an anonymous
  request, and that the access smoke test requires the favicon to be refused

## Context

A private deployment's Worker answers every anonymous request from the
request alone, with `401` or a redirect to sign-in (ADR-038). The favicon is
no exception.

Assistants list the MCP server (ADR-041) among their connectors, and show an
icon beside each. They fetch it the way a browser's tab or a search engine's
favicon service does: without a session, from the server's `icons` (MCP
specification 2025-11-25) or from the host's `/favicon.ico`. Behind the gate
every one of those fetches is refused, so the connector shows a blank square
where every other connector shows its mark. Some of those clients do not
render SVG, the only form a project's mark has today.

The mark is not content: it is the same on every page, in the sign-in page's
own title, and in the screenshots readers share. Nothing about who may read
what follows from it.

## Decision

**A few brand icons are served to anyone.** The build lists them in the
access map as `site.icons`: the project's `brand.faviconPath`, its
`brand.faviconDarkPath` when set, and two raster copies it renders from the
favicon — `/icon-192.png`, 192 pixels square, and `/favicon.ico`, holding
16, 32 and 48 pixels as PNG. A copy the project's `public/` already holds is
kept and listed instead of rendered. Without a favicon in `public/` the list
is empty.

**The Worker matches them exactly.** A `GET` or `HEAD` whose path is one of
those listed, spelled exactly as the build listed it, is served from the file
store before anything else is looked at — before sign-in is configured, a
session read or a directory consulted. It is fetched by that path, follows no
redirect, and carries the private headers every other file does. Any other
path, any other method and any other spelling of the same path goes through
the gate as before.

**The MCP server names them.** Its implementation info lists each icon by an
absolute address on the environment's own origin, with its type, its sizes
and, for the dark variant, its theme.

**The checks follow.** The access smoke test no longer requires the favicon
to be refused; the end-to-end suite requires the icons to be served to an
anonymous request on a private deployment, and the Worker's unit tests that
nothing else is.

## Consequences

### Positive

- Connector lists in Claude, ChatGPT and other clients show the site's mark.
- A browser tab and a bookmark show the mark before the reader signs in.

### Negative

- An anonymous request learns that a deployment exists and what its mark
  looks like. Both were already visible: the hostname answers, and the
  sign-in page names the site.
- Two more files are rendered at every build, and a deployment with a
  mark that is not square is letterboxed in the raster copies.

### Follow-up

- Bump the platform in each deployment and confirm its connector shows the
  icon; a client that cached the missing icon may need the connector added
  again.
