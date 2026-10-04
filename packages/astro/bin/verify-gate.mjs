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

import {
  findProjectRoot,
  markdownProjectionPath,
  PROJECT_LAYOUT,
} from '@ctcstack/ctcdocs-core';

import {
  browseFolder,
  DOCUMENT_PREFIX,
  fetchDocument,
  RECENT_LIMIT,
  recentDocuments,
  searchDocuments,
} from '../dist-node/worker/agents/documents.js';
import { MemoryStore } from '../dist-node/worker/agents/memory-store.js';
import { publishDocuments } from '../dist-node/worker/agents/publish.js';
import { handle, SESSION_COOKIE } from '../dist-node/worker/handler.js';
import { sitePath } from '../dist-node/worker/paths.js';
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

/**
 * Whether a reader in `groups` may open a file of this class, worked out
 * independently of the gate's own code: the file is open to members, or one
 * of its classes names one of the groups.
 */
function groupsMayRead(map, fileClass, groups) {
  return readersOf(map, fileClass).some((cls) => {
    if (cls === 'members' || cls === 'platform') {
      return true;
    }
    const readers = map.classes[cls]?.readers;
    return (
      Array.isArray(readers) && groups.some((group) => readers.includes(group))
    );
  });
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
      new Request(new URL(sitePath(path), environment.origin), { headers }),
      context,
    );

  let requests = 0;
  const files = Object.entries(map.files);
  for (const [path, fileClass] of files) {
    const classes = readersOf(map, fileClass);

    const anonymous = await ask(path);
    assert.equal(
      anonymous.status,
      401,
      `An anonymous reader got ${path} (${anonymous.status}).`,
    );
    requests += 1;

    for (const { name, groups, key } of keys) {
      const allowed = groupsMayRead(map, fileClass, groups);
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
  requests += await verifyAgents({
    map,
    projectRoot,
    distRoot,
    environment,
    keys,
  });
  return { files: files.length, requests };
}

/**
 * The MCP server's tools (ADR-041), against the same build: the documents
 * are published from `dist` as the Worker's schedule would, then every reader
 * asks for every document. An index that returns every object, whole, as a
 * chunk with the class it was published with, stands in for AI Search, so
 * only the gate's own judgment stands between a reader and a document or a
 * passage of it.
 */
async function verifyAgents({ map, projectRoot, distRoot, environment, keys }) {
  if (map.site.mcp !== true || !map.agents) {
    return 0;
  }
  const store = new MemoryStore();
  const everything = () =>
    [...store.objects].map(([key, object]) => ({
      key,
      text: object.text,
      class: object.customMetadata.class,
    }));
  const index = {
    search: async () => everything(),
    sync: async () => {},
  };
  const outcome = await publishDocuments({
    map,
    assets: assetsFrom(distRoot),
    store,
    index,
    origin: environment.origin,
    log: () => {},
  });
  assert.equal(outcome, 'published', 'The build could not be published.');
  assert.equal(
    [...store.objects.keys()].filter((key) => key.startsWith(DOCUMENT_PREFIX))
      .length,
    map.agents.documents.length,
    'Publishing left the bucket without some of the build’s documents.',
  );

  const people = keys.map(({ name, groups }) => ({
    name,
    reader: { kind: 'person', sub: name, groups },
  }));
  if (map.admins[0]) {
    people.push({
      name: 'admin',
      reader: {
        kind: 'person',
        sub: 'admin',
        groups: [map.admins[0]],
      },
    });
  }
  const cutNotes = await lengthNotesAgainst(
    projectRoot,
    map.agents.fetchCharacters,
  );
  let requests = 0;
  for (const { name, reader } of people) {
    const access = {
      map,
      reader,
      stale: false,
      origin: environment.origin,
      store,
      index,
    };
    const results = await searchDocuments(access, 'anything');
    const found = new Set(results.map((result) => result.id));
    requests += 1;
    for (const result of results) {
      assert.ok(
        result.text.length > 0,
        `MCP search showed ${name} ${result.id} without a passage.`,
      );
    }
    // Every folder `browse` names, walked by its labels, and `recent`
    // (ADR-044): each lists only what the person may open.
    const listed = new Set();
    let omitted = false;
    const folders = [[]];
    while (folders.length > 0) {
      const folder = folders.pop();
      const listing = browseFolder(access, folder);
      requests += 1;
      assert.ok(
        listing,
        `MCP browse named ${name} a folder it then would not list.`,
      );
      omitted ||= listing.omitted > 0;
      for (const document of listing.documents) {
        listed.add(document.id);
      }
      for (const inner of listing.folders) {
        assert.ok(
          inner.documents > 0,
          `MCP browse named ${name} a folder with nothing for them.`,
        );
        folders.push(inner.path);
      }
    }
    for (const document of recentDocuments(access, {}, RECENT_LIMIT)) {
      listed.add(document.id);
    }
    requests += 1;
    for (const document of map.agents.documents) {
      const fileClass = map.files[document.markdown];
      const allowed =
        name === 'admin' || groupsMayRead(map, fileClass, reader.groups);
      assert.ok(
        allowed || !listed.has(document.id),
        `MCP browse or recent listed ${name} ${document.markdown} (${fileClass}).`,
      );
      assert.ok(
        !allowed || omitted || listed.has(document.id),
        `MCP browse left out ${document.markdown}, which ${name} may open.`,
      );
      const fetched = await fetchDocument(access, document.id);
      requests += 1;
      assert.equal(
        fetched !== undefined,
        allowed,
        `MCP fetch ${allowed ? 'refused' : 'gave'} ${name} ${document.markdown} (${fileClass}).`,
      );
      if (found.has(document.id)) {
        assert.ok(
          allowed,
          `MCP search showed ${name} ${document.markdown} (${fileClass}).`,
        );
      }
      if (fetched && cutNotes) {
        const note = cutNotes.get(document.markdown);
        const truncated = fetched.metadata.truncated === true;
        assert.ok(
          truncated
            ? note === 'document-over-agent-limit' || note === 'pdf-long'
            : note !== 'document-over-agent-limit',
          truncated
            ? `MCP fetch cut ${document.markdown}, which the content health page does not name.`
            : `The content health page says MCP fetch cuts ${document.markdown}, which it returned whole.`,
        );
      }
    }
  }
  return requests;
}

/**
 * The length notes of the sync report (ADR-043), by Markdown address, when
 * the report measured documents against the cut this build makes; otherwise
 * `undefined`, since a report written before the cut changed, or before
 * documents were measured, describes another cut until the next sync.
 */
async function lengthNotesAgainst(projectRoot, fetchCharacters) {
  let report;
  try {
    report = JSON.parse(
      await readFile(
        resolve(projectRoot, PROJECT_LAYOUT.syncReportFile),
        'utf8',
      ),
    );
  } catch {
    return undefined;
  }
  if (report?.documentLengths?.fetchCharacters !== fetchCharacters) {
    return undefined;
  }
  return new Map(
    report.notes
      .filter(
        (note) =>
          note.slug &&
          (note.note === 'document-over-agent-limit' ||
            note.note === 'pdf-long'),
      )
      .map((note) => [markdownProjectionPath(note.slug), note.note]),
  );
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
