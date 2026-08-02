# ADR-009: Run scheduled synchronization twice daily

- Status: Accepted
- Date: 2026-07-31
- Owners: CTCDocs maintainers
- Supersedes: the 15-minute cadence in implementation specification section 3.5

## Context

Content updates are currently promoted manually when timeliness matters. A
15-minute polling cadence consumes GitHub Actions runner time even when the
Shared Drive corpus is unchanged, while GitHub scheduled workflows do not
guarantee an exact start time.

## Decision

Run the scheduled Knowledge Base sync at 06:17 and 18:17 UTC every day. Retain
the manual `workflow_dispatch` trigger, including the full-export option, for
time-sensitive updates and recovery operations.

The non-round minute reduces exposure to peak scheduler load at the beginning
of an hour. Scheduled execution remains best-effort.

## Consequences

### Positive

- Idle synchronization consumes substantially less runner time.
- The wiki still receives two unattended refresh attempts per day.
- Operators retain immediate manual synchronization.

### Negative

- Without a manual run, a Drive update may wait approximately 12 hours plus
  GitHub scheduling and workflow execution delay.
- The wiki is no longer near-real-time by default.

### Follow-up

- Revisit the cadence if editorial activity or freshness requirements increase.
- Consider an event-driven design only through a separate ADR because it adds
  webhook infrastructure and operational state.
