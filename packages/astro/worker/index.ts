/**
 * The platform's Worker for a private deployment (ADR-038): the Cloudflare
 * entry point around the web-standard gate in `handler.ts`.
 *
 * Only this file knows it runs on Cloudflare: the asset binding, the KV
 * namespace holding the directory snapshot and the machine keys, and the
 * secrets; and, for the MCP server (ADR-041), the OAuth library with its own
 * namespace, the bucket of documents and the AI Search instance. Its schedule
 * keeps that bucket in step with the build.
 */
import builtMap from 'ctcdocs-access-map';

import type { AccessMapFile } from './access-map.js';
import { agentOAuth } from './agents/oauth.js';
import type { DocumentIndex, DocumentStore } from './agents/documents.js';
import { publishDocuments } from './agents/publish.js';
import { handle, type AgentContext } from './handler.js';
import { MACHINE_KEYS_KEY } from './machine-keys.js';
import { GoogleKeys } from './oidc.js';
import {
  isSnapshot,
  SNAPSHOT_KEY,
  type DirectorySnapshot,
} from './snapshot.js';

/** The part of an AI Search instance binding the Worker uses. */
interface AiSearch {
  search(request: {
    query: string;
    ai_search_options: {
      retrieval: {
        max_num_results: number;
        match_threshold: number;
        filters: { class: { $in: string[] } };
      };
    };
  }): Promise<{ chunks?: { score: number; item: { key: string } }[] }>;
  readonly jobs: { create(): Promise<unknown> };
}

interface Env {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  readonly KB_STATE: {
    get(key: string, type: 'json'): Promise<unknown>;
    put(key: string, value: string): Promise<void>;
  };
  readonly OAUTH_KV?: unknown;
  readonly KB_DOCUMENTS?: DocumentStore;
  readonly KB_SEARCH?: AiSearch;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly SESSION_SECRET?: string;
  readonly SESSION_SECRET_PREVIOUS?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const accessMap: AccessMapFile = builtMap;

/** The snapshot and the machine keys are read at most once a minute per isolate. */
const STATE_CACHE_MS = 60_000;
let cached: { at: number; value: DirectorySnapshot | undefined } | undefined;
let cachedKeys: { at: number; value: unknown } | undefined;

/**
 * Chunks AI Search returns per query, before the Worker keeps one per
 * document, and the score below which a chunk is not a match.
 */
const SEARCH_CHUNKS = 30;
const MATCH_THRESHOLD = 0.4;

const googleKeys = new GoogleKeys(
  (input, init) => fetch(input, init),
  () => Date.now(),
);

const log = (event: Readonly<Record<string, unknown>>) =>
  console.log(JSON.stringify(event));

function documentIndex(search: AiSearch): DocumentIndex {
  return {
    search: async (query, classes) => {
      const response = await search.search({
        query,
        ai_search_options: {
          retrieval: {
            max_num_results: SEARCH_CHUNKS,
            match_threshold: MATCH_THRESHOLD,
            filters: { class: { $in: [...classes] } },
          },
        },
      });
      return (response.chunks ?? []).map((chunk) => ({
        key: chunk.item.key,
        score: chunk.score,
      }));
    },
    sync: async () => {
      await search.jobs.create();
    },
  };
}

function agentsFor(env: Env, ctx: ExecutionContext): AgentContext | undefined {
  const { OAUTH_KV, KB_DOCUMENTS, KB_SEARCH } = env;
  if (accessMap.site.mcp !== true || !OAUTH_KV || !KB_DOCUMENTS || !KB_SEARCH) {
    return undefined;
  }
  return {
    oauth: (origin) =>
      agentOAuth({
        env: { OAUTH_KV },
        ctx,
        origin,
        site: accessMap.site.title,
        log,
      }),
    store: KB_DOCUMENTS,
    index: documentIndex(KB_SEARCH),
  };
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return handle(request, {
      map: accessMap,
      assets: env.ASSETS,
      snapshot: async () => {
        const now = Date.now();
        if (!cached || now - cached.at > STATE_CACHE_MS) {
          const value = await env.KB_STATE.get(SNAPSHOT_KEY, 'json');
          cached = { at: now, value: isSnapshot(value) ? value : undefined };
        }
        return cached.value;
      },
      machineKeys: async () => {
        const now = Date.now();
        if (!cachedKeys || now - cachedKeys.at > STATE_CACHE_MS) {
          cachedKeys = {
            at: now,
            value: await env.KB_STATE.get(MACHINE_KEYS_KEY, 'json'),
          };
        }
        return cachedKeys.value;
      },
      secrets: {
        googleClientId: env.GOOGLE_CLIENT_ID,
        googleClientSecret: env.GOOGLE_CLIENT_SECRET,
        sessionSecret: env.SESSION_SECRET,
        previousSessionSecret: env.SESSION_SECRET_PREVIOUS,
      },
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
      googleKeys,
      log,
      agents: agentsFor(env, ctx),
    });
  },

  /** Publishes the build's documents for the MCP server, when it has changed. */
  async scheduled(
    _controller: unknown,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const origin = Object.values(accessMap.site.environments)[0]?.origin;
    if (
      accessMap.site.mcp !== true ||
      !env.KB_DOCUMENTS ||
      !env.KB_SEARCH ||
      !origin
    ) {
      return;
    }
    ctx.waitUntil(
      publishDocuments({
        map: accessMap,
        assets: env.ASSETS,
        store: env.KB_DOCUMENTS,
        index: documentIndex(env.KB_SEARCH),
        state: {
          get: (key) => env.KB_STATE.get(key, 'json'),
          put: (key, value) => env.KB_STATE.put(key, value),
        },
        origin,
        log,
      }).catch((error: unknown) => {
        log({
          event: 'agents-publish-failed',
          error: error instanceof Error ? error.name : 'unknown',
        });
      }),
    );
  },
};
