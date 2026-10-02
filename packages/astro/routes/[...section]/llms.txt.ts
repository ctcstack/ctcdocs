import type { APIRoute, GetStaticPaths } from 'astro';

import { classOfFolderSlug } from '../../lib/access-source.js';
import { renderSectionIndex } from '../../lib/agent-index.js';
import {
  agentIndexSite,
  loadAgentIndex,
} from '../../lib/agent-index-source.js';

interface SectionIndexProps {
  content: string;
}

const SUFFIX = '/llms.txt';

/** One index per top-level folder that has a page of its own. */
export const getStaticPaths = (async () => {
  const sections = await loadAgentIndex();
  return sections.flatMap((section) => {
    const path = section.indexPath;
    if (!path?.startsWith('/') || !path.endsWith(SUFFIX)) {
      return [];
    }
    const slug = path.slice(1, -SUFFIX.length);
    return [
      {
        params: { section: slug },
        props: {
          content: renderSectionIndex(
            agentIndexSite,
            section,
            classOfFolderSlug(slug),
          ),
        } satisfies SectionIndexProps,
      },
    ];
  });
}) satisfies GetStaticPaths;

export const GET: APIRoute<SectionIndexProps> = ({ props }) =>
  new Response(props.content, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
