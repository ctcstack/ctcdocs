import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';

import { markdownOwnershipHeader } from '../../lib/project.js';
import { serializePublishedMarkdown } from '../../lib/published-markdown.js';

interface MarkdownPageProps {
  content: string;
}

function required(value: string | undefined, field: string): string {
  if (!value) {
    throw new Error(`Generated Google document is missing ${field}.`);
  }
  return value;
}

export const getStaticPaths = (async () => {
  const entries = await getCollection(
    'docs',
    ({ data }) => data.sourceType === 'google-doc',
  );
  const stableSlugs = new Set(
    entries.map(({ id }) => required(id, 'route ID')),
  );

  return entries.map((entry) => {
    const { data } = entry;
    const slug = required(entry.id, 'route ID');
    const body = required(entry.body, 'body');
    return {
      params: { slug },
      props: {
        content: serializePublishedMarkdown({
          title: data.title,
          sourceUrl: required(data.editUrl?.toString(), 'editUrl'),
          googleModifiedTime: required(
            data.googleModifiedTime,
            'googleModifiedTime',
          ),
          syncedAt: required(data.syncedAt, 'syncedAt'),
          contentHash: required(data.contentHash, 'contentHash'),
          body,
          ownershipHeader: markdownOwnershipHeader,
          stableSlugs,
        }),
      } satisfies MarkdownPageProps,
    };
  });
}) satisfies GetStaticPaths;

export const GET: APIRoute<MarkdownPageProps> = ({ props }) =>
  new Response(props.content, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
    },
  });
