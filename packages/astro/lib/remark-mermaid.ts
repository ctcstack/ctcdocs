import type { Parents, Root, RootContent } from 'mdast';

/**
 * Turns a ```mermaid fence into the container the client renderer expects,
 * before Expressive Code can claim it.
 *
 * Expressive Code runs as a rehype plugin, so a remark plugin always sees the
 * code node first. That matters twice over: Expressive Code rewrites the block
 * into per-line elements that carry no language class and no newlines, and its
 * frame would flash around the diagram until the renderer swapped it out.
 *
 * The source is emitted both as a data attribute, which the renderer reads,
 * and as a `pre`, which is what a reader without JavaScript is left with.
 */

/*
 * Newlines are encoded too: they carry the diagram's structure, and an
 * attribute value is the one place a parser is allowed to rewrite them.
 */
const HTML_ESCAPES = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ['\n', '&#10;'],
  ['\r', '&#13;'],
]);

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"\n\r]/gu,
    (character) => HTML_ESCAPES.get(character) ?? character,
  );
}

function mermaidContainer(source: string): RootContent {
  const escaped = escapeHtml(source);
  return {
    type: 'html',
    value: `<div class="kb-mermaid" data-mermaid-source="${escaped}"><pre>${escaped}</pre></div>`,
  };
}

function replaceInParent(node: Parents): void {
  node.children = node.children.map((child) => {
    if (child.type === 'code' && child.lang === 'mermaid') {
      return mermaidContainer(child.value);
    }
    if ('children' in child) {
      replaceInParent(child);
    }
    return child;
  }) as Parents['children'];
}

export function remarkMermaid(): (tree: Root) => void {
  return (tree) => {
    replaceInParent(tree);
  };
}
