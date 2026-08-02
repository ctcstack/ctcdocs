import { describe, expect, it } from 'vitest';

import {
  createFailureNotification,
  notifySyncFailure,
  selectFailureStage,
} from './notify-failure.js';

const baseEnvironment = {
  GITHUB_REPOSITORY: 'example-org/example-docs',
  GITHUB_RUN_ID: '12345',
  GITHUB_SERVER_URL: 'https://github.com',
};

describe('sync failure notification', () => {
  it('reports the first stage that failed', () => {
    expect(
      selectFailureStage({
        SYNC_STAGE_CONFIGURATION: 'success',
        SYNC_STAGE_AUTHENTICATION: 'success',
        SYNC_STAGE_SYNC: 'failure',
        SYNC_STAGE_BUILD: 'skipped',
      }),
    ).toBe('sync');
    expect(selectFailureStage({})).toBe('workflow');
  });

  it('carries only aggregate operational data', () => {
    expect(createFailureNotification(baseEnvironment)).toEqual({
      text: 'Documentation sync failed',
      run: 'https://github.com/example-org/example-docs/actions/runs/12345',
      stage: 'workflow',
      errors: 1,
    });
  });

  it.each([
    ['GITHUB_REPOSITORY', { GITHUB_REPOSITORY: 'not-a-repository' }],
    ['GITHUB_RUN_ID', { GITHUB_RUN_ID: 'latest' }],
  ])('refuses to build a run link from an invalid %s', (_name, override) => {
    expect(() =>
      createFailureNotification({ ...baseEnvironment, ...override }),
    ).toThrow();
  });

  it('skips an unconfigured webhook rather than failing the run', async () => {
    await expect(notifySyncFailure(baseEnvironment)).resolves.toBe(false);
  });

  it('rejects a webhook that is not HTTPS', async () => {
    await expect(
      notifySyncFailure({
        ...baseEnvironment,
        SYNC_FAILURE_WEBHOOK_URL: 'http://hooks.example.test/token',
      }),
    ).rejects.toThrow(/HTTPS/u);
  });

  it('posts JSON to the configured webhook', async () => {
    let request: { url: string; body: unknown } | undefined;
    const sent = await notifySyncFailure(
      {
        ...baseEnvironment,
        SYNC_FAILURE_WEBHOOK_URL:
          'https://hooks.example.test/private-token?secret=value',
        SYNC_STAGE_BUILD: 'failure',
      },
      async (url, init) => {
        request = {
          url: url.toString(),
          body: JSON.parse(String(init?.body)),
        };
        return new Response(null, { status: 204 });
      },
    );

    expect(sent).toBe(true);
    expect(request?.url).toBe(
      'https://hooks.example.test/private-token?secret=value',
    );
    expect(request?.body).toEqual({
      text: 'Documentation sync failed',
      run: 'https://github.com/example-org/example-docs/actions/runs/12345',
      stage: 'build',
      errors: 1,
    });
  });
});
