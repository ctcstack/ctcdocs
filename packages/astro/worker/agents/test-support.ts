/**
 * Test doubles for the MCP server's bucket and index, and a map with three
 * classes: everyone, one team, and admins only.
 */
import type { AccessMapFile } from '../access-map.js';
import type { Reader } from '../decide.js';
import type { DocumentIndex, DocumentStore } from './documents.js';

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
        hash: 'h-handbook',
      },
      {
        id: 'bbbbbb',
        title: 'Team plan',
        markdown: '/team/plan/index.md',
        modified: null,
        hash: 'h-plan',
      },
      {
        id: 'cccccc',
        title: 'Unruled notes',
        markdown: '/unruled/notes/index.md',
        modified: null,
        hash: 'h-notes',
      },
    ],
  },
};

export const readers = {
  member: { kind: 'person', sub: 'm', email: '', groups: [] },
  team: { kind: 'person', sub: 't', email: '', groups: ['team@example.com'] },
  admin: {
    kind: 'person',
    sub: 'a',
    email: '',
    groups: ['admins@example.com'],
  },
} as const satisfies Record<string, Reader>;

interface StoredObject {
  text: string;
  customMetadata: Record<string, string>;
}

export class MemoryStore implements DocumentStore {
  readonly objects = new Map<string, StoredObject>();
  /** How many objects one `list` page returns, to exercise the cursor. */
  constructor(private readonly pageSize = 1000) {}

  seed(key: string, text: string, customMetadata: Record<string, string>) {
    this.objects.set(key, { text, customMetadata });
  }

  async get(key: string) {
    const object = this.objects.get(key);
    return object
      ? {
          text: async () => object.text,
          customMetadata: object.customMetadata,
        }
      : null;
  }

  async head(key: string) {
    const object = this.objects.get(key);
    return object ? { customMetadata: object.customMetadata } : null;
  }

  async put(
    key: string,
    value: string,
    options: { customMetadata: Record<string, string> },
  ) {
    this.objects.set(key, {
      text: value,
      customMetadata: options.customMetadata,
    });
    return null;
  }

  async list(options: { prefix: string; cursor?: string }) {
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(options.prefix))
      .sort();
    const start = Number(options.cursor ?? 0);
    const page = keys.slice(start, start + this.pageSize);
    const truncated = start + this.pageSize < keys.length;
    return {
      objects: page.map((key) => ({
        key,
        customMetadata: this.objects.get(key)?.customMetadata ?? {},
      })),
      truncated,
      ...(truncated ? { cursor: String(start + this.pageSize) } : {}),
    };
  }

  async delete(keys: string[]) {
    for (const key of keys) {
      this.objects.delete(key);
    }
  }
}

/** An index that answers every query with the same chunks. */
export class FixedIndex implements DocumentIndex {
  readonly queries: { query: string; classes: readonly string[] }[] = [];
  syncs = 0;
  failSync = false;

  constructor(private readonly keys: readonly string[]) {}

  async search(query: string, classes: readonly string[]) {
    this.queries.push({ query, classes });
    return this.keys.map((key, index) => ({ key, score: 1 - index / 100 }));
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
