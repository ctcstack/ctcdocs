/**
 * The optional "the sync failed" ping.
 *
 * It carries no document content and no identifiers: which stage failed and a
 * link to the run, so an operator knows where to look without the notification
 * itself becoming a place internal content leaks to.
 */
const TIMEOUT_MS = 10_000;
const STAGE_VARIABLES = [
    ['configuration', 'SYNC_STAGE_CONFIGURATION'],
    ['authentication', 'SYNC_STAGE_AUTHENTICATION'],
    ['sync', 'SYNC_STAGE_SYNC'],
    ['generated-validation', 'SYNC_STAGE_VALIDATION'],
    ['build', 'SYNC_STAGE_BUILD'],
    ['final-generated-validation', 'SYNC_STAGE_FINAL_VALIDATION'],
    ['commit', 'SYNC_STAGE_COMMIT'],
    ['push', 'SYNC_STAGE_PUSH'],
];
export function selectFailureStage(environment) {
    return (STAGE_VARIABLES.find(([, variable]) => environment[variable] === 'failure')?.[0] ?? 'workflow');
}
export function createFailureNotification(environment) {
    const serverUrl = environment.GITHUB_SERVER_URL ?? 'https://github.com';
    const repository = environment.GITHUB_REPOSITORY;
    const runId = environment.GITHUB_RUN_ID;
    if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
        throw new Error('GITHUB_REPOSITORY is invalid.');
    }
    if (!runId || !/^\d+$/u.test(runId)) {
        throw new Error('GITHUB_RUN_ID is invalid.');
    }
    return {
        text: 'Documentation sync failed',
        run: `${serverUrl}/${repository}/actions/runs/${runId}`,
        stage: selectFailureStage(environment),
        errors: 1,
    };
}
export async function notifySyncFailure(environment, fetchImplementation = fetch) {
    const webhook = environment.SYNC_FAILURE_WEBHOOK_URL?.trim();
    if (!webhook) {
        console.log('Sync failure webhook is not configured; notification skipped.');
        return false;
    }
    const webhookUrl = new URL(webhook);
    if (webhookUrl.protocol !== 'https:') {
        throw new Error('SYNC_FAILURE_WEBHOOK_URL must use HTTPS.');
    }
    const response = await fetchImplementation(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createFailureNotification(environment)),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`Failure webhook returned HTTP ${response.status}.`);
    }
    console.log('Sync failure notification sent.');
    return true;
}
