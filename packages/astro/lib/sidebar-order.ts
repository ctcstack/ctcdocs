/**
 * The order readers know the documents in: the sidebar's, which follows the
 * numbered names of the folders in Drive.
 *
 * Kept pure, apart from the generated sidebar it is read from, so the pages
 * that follow it can be tested without a project's build.
 */
import type { NavigationItem } from './agent-index.js';

/** Every slug the sidebar shows, in its order. */
function sidebarSlugs(items: readonly NavigationItem[]): string[] {
  return items.flatMap((item) => {
    if (typeof item === 'string') {
      return [item];
    }
    const own = typeof item.slug === 'string' ? [item.slug] : [];
    const children = Array.isArray(item.items)
      ? sidebarSlugs(item.items as readonly NavigationItem[])
      : [];
    return [...own, ...children];
  });
}

/** Each slug's place in the sidebar, counted from its first appearance. */
export function sidebarPositions(
  items: readonly NavigationItem[],
): Map<string, number> {
  const order = new Map<string, number>();
  for (const slug of sidebarSlugs(items)) {
    if (!order.has(slug)) {
      order.set(slug, order.size);
    }
  }
  return order;
}

/**
 * Groups of documents in the sidebar's order: a group stands where its first
 * document does. A group the sidebar does not show sorts last, by label.
 */
export function inSidebarOrder<
  Group extends { label: string; documents: readonly { slug: string }[] },
>(groups: readonly Group[], order: ReadonlyMap<string, number>): Group[] {
  const position = (group: Group) =>
    Math.min(
      Number.POSITIVE_INFINITY,
      ...group.documents.map(
        ({ slug }) => order.get(slug) ?? Number.POSITIVE_INFINITY,
      ),
    );
  return [...groups].sort((a, b) => {
    const left = position(a);
    const right = position(b);
    return left === right
      ? a.label.localeCompare(b.label, 'en')
      : left < right
        ? -1
        : 1;
  });
}
