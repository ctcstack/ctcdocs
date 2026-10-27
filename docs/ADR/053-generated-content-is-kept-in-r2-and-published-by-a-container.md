# ADR-053: Generated content is kept in R2 and published by a container

- Status: Proposed
- Date: 2026-10-27
- Owners: CTCStack
- Supersedes, once accepted:
  - ADR-002 in full;
  - ADR-009 in full;
  - ADR-003 in part: the orchestration in GitHub Actions and the state kept
    in Git. Inventory reconciliation stays.

## Context

**The sync commits generated content to the project repository** (ADR-002).
That is Markdown, assets, the manifest, the sidebar, redirects and reports.
A scheduled GitHub Actions run syncs, runs the project gate, builds and
deploys (ADR-003, ADR-009). Three problems follow from it.

**The repository is a copy outside the access boundary.**

- ADR-039 records that the repository and its history are a complete copy
  of every folder.
- A GitHub repository has no read control by path. Once a folder is
  restricted to a group, every reader of the repository, and every app
  installed on it, reads that folder.
- Git history keeps a document after it leaves Drive. GitHub's own guidance
  says that rewriting history does not fully remove data from cached views,
  pull request refs and forks.
- A deployment run for another company would hold that company's content in
  a GitHub repository, outside both its Google permissions and its
  Cloudflare account.

**Edits are slow to arrive.** One deployment measured its edits from
2026-09-14 to 2026-10-26: an edit reached the site after 5.3 hours at the
median and 25 hours at the 95th percentile. Two things cause it:

- GitHub's scheduler started runs 3.5 to 7.5 hours late, and dropped some.
- A run took about 13 minutes, even for one changed document. It ran the
  full project gate, including the browser suite, and then built the site
  a second time to deploy it.

**The gate mixes two kinds of check.**

- **Formatting, lint, types, unit tests and the browser suite** depend on
  code. They can find nothing new between two syncs, because the code has
  not changed.
- **The allowlist, the secret scan, the denial suite and Pagefind's
  exclusions** depend on content. A new document can break access without
  any change to code.

**Constraints:**

- **The manifest holds state Drive cannot give back:**
  - rename redirects;
  - stable addresses and short IDs (ADR-005, ADR-021, ADR-022);
  - the readers history that keeps a Drive move from widening readers
    (ADR-039).

  It is security state, and it must survive.

- **A document that fails to convert keeps its previous version** (ADR-026),
  so the last output must survive too.
- **The sync works on a working tree** and writes through one atomic writer.
- **Every Google identity stays read-only.**

## Decision

### The store

**Generated content is kept in an R2 bucket of the project's own, not in
Git.** The bucket is separate from the bucket AI Search indexes (ADR-042).
It holds:

- **one archive** of every allowlisted generated path, as zstd-compressed
  tar;
- **the previous archive,** as a safeguard against a publish that writes a
  bad state;
- **the manifest** as a separate object, which the probe reads;
- **`current.json`,** which names the current and previous archives, the
  platform version, the project's code version and the time.

**How a publish writes:**

1. It uploads its archive under a new name.
2. It switches `current.json` with one conditional write.
3. It deletes any archive the pointer no longer names.

A publish cut short therefore changes nothing.

**There is no history beyond the previous archive.** What a publish changed
is computed from the old and new manifests, and is built into content
health.

**Two commands go with it:**

- `content pull` unpacks the current archive for local development, with
  the developer's own Cloudflare login;
- `content erase` removes a document from both archives at once.

**The Git store exists only to migrate a deployment,** and is removed in the
next minor release.

### The publisher

**Each deployment gets a second Worker, the publisher.**

- It has no public routes.
- It holds the synchronization identity's service-account key, and a deploy
  token whose role is _Editor_ on the site and directory Workers only.
- Its cron starts a Cloudflare Container. It runs every 30 minutes by
  default; `sync.probeMinutes` sets the interval.
- The container uses the default scheduling policy and one image. The
  project's CI builds that image on a merge to `main`, with the platform,
  the project and their dependencies installed.
- The container reaches the bucket through the publisher's binding, as
  plain HTTP to an outbound handler. The image holds no R2 credential.

**The container does, in order:**

1. **Probe.** The sync's own inventory, run dry and compared with the
   manifest. It exits when nothing changed and the code version matches the
   pointer's.
2. **Pull** the current archive.
3. **Sync.**
4. **Build,** once.
5. **Run the content gate:**
   - the allowlist and the secret scan of the changed paths;
   - validation of the generated output;
   - the denial suite;
   - Pagefind's exclusions.
6. **Deploy** the directory Worker, then the site, so the site is never
   ahead of the groups it names.
7. **Check after deploying:** the access smoke test.
8. **Write** the state.
9. **Refresh assistants.** Ask the site Worker, through a service binding,
   to publish its documents to AI Search at once.

**Running and failing:**

- **One publish runs at a time.** A tick during a publish is skipped.
- **A new image publishes on the next tick,** because its code version
  differs from the pointer's. CI calls nothing.
- **A failed publish leaves the site and the state as they were.**
- **After three failures in a row,** the publisher sends the existing
  failure alert, and tries hourly until a publish succeeds.

**"Sync now".** An admin route on the site Worker reaches the publisher
through a service binding, at most once a minute.

**The weekly layout report.** Once a week the publisher runs the browser
suite against a build of the real content. The image carries Chromium for
it, and the result goes to content health.

**The fallback.** A manual GitHub Actions workflow runs the same image with
`docker run`.

- It reads Drive with the keyless federated login, as today.
- It deploys with the protected environment's token.
- It reaches the bucket with an S3 token scoped to that bucket.
- A flag in KV pauses the publisher while it runs.

### The checks

**Code checks run only in CI:**

- formatting, lint, types and unit tests;
- the fixture project's build, denial suite, search and browser suites;
- dry runs, audits and workflow scanning.

**When CI runs:**

- on every push to a pull request that is not a draft, cancelling the
  previous run;
- once on a merge to `main`, before the image is built.

**The content gate runs on every publish,** whether code or content changed.

### The sync

- **It records how long each phase takes.**
- **It writes an unpublished file to the manifest with its modification
  time.** It retries the file only when that changes. Today such files are
  exported again on every run.
- **It exports eight documents at a time.**
- **No `astro check` in the publish.**
- **Astro's image cache is kept in the bucket** as an object that is safe to
  lose.

### Freshness and its measure

**Freshness is for admins only.**

- **What the publisher writes:** the time of its last successful check, to
  the site Worker's KV.
- **What content health shows:**
  - the last and the next check, marked once three checks are missed;
  - "Sync now";
  - the latest publish's changes;
  - the weekly report.
- **Readers and assistants see nothing new.**

**The lag is measured at every publish.**

- **One row per changed document** goes to the D1 database (ADR-050). It
  holds the short ID, the time of the last edit in Drive, the end of the
  deploy, and the time AI Search finished. It holds no text and no reader.
- **The weekly report shows:**
  - the median and the 95th percentile of both lags;
  - probes, publishes and failures;
  - the container's running time;
  - the sync's slowest phases.

### The invariants this changes

Two lines of `AGENTS.md` change on acceptance.

- **"Technical source of truth"** becomes the generated Markdown, assets,
  manifest, sidebar and index kept in the project's R2 bucket.
- **"The synchronization identity reads one Drive and has no key"**
  becomes: it reads one Drive. Its key lives only in the publisher's
  secret, and the fallback reads Drive without one.

The rule that keeps credentials away from pull-request triggers is
unchanged: CI holds none, and the fallback runs only by hand.

The site Worker's gate stays web-standard. The publisher is
Cloudflare-specific throughout. Its work, though, is a container image that
any host can run.

## Consequences

### Positive

- **The content leaves GitHub.** That covers its history once a deployment
  moves to a repository without it, and the apps and clones that read the
  repository.
- **A removed document is gone from the store.** The next publish drops it,
  and `erase` drops it at once.
- **Only the publisher can read or write the store.** Developers pull
  deliberately, under their own login.
- **Edits arrive faster.** An edit reaches the site within one probe
  interval and a publish. The targets: a probe with no change under 20
  seconds, one document under 3 minutes, a full re-export under 5 minutes.
- **One pipeline for code and content.** It builds once, and checks code
  once.
- **GitHub's scheduler and runners leave the content path.**

### Negative

- **The synchronization identity has a key at rest,** in Cloudflare. A
  leaked key reads the whole Shared Drive, including folders the project
  ignores.
- **The platform owns a store module, an image and a second Worker,** and
  each deployment builds the image in its CI.
- **The publisher depends on Cloudflare Containers,** on the Workers Paid
  plan.
- **Git's diff, log and blame no longer cover content.** The publish report
  replaces them.
- **Local development needs `content pull` first.**
- **A deployment's CI no longer meets the real corpus.** Only the content
  gate does, at publish.
- **A page whose content breaks the layout reaches readers first.** The
  weekly report finds it within a week.
- **Old Worker versions keep erased content.** Cloudflare keeps a Worker's
  last 100 versions with their static assets, and no way to delete one is
  documented.
- **Cold starts grow with the image,** which carries Node, the dependencies
  and Chromium.

### Follow-up

- **A prototype measures four things:**
  - the image's cold start;
  - the speed targets;
  - where the sync's fixed cost of about 160 seconds goes;
  - whether an _Editor_ token limited to two Workers can deploy static
    assets.
- **A deployment's migration:**
  1. both pipelines run in parallel, compared byte for byte;
  2. then the deployment moves to a repository without the content history;
  3. then the old repository is deleted.
- **Find a way to delete Worker versions,** with Cloudflare if needed,
  before erasure is promised outside a deployment's team.
- **Drive push notifications** as the primary trigger, with the probe as the
  backstop. They need an ADR of their own, as ADR-009 asked of any
  event-driven design.
- **Measure the container's cost** and revisit the probe interval after a
  month.
- **On acceptance:**
  - mark ADR-002 and ADR-009 as superseded, and ADR-003 in part;
  - update `AGENTS.md`, `README.md`, `docs/DEPLOYMENT.md`,
    `docs/OPERATIONS.md`, `docs/NEW_PROJECT.md`, `docs/CONFIGURATION.md`
    and `docs/LOCAL_DEVELOPMENT.md`.
