/**
 * Keeping the bucket in step with the build the Worker serves (ADR-041).
 *
 * The build lists every document the MCP server offers, with a hash of what
 * its stored object would hold. On a schedule the Worker compares that list
 * with the bucket: it writes each document whose hash differs, from the
 * Markdown projection in its own assets, deletes the ones the build no longer
 * has, and asks AI Search to sync what changed. A document that cannot be
 * written now is tried again on the next run, without holding back the
 * others. A marker in the state namespace — the build's digest, whether every
 * document is written, whether the index has been asked to sync since the
 * last change — lets a finished build skip all of that, and a rollback is
 * published like any other build, because its digest differs.
 *
 * Web-standard code only: the bucket, the index, the assets and the state are
 * handed in.
 */
import type { AccessMapFile } from '../access-map.js';
import {
  DOCUMENT_PREFIX,
  documentKey,
  type DocumentIndex,
  type DocumentStore,
} from './documents.js';

export const PUBLISHED_KEY = 'agents-published';

interface PublishedMarker {
  readonly digest: string;
  /** Every document of the build is in the bucket. */
  readonly complete: boolean;
  /** AI Search has been asked to sync since the bucket last changed. */
  readonly synced: boolean;
}

export interface PublishContext {
  readonly map: AccessMapFile;
  readonly assets: { fetch(request: Request): Promise<Response> };
  readonly store: DocumentStore;
  readonly index: DocumentIndex;
  readonly state: {
    get(key: string): Promise<unknown>;
    put(key: string, value: string): Promise<void>;
  };
  /** Any origin the assets answer for; the files are read by path. */
  readonly origin: string;
  readonly log: (event: Readonly<Record<string, unknown>>) => void;
}

export type PublishOutcome = 'off' | 'unchanged' | 'published' | 'incomplete';

function isMarker(value: unknown): value is PublishedMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PublishedMarker).digest === 'string' &&
    typeof (value as PublishedMarker).complete === 'boolean' &&
    typeof (value as PublishedMarker).synced === 'boolean'
  );
}

function sitePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function storedHashes(
  store: DocumentStore,
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const page = await store.list({
      prefix: DOCUMENT_PREFIX,
      include: ['customMetadata'],
      ...(cursor ? { cursor } : {}),
    });
    for (const object of page.objects) {
      hashes.set(object.key, object.customMetadata?.hash ?? '');
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return hashes;
}

export async function publishDocuments(
  context: PublishContext,
): Promise<PublishOutcome> {
  const { map, assets, store, index, state, origin, log } = context;
  const catalog = map.agents;
  if (map.site.mcp !== true || !catalog) {
    return 'off';
  }
  const marker = await state.get(PUBLISHED_KEY);
  const current =
    isMarker(marker) && marker.digest === catalog.digest ? marker : undefined;
  if (current?.complete && current.synced) {
    return 'unchanged';
  }

  let complete = current?.complete ?? false;
  let synced = current?.synced ?? false;
  if (!complete) {
    complete = true;
    const stored = await storedHashes(store);
    let written = 0;
    for (const document of catalog.documents) {
      const key = documentKey(document.id);
      if (stored.get(key) === document.hash) {
        continue;
      }
      const fileClass = map.files[document.markdown];
      try {
        const response = await assets.fetch(
          new Request(new URL(sitePath(document.markdown), origin), {
            redirect: 'manual',
          }),
        );
        if (!response.ok || typeof fileClass !== 'string') {
          complete = false;
          continue;
        }
        await store.put(key, await response.text(), {
          httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
          customMetadata: {
            class: fileClass,
            title: document.title,
            short_id: document.id,
            markdown: document.markdown,
            ...(document.modified ? { modified: document.modified } : {}),
            hash: document.hash,
          },
        });
        written += 1;
      } catch {
        // Tried again on the next run; the others are not held back.
        complete = false;
      }
    }
    const kept = new Set(
      catalog.documents.map((document) => documentKey(document.id)),
    );
    const gone = [...stored.keys()].filter((key) => !kept.has(key));
    for (let start = 0; start < gone.length; start += 1000) {
      await store.delete(gone.slice(start, start + 1000));
    }
    if (written > 0 || gone.length > 0) {
      synced = false;
    }
    log({ event: 'agents-published', written, deleted: gone.length });
    if (!complete) {
      log({ event: 'agents-publish-incomplete' });
    }
  }

  if (!synced) {
    try {
      await index.sync();
      synced = true;
    } catch {
      // A sync already running refuses another; the next run starts it.
    }
  }
  await state.put(
    PUBLISHED_KEY,
    JSON.stringify({ digest: catalog.digest, complete, synced }),
  );
  return complete ? 'published' : 'incomplete';
}
