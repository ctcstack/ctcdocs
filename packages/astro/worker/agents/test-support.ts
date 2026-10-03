/**
 * Test doubles for the MCP server's bucket and index, and a map with three
 * classes: everyone, one team, and admins only.
 */
import type { AccessMapFile } from '../access-map.js';
import type { Reader } from '../decide.js';
import type { DocumentIndex, IndexedChunk } from './documents.js';
import { MemoryStore } from './memory-store.js';

export const ORIGIN = 'https://docs.example.com';

export const agentMap: AccessMapFile = {
  schemaVersion: 1,
  site: {
    environments: {
      production: {
        origin: ORIGIN,
        hostname: 'docs.example.com',
        visibility: 'private',
      },
    },
    workspaceDomains: ['example.com'],
    title: 'Example [DOCS]',
    description: 'Synthetic documentation',
    mcp: true,
  },
  csp: { scriptHashes: [] },
  enabled: true,
  admins: ['admins@example.com'],
  classes: {
    members: { id: 'members', readers: '*' },
    admins: { id: 'admins', readers: [] },
    team0001: { id: 'team0001', readers: ['team@example.com'] },
  },
  bundles: { members: '/pagefind/' },
  files: {
    '/handbook/index.md': 'members',
    '/team/plan/index.md': 'team0001',
    '/unruled/notes/index.md': 'admins',
  },
  agents: {
    digest: 'digest-1',
    documents: [
      {
        id: 'aaaaaa',
        title: 'Handbook',
        markdown: '/handbook/index.md',
        modified: '2026-10-01T00:00:00.000Z',
        path: [],
        hash: 'h-handbook',
      },
      {
        id: 'bbbbbb',
        title: 'Team plan',
        markdown: '/team/plan/index.md',
        modified: null,
        path: ['Team'],
        hash: 'h-plan',
      },
      {
        id: 'cccccc',
        title: 'Unruled notes',
        markdown: '/unruled/notes/index.md',
        modified: null,
        path: ['Unruled'],
        hash: 'h-notes',
      },
    ],
  },
};

export const readers = {
  member: { kind: 'person', sub: 'm', groups: [] },
  team: { kind: 'person', sub: 't', groups: ['team@example.com'] },
  admin: {
    kind: 'person',
    sub: 'a',
    groups: ['admins@example.com'],
  },
} as const satisfies Record<string, Reader>;

/**
 * A chunk of `agentMap`'s document at `key`, with the class the build gives
 * it, as AI Search would return it; `overrides` stand in for a stale or a
 * foreign index.
 */
export function chunkOf(
  key: string,
  overrides: Partial<IndexedChunk> = {},
): IndexedChunk {
  const document = agentMap.agents?.documents.find(
    (entry) => `docs/${entry.id}.md` === key,
  );
  const fileClass = document ? agentMap.files[document.markdown] : undefined;
  return {
    key,
    text: `A passage of ${document?.title ?? key}.`,
    class: typeof fileClass === 'string' ? fileClass : undefined,
    ...overrides,
  };
}

/** An index that answers every query with the same chunks. */
export class FixedIndex implements DocumentIndex {
  readonly queries: { query: string; classes: readonly string[] }[] = [];
  syncs = 0;
  failSync = false;
  private readonly chunks: readonly IndexedChunk[];

  /** Each key becomes its document's chunk; a chunk is taken as it is. */
  constructor(chunks: readonly (string | IndexedChunk)[]) {
    this.chunks = chunks.map((chunk) =>
      typeof chunk === 'string' ? chunkOf(chunk) : chunk,
    );
  }

  async search(query: string, classes: readonly string[]) {
    this.queries.push({ query, classes });
    return this.chunks;
  }

  async sync() {
    if (this.failSync) {
      throw new Error('sync_in_cooldown');
    }
    this.syncs += 1;
  }
}

/** The bucket as a deploy leaves it for `agentMap`. */
export function publishedStore(): MemoryStore {
  const store = new MemoryStore();
  for (const document of agentMap.agents?.documents ?? []) {
    store.seed(`docs/${document.id}.md`, `# ${document.title}\n`, {
      class: String(agentMap.files[document.markdown]),
      title: document.title,
      short_id: document.id,
      markdown: document.markdown,
      hash: document.hash,
      ...(document.modified ? { modified: document.modified } : {}),
    });
  }
  return store;
}
