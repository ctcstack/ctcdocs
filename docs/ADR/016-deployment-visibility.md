# ADR-016: Who may read a deployment is configuration, not an assumption

- Status: Accepted
- Date: 2026-08-02
- Owners: CTCDocs maintainers
- Supersedes: none
- Amends: [ADR-004](004-cloudflare-access.md)

## Context

The platform was extracted from an internal wiki, and it carried that wiki's
audience with it as an assumption rather than a setting. Every deployment was
taken to be private: `ctcdocs-sync validate` required `robots.txt` to refuse all
crawlers and `_headers` to mark the Markdown projection and the original images
as privately cached and unindexable, the preset put `noindex, nofollow,
noarchive` on every page, and the smoke test refused to publish unless anonymous
requests were denied.

None of that is wrong for an internal wiki. All of it is wrong for a public
documentation portal, which is a thing the same platform should be able to
publish — and a project that wants one would have had to fight the checks rather
than configure them.

There is a second, less obvious cost. A check that only knows how to assert
"closed" cannot notice that a portal meant to be open has become unreachable. An
Access application attached to the wrong hostname would fail a public deployment
silently, in the direction the checks never look.

## Decision

Each deployment environment declares who may read it:

```json
"deployment": {
  "workerName": "example-docs",
  "environments": {
    "production": { "url": "https://docs.example.com", "visibility": "public" },
    "staging": { "url": "https://staging.example.com", "visibility": "private" }
  }
}
```

`visibility` is `"private"` or `"public"` and defaults to `"private"`. The
default is not neutral on purpose: a deployment that is private when it meant to
be public is an inconvenience, and one that is public when it meant to be
private is a disclosure. An omission should fail in the recoverable direction.

The checks follow the setting rather than disappearing under it:

| Check                                           | `private`                                | `public`                              |
| ----------------------------------------------- | ---------------------------------------- | ------------------------------------- |
| `robots.txt`                                    | must disallow every crawler              | must not disallow every crawler       |
| `_headers` on `/*.md` and `/assets/generated/*` | private caching and `X-Robots-Tag`       | must not carry `noindex`              |
| page `<meta name="robots">`                     | `noindex, nofollow, noarchive`           | absent                                |
| access smoke                                    | anonymous denied, service token admitted | anonymous admitted, no token required |
| browser access suite                            | denial and token session                 | open access and no robots meta        |

Two scoping rules make this unambiguous:

- **The built artifact follows the production environment.** `robots.txt`, the
  response headers and the meta tag live in one build that is deployed to every
  environment, so they take the posture of the environment an unauthenticated
  reader can reach.
- **A probe follows the environment it is aimed at**, matched by hostname. An
  address the configuration does not know is treated as private, because the
  stricter reading of an unknown target is the safe one.

What does not change with visibility: `workers.dev` and preview URLs stay
disabled, an environment still binds exactly one custom domain, and the Wrangler
configuration is still checked against the project configuration. Those are
about a deployment having one predictable address, which a public portal wants
as much as a private wiki does.

## Consequences

### Positive

- The platform can publish a public documentation portal without a project
  fighting its own gate.
- A public deployment gains a check it never had: that it is actually readable.
  The failure mode of an over-applied Access policy is now caught before it
  confuses readers.
- The audience of a deployment is written down in the place a reader of the
  repository looks first, instead of being implied by four separate files
  agreeing with each other.

### Negative

- One more setting whose two values must both be exercised. Unit tests cover
  both postures in validation and in the smoke test; the fixture project
  exercises the private one end to end, so the public path is proven by tests
  rather than by a running site.
- A project that mixes postures across environments builds one artifact for all
  of them. The rules above make that explicit rather than surprising, but a
  private staging host of a public portal will carry no `noindex` — which is
  harmless, because Access refuses crawlers there anyway.

### Follow-up

- `docs/CONFIGURATION.md` documents the setting and what each posture requires
  of `robots.txt` and `_headers`.
- ADR-004 remains the record of how Cloudflare Access is used by a private
  deployment; it is no longer the record of what every deployment must be.
