import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { parsePreviewArguments } from './preview.mjs';

test('host and port are passed to the server as given', () => {
  assert.deepEqual(
    parsePreviewArguments(['--host', '127.0.0.1', '--port', '4323']),
    { server: { host: '127.0.0.1', port: 4323 } },
  );
  assert.deepEqual(parsePreviewArguments(['--port=4323']), {
    server: { port: 4323 },
  });
  assert.deepEqual(parsePreviewArguments([]), { server: {} });
});

test('a port that is not a whole number in range is refused', () => {
  for (const port of ['0', '65536', '43.5', '4323abc', ' 4323', '0x10E3', '']) {
    assert.throws(
      () => parsePreviewArguments(['--port', port]),
      /--port takes a port number/u,
      port,
    );
  }
});

test('an unknown flag or a stray argument is refused', () => {
  assert.throws(() => parsePreviewArguments(['--background']), /Usage:/u);
  assert.throws(() => parsePreviewArguments(['stop']), /Usage:/u);
  assert.throws(() => parsePreviewArguments(['--host']), /Usage:/u);
  assert.throws(() => parsePreviewArguments(['--host', '']), /Usage:/u);
});

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('stays the serving process when an AI agent runs it', async (t) => {
  /*
   * `astro preview` backgrounds itself when it detects an agent, which
   * `CLAUDECODE` is enough for. The browser suite's web server has to be the
   * process that serves, or the runner sees it exit and the detached server
   * outlives the run, so this runs the bin the way a project would, under an
   * agent, and requires the process it started to be the one answering.
   */
  const root = await mkdtemp(join(tmpdir(), 'ctcdocs-preview-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(join(root, 'dist'));
  await writeFile(
    join(root, 'dist', 'index.html'),
    '<!doctype html><title>Synthetic</title><p>Synthetic page</p>',
  );
  const link = join(root, 'ctcdocs-preview');
  await symlink(fileURLToPath(new URL('./preview.mjs', import.meta.url)), link);

  const port = await freePort();
  const environment = {
    ...process.env,
    ASTRO_TELEMETRY_DISABLED: '1',
    CLAUDECODE: '1',
  };
  delete environment.ASTRO_PREVIEW_BACKGROUND;
  const child = spawn(
    process.execPath,
    [link, '--host', '127.0.0.1', '--port', String(port)],
    { cwd: root, env: environment, stdio: 'ignore' },
  );
  const exited = new Promise((resolve) => child.once('exit', resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await exited;
    }
  });

  let body;
  const deadline = Date.now() + 30_000;
  while (body === undefined && Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'the preview process exited');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) {
        body = await response.text();
      }
    } catch {
      // Not listening yet.
    }
    if (body === undefined) {
      await sleep(100);
    }
  }
  assert.match(body ?? '', /Synthetic page/u);
  assert.equal(child.exitCode, null, 'the preview process exited');
  assert.equal(existsSync(join(root, '.astro', 'preview.json')), false);

  child.kill('SIGTERM');
  await exited;
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
});
