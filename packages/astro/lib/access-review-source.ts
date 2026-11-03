/**
 * What the access review page is built from, read from the build (ADR-045).
 *
 * Kept apart from `access-review-view.ts`, which is pure and unit-tested,
 * because this module needs the content collection and the generated sidebar,
 * and both exist only inside a project's build. The model is the one the
 * access map is computed from, so the page and the map cannot disagree.
 */
import { getCollection } from 'astro:content';
import navigation from 'virtual:ctcdocs/navigation';

import { accessModel, corpus, folderAccessFindings } from './access-source.js';
import { buildAccessReview, type AccessReview } from './access-review-view.js';
import type { NavigationItem } from './agent-index.js';
import { siteConfiguration } from './project.js';
import { sidebarPositions } from './sidebar-order.js';

/** The review, or nothing when the project has no access rules. */
export async function loadAccessReview(): Promise<AccessReview | undefined> {
  const access = siteConfiguration.access;
  if (!access) {
    return undefined;
  }
  const folderPages = await getCollection(
    'docs',
    ({ data }) => data.sourceType === 'section-index',
  );
  return buildAccessReview({
    access,
    model: accessModel,
    corpus,
    findings: folderAccessFindings,
    order: sidebarPositions(navigation as readonly NavigationItem[]),
    folderPages: new Set(folderPages.map((page) => page.id)),
  });
}
