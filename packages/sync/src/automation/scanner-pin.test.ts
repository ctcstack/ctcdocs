import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/*
 * The sync's secret scan exists so that a sync commit cannot fail the project's
 * CI gate later. That holds only while both run the same gitleaks release,
 * whose rules change between versions.
 */
const workflowsDirectory = new URL(
  '../../../../.github/workflows/',
  import.meta.url,
);

interface WorkflowStep {
  env?: Record<string, unknown>;
}

async function gitleaksPins(file: string) {
  const workflow = parse(
    await readFile(new URL(file, workflowsDirectory), 'utf8'),
  ) as { jobs: Record<string, { steps?: WorkflowStep[] }> };

  return Object.values(workflow.jobs)
    .flatMap((job) => job.steps ?? [])
    .filter((step) => step.env?.GITLEAKS_VERSION !== undefined)
    .map((step) => ({
      version: step.env?.GITLEAKS_VERSION,
      sha256: step.env?.GITLEAKS_SHA256,
    }));
}

describe('the secret scanner the sync installs', () => {
  it('is the release and checksum the project CI gate installs', async () => {
    const sync = await gitleaksPins('project-sync.yml');
    const gate = await gitleaksPins('project-ci.yml');

    expect(sync).toHaveLength(1);
    expect(sync).toEqual(gate);
  });
});
