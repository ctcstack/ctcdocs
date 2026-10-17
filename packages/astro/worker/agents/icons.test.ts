import { describe, expect, it } from 'vitest';

import type { AccessMapFile } from '../access-map.js';
import { MemoryStore } from './memory-store.js';
import { serveMcp } from './tools.js';
import { agentMap, FixedIndex, ORIGIN, readers } from './test-support.js';

/** The server's own description, as an assistant reads it on connecting. */
async function serverInfo(map: AccessMapFile) {
  const response = await serveMcp(
    new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      }),
    }),
    {
      map,
      reader: readers.member,
      stale: false,
      origin: ORIGIN,
      store: new MemoryStore(),
      index: new FixedIndex([]),
      log: () => undefined,
      now: () => 0,
    },
  );
  const data = (await response.text())
    .split('\n')
    .find((line) => line.startsWith('data: '))
    ?.slice('data: '.length);
  return (
    JSON.parse(data ?? '{}') as {
      result?: { serverInfo?: { name?: string; icons?: unknown } };
    }
  ).result?.serverInfo;
}

describe('the MCP server’s icons', () => {
  it('names each brand icon by an absolute address on the site', async () => {
    const info = await serverInfo({
      ...agentMap,
      site: {
        ...agentMap.site,
        icons: [
          { path: '/icon-192.png', type: 'image/png', sizes: ['192x192'] },
          { path: '/brand.svg', type: 'image/svg+xml', sizes: ['any'] },
          {
            path: '/brand-dark.svg',
            type: 'image/svg+xml',
            sizes: [],
            theme: 'dark',
          },
        ],
      },
    });
    expect(info?.name).toBe(agentMap.site.title);
    expect(info?.icons).toEqual([
      {
        src: `${ORIGIN}/icon-192.png`,
        mimeType: 'image/png',
        sizes: ['192x192'],
      },
      { src: `${ORIGIN}/brand.svg`, mimeType: 'image/svg+xml', sizes: ['any'] },
      {
        src: `${ORIGIN}/brand-dark.svg`,
        mimeType: 'image/svg+xml',
        theme: 'dark',
      },
    ]);
  });

  it('names none when the build listed none', async () => {
    expect((await serverInfo(agentMap))?.icons ?? []).toEqual([]);
  });
});
