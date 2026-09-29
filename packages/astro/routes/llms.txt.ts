import type { APIRoute } from 'astro';

import { renderSiteIndex } from '../lib/agent-index.js';
import { agentIndexSite, loadAgentIndex } from '../lib/agent-index-source.js';

/*
 * The Content-Type is for `astro dev`. A static build discards it, so the
 * charset reaches a deployed reader through the project's `_headers` rule for
 * this path, as it does for the Markdown projection.
 */
export const GET: APIRoute = async () =>
  new Response(renderSiteIndex(agentIndexSite, await loadAgentIndex()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
