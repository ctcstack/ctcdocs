import type { Parents, Root, RootContent } from 'mdast';
import * as cheerio from 'cheerio';

/**
 * Wraps every table in its own scroll container.
 *
 * A table has to do two things at once: fill the measure, and keep a wide row
 * from scrolling the page. One element cannot do both — a block-level table
 * scrolls but does not stretch its cells, and a real table stretches but
 * overflows. So the frame and the scroller move out to a wrapper, which is
 * what the reference does too.
 *
 * The wrapper is added here rather than in the sync pipeline, because it is
 * presentation: the generated Markdown, the Markdown projection, and the AI
 * index all stay free of it.
 *
 * Tables reach the page two ways. A Markdown table is a `table` node and is
 * wrapped by emitting the open and close tags around it, which `rehype-raw`
 * later stitches back together. A table that survived the HTML fallback with
 * its merged cells is raw HTML inside an `html` node, and is wrapped inside
 * that node's own markup. Astro runs `rehype-raw` after every user rehype
 * plugin, so the second case is unreachable from rehype and both are handled
 * here.
 */

const OPEN: RootContent = { type: 'html', value: '<div class="kb-table">' };
const CLOSE: RootContent = { type: 'html', value: '</div>' };

function wrapHtmlTables(value: string): string | undefined {
  if (!value.includes('<table')) {
    return undefined;
  }
  const $ = cheerio.load(value, null, false);
  const tables = $('table').filter(
    (_, table) => $(table).parents('table').length === 0,
  );
  if (tables.length === 0) {
    return undefined;
  }
  tables.wrap('<div class="kb-table"></div>');
  return $.root().html() ?? value;
}

function wrapTables(node: Parents): void {
  const children: RootContent[] = [];
  for (const child of node.children) {
    if (child.type === 'table') {
      children.push(OPEN, child, CLOSE);
      continue;
    }
    if (child.type === 'html') {
      const wrapped = wrapHtmlTables(child.value);
      children.push(
        wrapped === undefined ? child : { ...child, value: wrapped },
      );
      continue;
    }
    if ('children' in child) {
      wrapTables(child);
    }
    children.push(child);
  }
  node.children = children as Parents['children'];
}

export function remarkTableScroll(): (tree: Root) => void {
  return (tree) => {
    wrapTables(tree);
  };
}
