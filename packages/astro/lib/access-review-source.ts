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

/** Every slug the sidebar shows, in its order. */
function sidebarOrder(items: readonly NavigationItem[]): string[] {
  return items.flatMap((item) => {
    if (typeof item === 'string') {
      return [item];
    }
    const own = typeof item.slug === 'string' ? [item.slug] : [];
    const children = Array.isArray(item.items)
      ? sidebarOrder(item.items as readonly NavigationItem[])
      : [];
    return [...own, ...children];
  });
}

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
  const order = new Map<string, number>();
  for (const slug of sidebarOrder(navigation as readonly NavigationItem[])) {
    if (!order.has(slug)) {
      order.set(slug, order.size);
    }
  }
  return buildAccessReview({
    access,
    model: accessModel,
    corpus,
    findings: folderAccessFindings,
    order,
    folderPages: new Set(folderPages.map((page) => page.id)),
  });
}
