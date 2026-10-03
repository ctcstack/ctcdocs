/**
 * The denial suite, run against the candidate before it is deployed
 * (ADR-038, ADR-039).
 *
 * It puts the platform's real gate in front of the real build — the access
 * map and the files in `dist` — and asks for every file as different readers:
 * nobody, a key that reads the members class only, a key for each restricted
 * class, and an admin. A file reaches a reader only if its class says so, and
 * every admitted response carries the headers the policy requires. Nothing
 * here needs Google, Cloudflare or a network: the directory snapshot and the
 * keys are made up for the run.
 */
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findProjectRoot, PROJECT_LAYOUT } from '@ctcstack/ctcdocs-core';

import { handle, SESSION_COOKIE } from '../dist-node/worker/handler.js';
import { GoogleKeys } from '../dist-node/worker/oidc.js';
import { randomToken, seal, sealKeys } from '../dist-node/worker/seal.js';

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript'],
  ['.css', 'text/css'],
  ['.json', 'application/json'],
]);

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * A file in `dist` by the path the gate asks for, as the asset store would with
 * `auto-trailing-slash`: `/x/` is `x/index.html`, and `/x` may be `x.html`.
 */
function assetsFrom(distRoot) {
  const read = (file) => readFile(resolve(distRoot, `.${file}`));
  return {
    async fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname);
      if (path.endsWith('.html')) {
        return new Response(null, {
          status: 307,
          headers: { Location: path.replace(/(index)?\.html$/u, '') },
        });
      }
      let file = path.endsWith('/') ? `${path}index.html` : path;
      if (!extname(file)) {
        file = await read(file).then(
          () => file,
          () => `${file}.html`,
        );
      }
      try {
        const body = await read(file);
        return new Response(request.method === 'HEAD' ? null : body, {
          headers: {
            'Content-Type':
              TYPES.get(extname(file)) ?? 'application/octet-stream',
          },
        });
      } catch {
        return new Response('missing', { status: 404 });
      }
    },
  };
}

function readersOf(map, fileClass) {
  return typeof fileClass === 'string' ? [fileClass] : fileClass;
}

export async function verifyGate({ projectRoot, distRoot }) {
  const map = JSON.parse(
    await readFile(resolve(projectRoot, PROJECT_LAYOUT.accessMapFile), 'utf8'),
  );
  const environment = Object.values(map.site.environments).find(
    (candidate) => candidate.visibility === 'private',
  );
  if (!environment) {
    return { files: 0, requests: 0 };
  }
  const now = Date.now();
  const secret = randomToken(48);
  /*
   * A key that reads the members class only, and one per restricted class,
   * issued for a reader group of that class that is not an admin group: a
   * machine key never reads as an admin, so a class only admins read has no
   * key of its own.
   */
  const keys = [{ name: 'members', groups: [], key: `kbk_${randomToken()}` }];
  for (const [id, cls] of Object.entries(map.classes)) {
    const group = Array.isArray(cls.readers)
      ? cls.readers.find((reader) => !map.admins.includes(reader))
      : undefined;
    if (group) {
      keys.push({ name: id, groups: [group], key: `kbk_${randomToken()}` });
    }
  }
  const records = await Promise.all(
    keys.map(async ({ name, groups, key }) => ({
      name,
      owner: 'verify-gate',
      hash: await sha256Hex(key),
      groups,
      expires: new Date(now + 3_600_000).toISOString(),
    })),
  );
  const adminGroup = map.admins[0];
  const snapshot = {
    schemaVersion: 1,
    takenAt: new Date(now).toISOString(),
    users: { 'verify-admin': true },
    groups: adminGroup
      ? { [adminGroup]: { id: 'admin-group', members: ['verify-admin'] } }
      : {},
  };
  const context = {
    map,
    assets: assetsFrom(distRoot),
    snapshot: async () => snapshot,
    machineKeys: async () => records,
    secrets: {
      googleClientId: 'verify-gate.apps.googleusercontent.com',
      googleClientSecret: 'unused',
      sessionSecret: secret,
      previousSessionSecret: undefined,
    },
    fetch: async () => new Response('offline', { status: 503 }),
    now: () => now,
    googleKeys: new GoogleKeys(
      async () => new Response('{}'),
      () => now,
    ),
    log: () => {},
  };
  const adminCookie = `${SESSION_COOKIE}=${await seal(
    await sealKeys('session', secret),
    {
      aud: environment.origin,
      exp: Math.floor(now / 1000) + 3600,
      iat: Math.floor(now / 1000),
      sub: 'verify-admin',
      email: '',
    },
  )}`;

  const ask = (path, headers = {}) =>
    handle(
      new Request(
        new URL(
          path.split('/').map(encodeURIComponent).join('/'),
          environment.origin,
        ),
        { headers },
      ),
      context,
    );

  let requests = 0;
  const files = Object.entries(map.files);
  for (const [path, fileClass] of files) {
    const classes = readersOf(map, fileClass);
    const open = classes.some((cls) => cls === 'members' || cls === 'platform');

    const anonymous = await ask(path);
    assert.equal(
      anonymous.status,
      401,
      `An anonymous reader got ${path} (${anonymous.status}).`,
    );
    requests += 1;

    for (const { name, groups, key } of keys) {
      // Independent of the gate's own code: a key reads a file when the file
      // is open to members, or one of its classes names the key's group.
      const allowed =
        open ||
        classes.some((cls) => {
          const readers = map.classes[cls]?.readers;
          return (
            Array.isArray(readers) &&
            groups.some((group) => readers.includes(group))
          );
        });
      const response = await ask(path, { Authorization: `Bearer ${key}` });
      requests += 1;
      assert.equal(
        response.status,
        allowed ? 200 : 403,
        `A key for ${name} got ${response.status} for ${path} (${classes.join(', ')}).`,
      );
      if (allowed) {
        assert.match(
          response.headers.get('Cache-Control') ?? '',
          /private|immutable/u,
          `${path} was served without a private or immutable cache policy.`,
        );
        if (
          (response.headers.get('Content-Type') ?? '').startsWith('text/html')
        ) {
          assert.ok(
            response.headers.get('Content-Security-Policy'),
            `${path} was served without a Content Security Policy.`,
          );
        }
        if (path.endsWith('.md')) {
          assert.equal(
            response.headers.get('Content-Type'),
            'text/markdown; charset=utf-8',
          );
        }
      }
    }

    if (adminGroup) {
      const admin = await ask(path, { Cookie: adminCookie });
      requests += 1;
      assert.equal(
        admin.status,
        200,
        `An admin got ${admin.status} for ${path}.`,
      );
    }
  }

  const page = await ask('/', { 'Sec-Fetch-Mode': 'navigate' });
  assert.equal(page.status, 302);
  assert.match(page.headers.get('Location') ?? '', /^\/auth\/sign-in\?/u);
  for (const { name, key } of keys) {
    const auth = { Authorization: `Bearer ${key}` };
    // The route lists bundles beyond the members one; a class whose pages
    // have no search region has no bundle to list.
    if (name !== 'members' && map.bundles[name]) {
      const { bundles } = await (await ask('/_kb/classes', auth)).json();
      assert.ok(
        bundles.includes(map.bundles[name]),
        `The classes route did not list ${name}'s search bundle.`,
      );
    }
    assert.equal(
      (await ask('/_kb/status', auth)).status,
      403,
      `A key for ${name} read the directory status.`,
    );
    const missing = await ask('/no-such-page-for-the-denial-suite/', auth);
    assert.equal(missing.status, 404);
    assert.match(
      missing.headers.get('Content-Type') ?? '',
      /^text\/html/u,
      'A missing page was answered without the 404 page.',
    );
    requests += 3;
  }
  return { files: files.length, requests };
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const projectRoot = findProjectRoot();
  const result = await verifyGate({
    projectRoot,
    distRoot: resolve(projectRoot, 'dist'),
  });
  console.log(
    result.files === 0
      ? 'No private environment: nothing for the gate to refuse.'
      : `Gate verified: ${result.files} files, ${result.requests} requests.`,
  );
}
