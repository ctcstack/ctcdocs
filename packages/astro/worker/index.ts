/**
 * The platform's Worker for a private deployment (ADR-038): the Cloudflare
 * entry point around the web-standard gate in `handler.ts`.
 *
 * Only this file knows it runs on Cloudflare: the asset binding, the KV
 * namespace holding the directory snapshot, and the secrets.
 */
import accessMap from 'ctcdocs-access-map';

import { handle } from './handler.js';
import { GoogleKeys } from './oidc.js';
import {
  isSnapshot,
  SNAPSHOT_KEY,
  type DirectorySnapshot,
} from './snapshot.js';

interface Env {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  readonly KB_STATE: { get(key: string, type: 'json'): Promise<unknown> };
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly SESSION_SECRET?: string;
  readonly SESSION_SECRET_PREVIOUS?: string;
  readonly MACHINE_KEYS?: string;
}

/** The snapshot is read at most once a minute per isolate. */
const SNAPSHOT_CACHE_MS = 60_000;
let cached: { at: number; value: DirectorySnapshot | undefined } | undefined;

const googleKeys = new GoogleKeys(
  (input, init) => fetch(input, init),
  () => Date.now(),
);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, {
      map: accessMap,
      assets: env.ASSETS,
      snapshot: async () => {
        const now = Date.now();
        if (!cached || now - cached.at > SNAPSHOT_CACHE_MS) {
          const value = await env.KB_STATE.get(SNAPSHOT_KEY, 'json');
          cached = { at: now, value: isSnapshot(value) ? value : undefined };
        }
        return cached.value;
      },
      secrets: {
        googleClientId: env.GOOGLE_CLIENT_ID,
        googleClientSecret: env.GOOGLE_CLIENT_SECRET,
        sessionSecret: env.SESSION_SECRET,
        previousSessionSecret: env.SESSION_SECRET_PREVIOUS,
        machineKeys: env.MACHINE_KEYS,
      },
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
      googleKeys,
      log: (event) => console.log(JSON.stringify(event)),
    });
  },
};
