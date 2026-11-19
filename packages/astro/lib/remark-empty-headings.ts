import type { Heading, Nodes, Parents, Root } from 'mdast';

/**
 * Drops headings with nothing in them.
 *
 * A Google Doc keeps a line styled as a heading after its text is deleted, and
 * the export carries it over as `##` and nothing else. On the page that is an
 * empty `<h2>`, and an empty entry in the contents list beside it: a screen
 * reader announces a heading with no name, and the list offers a link to
 * nowhere. The heading says nothing, so nothing is lost by leaving it out.
 *
 * This is presentation, like the table wrapper, so it happens here rather
 * than in the sync: the generated Markdown keeps the document as exported.
 *
 * A heading counts as empty when its text is only white space and it holds
 * nothing that is not text, such as an image, which names itself by its alt.
 */

function hasContent(node: Nodes): boolean {
  if (node.type === 'text' || node.type === 'inlineCode') {
    return node.value.trim() !== '';
  }
  if (
    node.type === 'image' ||
    node.type === 'imageReference' ||
    node.type === 'html'
  ) {
    return true;
  }
  return 'children' in node && node.children.some(hasContent);
}

function isEmptyHeading(node: Nodes): node is Heading {
  return node.type === 'heading' && !hasContent(node);
}

function dropEmptyHeadings(node: Parents): void {
  node.children = node.children.filter(
    (child) => !isEmptyHeading(child),
  ) as Parents['children'];
  for (const child of node.children) {
    if ('children' in child) {
      dropEmptyHeadings(child);
    }
  }
}

export function remarkEmptyHeadings(): (tree: Root) => void {
  return (tree) => {
    dropEmptyHeadings(tree);
  };
}
