import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/*
 * Chromium for the browser suite is installed by one script, copied into the
 * platform's own workflows and into the reusable ones every project calls. It
 * is copied rather than shared because a reusable workflow runs in the calling
 * repository and cannot read a file of this one, so a fix made to one copy has
 * to reach the others. The copies differ only in where Playwright runs from:
 * the platform's fixture project, or a project's root.
 */
const workflowsDirectory = new URL(
  '../../../../.github/workflows/',
  import.meta.url,
);

const fromFixtureProject =
  'pnpm --filter ctcdocs-fixture-project exec playwright';
const fromProject = 'pnpm exec playwright';

const workflows = [
  'ci.yml',
  'release.yml',
  'project-ci.yml',
  'project-deploy.yml',
] as const;

interface WorkflowStep {
  run?: string;
}

async function chromiumInstalls(file: string): Promise<string[]> {
  const workflow = parse(
    await readFile(new URL(file, workflowsDirectory), 'utf8'),
  ) as { jobs: Record<string, { steps?: WorkflowStep[] }> };

  return Object.values(workflow.jobs)
    .flatMap((job) => job.steps ?? [])
    .flatMap((step) =>
      step.run?.includes('playwright install') ? [step.run] : [],
    );
}

describe('the Chromium install for the browser suite', () => {
  it('is one step in each workflow that runs the suite', async () => {
    for (const file of workflows) {
      expect(await chromiumInstalls(file), file).toHaveLength(1);
    }
  });

  it('runs the same script in every workflow', async () => {
    const scripts = await Promise.all(
      workflows.map(async (file) =>
        (await chromiumInstalls(file))
          .join('\n')
          .replaceAll(fromFixtureProject, fromProject),
      ),
    );

    expect(new Set(scripts).size).toBe(1);
  });

  it('installs only the headless shell, and its system libraries only when missing', async () => {
    const [script] = await chromiumInstalls('project-ci.yml');

    expect(script).toContain(`${fromProject} install --only-shell chromium`);
    expect(script).not.toContain('--with-deps');
    expect(script).toContain(`${fromProject} install-deps chromium`);
  });
});
