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
import { agentOAuth, type ExecutionContextLike } from './agents/oauth.js';
import type { DocumentIndex, DocumentStore } from './agents/documents.js';
import { searchFilter, type SearchFilter } from './agents/search-filter.js';
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
        keyword_match_mode: 'and' | 'or';
        context_expansion: number;
        filters?: SearchFilter;
      };
      reranking: { enabled: boolean; model: string; match_threshold: number };
    };
  }): Promise<{
    chunks?: {
      text?: string;
      item: { key: string; metadata?: Record<string, unknown> };
    }[];
  }>;
  readonly jobs: { create(): Promise<unknown> };
}

interface Env {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  readonly KB_STATE: { get(key: string, type: 'json'): Promise<unknown> };
  readonly OAUTH_KV?: unknown;
  readonly KB_DOCUMENTS?: DocumentStore;
  readonly KB_SEARCH?: AiSearch;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly SESSION_SECRET?: string;
  readonly SESSION_SECRET_PREVIOUS?: string;
}

const accessMap: AccessMapFile = builtMap;

/** The snapshot and the machine keys are read at most once a minute per isolate. */
const STATE_CACHE_MS = 60_000;
let cached: { at: number; value: DirectorySnapshot | undefined } | undefined;
let cachedKeys: { at: number; value: unknown } | undefined;

const googleKeys = new GoogleKeys(
  (input, init) => fetch(input, init),
  () => Date.now(),
);

const log = (event: Readonly<Record<string, unknown>>) =>
  console.log(JSON.stringify(event));

/** A filter AI Search accepts: none rather than an empty one. */
const withFilter = (filters: SearchFilter) =>
  Object.keys(filters).length > 0 ? { filters } : {};

function documentIndex(search: AiSearch): DocumentIndex {
  return {
    // As the project's `mcp.search` says (ADR-042).
    search: async (query, classes, settings, restriction) => {
      const response = await search.search({
        query,
        ai_search_options: {
          retrieval: {
            max_num_results: settings.chunks,
            match_threshold: settings.vectorThreshold,
            keyword_match_mode: settings.keywordMatch,
            context_expansion: settings.contextChunks,
            // Within AI Search's limits; the Worker judges every chunk anyway.
            ...withFilter(
              searchFilter(
                Object.keys(accessMap.classes),
                classes,
                restriction,
              ),
            ),
          },
          reranking: {
            enabled: settings.reranking.enabled,
            model: settings.reranking.model,
            match_threshold: settings.reranking.threshold,
          },
        },
      });
      return (response.chunks ?? []).map((chunk) => {
        const cls = chunk.item.metadata?.class;
        return {
          key: chunk.item.key,
          text: chunk.text ?? '',
          class: typeof cls === 'string' ? cls : undefined,
        };
      });
    },
    sync: async () => {
      await search.jobs.create();
    },
  };
}

function agentsFor(
  env: Env,
  ctx: ExecutionContextLike,
): AgentContext | undefined {
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
    ctx: ExecutionContextLike,
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
    ctx: ExecutionContextLike,
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
