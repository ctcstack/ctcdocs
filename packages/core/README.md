# @ctcstack/ctcdocs-core

The configuration layer shared by the [CTCDocs](https://github.com/ctcstack/ctcdocs)
packages: the schema of a project's `site.config.json`, the fixed project
layout, and the allowlist of paths the synchronization pipeline may write.

A project does not install this package directly — `@ctcstack/ctcdocs` and
`@ctcstack/ctcdocs-sync` depend on it. It is documented because what it
validates is what a project writes down.

```ts
import {
  findProjectRoot,
  loadSiteConfiguration,
  PROJECT_LAYOUT,
} from '@ctcstack/ctcdocs-core';

const site = loadSiteConfiguration(findProjectRoot());
```

Two properties are worth knowing about:

- **The configuration is validated, not trusted.** A hostname that is not a
  bare HTTPS origin, two environments sharing one hostname, an ownership marker
  that would close its own HTML comment — each fails at load rather than
  reaching a deployment.
- **The project layout is a fixed convention, and the generated-path allowlist
  is a compile-time constant.** It is a security control: an allowlist a
  project can widen is an allowlist an attacker can widen.

## Documentation

[Configuration reference](https://github.com/ctcstack/ctcdocs/blob/main/docs/CONFIGURATION.md)
· [Architecture decisions](https://github.com/ctcstack/ctcdocs/tree/main/docs/ADR)

All three CTCDocs packages share a version and are released together.
What changed is in the
[changelog](https://github.com/ctcstack/ctcdocs/blob/main/CHANGELOG.md).

Apache-2.0. Internal in practice: `@ctcstack/ctcdocs` and
`@ctcstack/ctcdocs-sync` are what a project installs.
