import { describe, expect, it } from 'vitest';

import type { AccessMapFile } from '../access-map.js';
import { publishDocuments, PUBLISHED_KEY } from './publish.js';
import { MemoryStore } from './memory-store.js';
import {
  agentMap,
  FixedIndex,
  ORIGIN,
  publishedStore,
} from './test-support.js';

function state(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial));
  return {
    values,
    get: async (key: string) => values.get(key),
    put: async (key: string, value: string) => {
      values.set(key, JSON.parse(value));
    },
  };
}

function setup({
  map = agentMap,
  store = new MemoryStore(),
  marker,
  missing = [] as string[],
}: {
  map?: AccessMapFile;
  store?: MemoryStore;
  marker?: unknown;
  missing?: string[];
} = {}) {
  const fetched: string[] = [];
  const index = new FixedIndex([]);
  const kept = state(marker === undefined ? {} : { [PUBLISHED_KEY]: marker });
  const events: unknown[] = [];
  return {
    store,
    index,
    state: kept,
    fetched,
    events,
    run: () =>
      publishDocuments({
        map,
        assets: {
          fetch: async (request: Request) => {
            const path = decodeURIComponent(new URL(request.url).pathname);
            fetched.push(path);
            return missing.includes(path)
              ? new Response('missing', { status: 404 })
              : new Response(`projection of ${path}`);
          },
        },
        store,
        index,
        state: kept,
        origin: ORIGIN,
        log: (event) => events.push(event),
      }),
  };
}

describe('publishing documents for the MCP server', () => {
  it('does nothing when the server is off', async () => {
    const run = setup({
      map: { ...agentMap, site: { ...agentMap.site, mcp: false } },
    });
    expect(await run.run()).toBe('off');
    expect(run.fetched).toEqual([]);
  });

  it('writes every document with its class and metadata, then syncs', async () => {
    const run = setup();
    expect(await run.run()).toBe('published');
    expect(run.store.objects.get('docs/bbbbbb.md')).toEqual({
      text: 'projection of /team/plan/index.md',
      customMetadata: {
        class: 'team0001',
        title: 'Team plan',
        short_id: 'bbbbbb',
        markdown: '/team/plan/index.md',
        hash: 'h-plan',
      },
    });
    expect(
      run.store.objects.get('docs/aaaaaa.md')?.customMetadata.modified,
    ).toBe('2026-10-01T00:00:00.000Z');
    expect(run.index.syncs).toBe(1);
    expect(run.state.values.get(PUBLISHED_KEY)).toEqual({
      digest: 'digest-1',
      complete: true,
      synced: true,
    });
  });

  it('rewrites only what changed and deletes what the build dropped', async () => {
    const store = publishedStore();
    store.seed('docs/aaaaaa.md', 'old', {
      ...store.objects.get('docs/aaaaaa.md')?.customMetadata,
      hash: 'h-old',
    });
    store.seed('docs/ffffff.md', 'gone', { hash: 'h-gone' });
    const run = setup({
      store,
      marker: { digest: 'digest-0', complete: true, synced: true },
    });
    expect(await run.run()).toBe('published');
    expect(run.fetched).toEqual(['/handbook/index.md']);
    expect(store.objects.has('docs/ffffff.md')).toBe(false);
    expect([...store.objects.keys()].sort()).toEqual([
      'docs/aaaaaa.md',
      'docs/bbbbbb.md',
      'docs/cccccc.md',
    ]);
  });

  it('reads past the first page of a long bucket', async () => {
    const store = publishedStore();
    const paged = new MemoryStore(1);
    for (const [key, object] of store.objects) {
      paged.seed(key, object.text, object.customMetadata);
    }
    const run = setup({ store: paged });
    await run.run();
    expect(run.fetched).toEqual([]);
  });

  it('skips a build it already published and synced', async () => {
    const run = setup({
      marker: { digest: 'digest-1', complete: true, synced: true },
    });
    expect(await run.run()).toBe('unchanged');
    expect(run.fetched).toEqual([]);
    expect(run.index.syncs).toBe(0);
  });

  it('retries a sync that could not start, without rewriting', async () => {
    const run = setup();
    run.index.failSync = true;
    expect(await run.run()).toBe('published');
    expect(run.state.values.get(PUBLISHED_KEY)).toEqual({
      digest: 'digest-1',
      complete: true,
      synced: false,
    });
    run.index.failSync = false;
    run.fetched.length = 0;
    expect(await run.run()).toBe('published');
    expect(run.fetched).toEqual([]);
    expect(run.index.syncs).toBe(1);
    expect(await run.run()).toBe('unchanged');
  });

  it('publishes the others when one projection cannot be read, then retries it', async () => {
    const missing = ['/team/plan/index.md'];
    const run = setup({ missing });
    expect(await run.run()).toBe('incomplete');
    expect([...run.store.objects.keys()].sort()).toEqual([
      'docs/aaaaaa.md',
      'docs/cccccc.md',
    ]);
    // What was written is indexed now, not when the last document is.
    expect(run.index.syncs).toBe(1);
    expect(run.state.values.get(PUBLISHED_KEY)).toEqual({
      digest: 'digest-1',
      complete: false,
      synced: true,
    });

    // Still missing: retried, nothing new to index.
    run.fetched.length = 0;
    expect(await run.run()).toBe('incomplete');
    expect(run.fetched).toEqual(['/team/plan/index.md']);
    expect(run.index.syncs).toBe(1);

    missing.length = 0;
    expect(await run.run()).toBe('published');
    expect(run.store.objects.has('docs/bbbbbb.md')).toBe(true);
    expect(run.index.syncs).toBe(2);
    expect(await run.run()).toBe('unchanged');
  });

  it('keeps going past a document the bucket refuses', async () => {
    const store = new MemoryStore();
    const put = store.put.bind(store);
    store.put = async (key, value, options) => {
      if (key === 'docs/aaaaaa.md') {
        throw new Error('put failed');
      }
      return put(key, value, options);
    };
    const run = setup({ store });
    expect(await run.run()).toBe('incomplete');
    expect([...store.objects.keys()].sort()).toEqual([
      'docs/bbbbbb.md',
      'docs/cccccc.md',
    ]);
    expect(run.index.syncs).toBe(1);
  });
});
