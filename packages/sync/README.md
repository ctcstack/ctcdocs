# @ctcstack/ctcdocs-sync

The synchronization pipeline of
[CTCDocs](https://github.com/ctcstack/ctcdocs): Google Drive → Markdown, and
the `ctcdocs-sync` command line a project's workflows run.

It exports the Google Docs of a managed Shared Drive folder, converts them to
standard Markdown with their images, allocates stable slugs that survive a
rename, and writes the result atomically into the paths a CTCDocs project owns.
A run twice over unchanged input produces no diff.

## Install

```bash
pnpm add @ctcstack/ctcdocs-sync
```

## Commands

```bash
ctcdocs-sync sync [--dry-run] [--full] [--file <id>] [--reseed-slug <id>] [--json]
ctcdocs-sync validate
ctcdocs-sync validate:generated-diff
ctcdocs-sync write:sync-summary
ctcdocs-sync notify:failure
ctcdocs-sync generated-paths
```

Every command runs inside the project it acts on: the working directory is
walked upwards for `site.config.json`, and everything else — hostnames, the
ownership marker stamped into generated files, who may read the deployment — is
read from there.

`validate` is the one a project runs in CI: it checks the Wrangler
configuration against the project configuration, the crawler rules and response
headers against the declared visibility, that the secret scanner's path
exemptions are untracked, and that every generated file carries its ownership
marker. A project that has never synchronized passes it and says so.

## What it will not do

The Google identity is read-only. The pipeline exports; it never creates,
edits, moves, deletes, or changes permissions on anything in a Drive. Generated
output is written atomically and only inside a compile-time allowlist of paths,
so a failed run leaves the last known-good output untouched.

## Documentation

[Configuration reference](https://github.com/ctcstack/ctcdocs/blob/main/docs/CONFIGURATION.md)
· [Google Workspace setup](https://github.com/ctcstack/ctcdocs/blob/main/docs/GOOGLE_WORKSPACE_SETUP.md)
· [Security policy](https://github.com/ctcstack/ctcdocs/blob/main/SECURITY.md)

The site half of CTCDocs is `@ctcstack/ctcdocs`: it turns the corpus this
produces into the deployed documentation site.

All three CTCDocs packages share a version and are released together.
What changed is in the
[changelog](https://github.com/ctcstack/ctcdocs/blob/main/CHANGELOG.md).

Apache-2.0.
