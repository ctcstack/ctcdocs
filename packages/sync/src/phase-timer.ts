/**
 * How long each phase of a sync run took (ADR-053). The times are for the
 * run's own output and log only: nothing generated carries them, so an
 * unchanged corpus still produces identical bytes.
 */

const SYNC_PHASES = [
  'inventory',
  'plan',
  'export',
  'assemble',
  'validate',
  'write',
] as const;

export type SyncPhase = (typeof SYNC_PHASES)[number];

export interface SyncTimings {
  /** Every phase, in run order, whether or not the run spent time in it. */
  phases: Array<{ phase: SyncPhase; milliseconds: number }>;
  /** How many times the run planned the corpus: one more per new hold. */
  passes: number;
}

export class PhaseTimer {
  private readonly totals = new Map<SyncPhase, number>();
  private passCount = 0;

  constructor(private readonly clock: () => number) {}

  now(): number {
    return this.clock();
  }

  startPass(): void {
    this.passCount += 1;
  }

  add(phase: SyncPhase, milliseconds: number): void {
    this.totals.set(
      phase,
      (this.totals.get(phase) ?? 0) + Math.max(0, milliseconds),
    );
  }

  since(phase: SyncPhase, start: number): void {
    this.add(phase, this.clock() - start);
  }

  total(phase: SyncPhase): number {
    return this.totals.get(phase) ?? 0;
  }

  async time<T>(phase: SyncPhase, work: () => Promise<T>): Promise<T> {
    const start = this.clock();
    try {
      return await work();
    } finally {
      this.since(phase, start);
    }
  }

  result(): SyncTimings {
    return {
      phases: SYNC_PHASES.map((phase) => ({
        phase,
        milliseconds: Math.round(this.total(phase)),
      })),
      passes: this.passCount,
    };
  }
}

/** One log line: `inventory 1.2 s, plan 0.3 s, … (2 passes)`. */
export function formatTimings(timings: SyncTimings): string {
  const phases = timings.phases
    .map(
      ({ phase, milliseconds }) =>
        `${phase} ${(milliseconds / 1000).toFixed(1)} s`,
    )
    .join(', ');
  return `${phases} (${timings.passes} ${timings.passes === 1 ? 'pass' : 'passes'})`;
}
