/**
 * The corpus the `llms.txt` indexes list, read from the build.
 *
 * Kept apart from `agent-index.ts`, which is pure and unit-tested, because
 * this module needs the content collection and the generated sidebar, and
 * both exist only inside a project's build.
 */
import { getCollection } from 'astro:content';
import navigation from 'virtual:ctcdocs/navigation';

import {
  buildAgentIndex,
  type AgentIndexSection,
  type AgentIndexSite,
  type IndexedDocument,
  type NavigationItem,
} from './agent-index.js';
import { classOfDocument } from './access-source.js';
import { siteConfiguration } from './project.js';
import { hasMarkdownProjection } from './projection.js';
import { loadSectionHrefs, sectionHref } from './sections.js';

export const agentIndexSite: AgentIndexSite = {
  title: siteConfiguration.brand.siteTitle,
  description: siteConfiguration.brand.siteDescription,
};

async function readAgentIndex(): Promise<AgentIndexSection[]> {
  const entries = await getCollection('docs', ({ data }) =>
    hasMarkdownProjection(data.sourceType),
  );
  const documents = new Map<string, IndexedDocument>(
    entries.map(({ id, data }) => [
      id,
      {
        title: data.title,
        description: data.description,
        pdf: data.sourceType === 'drive-pdf',
        sheet: data.sourceType === 'drive-sheet',
        classId: classOfDocument(data.googleFileId),
      },
    ]),
  );
  const sections = await loadSectionHrefs();
  return buildAgentIndex(
    navigation as readonly NavigationItem[],
    documents,
    (trail) => sectionHref(sections, trail),
  );
}

let built: Promise<AgentIndexSection[]> | undefined;

/**
 * Every document with a Markdown version, in the order the sidebar has it.
 *
 * A build reads the corpus once for the site index and every section index,
 * so they cannot disagree. The dev server edits content in place, so there it
 * is read on every request.
 */
export function loadAgentIndex(): Promise<AgentIndexSection[]> {
  if (import.meta.env.DEV) {
    return readAgentIndex();
  }
  built ??= readAgentIndex();
  return built;
}
