---
name: adr
description: Create or supersede an Architecture Decision Record in docs/ADR. Use when a change alters the manifest schema, authentication strategy, hosting topology, converter architecture, or deviates from the approved implementation specification — and whenever the user asks for an ADR.
---

# Architecture Decision Record

## When an ADR is required

`AGENTS.md` and `docs/ADR/README.md` require an ADR for:

- any deviation from sections 3–5 of the implementation specification,
- manifest schema changes,
- authentication strategy changes,
- hosting topology changes,
- converter architecture changes,
- any scope expansion beyond the approved MVP.

If the change is none of these, say so and do not create a record.

## Procedure

1. Read `docs/ADR/README.md` and the most recent existing ADR to match tone,
   length, and structure.
2. Determine the next number: `ls docs/ADR` and take the highest numeric prefix
   plus one. Numbers are zero-padded to three digits and never reused.
3. Copy `docs/ADR/000-template.md` to
   `docs/ADR/<NNN>-<kebab-case-title>.md`.
4. Fill in the record:
   - `Status: Proposed` unless the user states the decision is already accepted.
   - `Date`: today's date in `YYYY-MM-DD`.
   - `Owners`: `CTCStack` unless the user names someone.
   - `Supersedes`: `none`, or `ADR-XXX` when it replaces a prior decision.
   - `Context` states the problem and constraints, not the discussion history.
   - `Decision` states what was chosen, in the present tense.
   - `Consequences` lists positive, negative, and follow-up items honestly —
     a record with no negative consequence is incomplete.
5. Append a one-line entry to the `Current records` list in
   `docs/ADR/README.md`, in numeric order.
6. When the new record supersedes an existing one, set the old record's status
   to `Superseded` and add `Superseded by: ADR-<NNN>`. Never rewrite the body of
   an accepted ADR.
7. Cross-link from the affected documentation (`README.md`, `docs/OPERATIONS.md`,
   `docs/DEPLOYMENT.md`, the relevant phase document) when the behavior it
   describes changed.

## Constraints

- English only, wrapped at the width used by the surrounding documents.
- One ADR covers exactly one decision.
- Do not record credentials, hostnames of protected environments, internal
  document titles, or Google file identifiers.
- Verify formatting afterwards:

```bash
pnpm format:check
```
