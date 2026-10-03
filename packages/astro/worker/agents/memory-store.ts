/**
 * A bucket in memory, as far as the MCP server uses one: the stand-in for R2
 * in the unit tests and in the denial suite, which runs the real publisher
 * and tools against a build. Never bundled into the Worker.
 */
import type { DocumentStore } from './documents.js';

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
