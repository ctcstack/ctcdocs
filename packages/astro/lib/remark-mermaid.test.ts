import type { Root } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';

import { remarkMermaid } from './remark-mermaid.js';

function transform(markdown: string): Root {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  remarkMermaid()(tree);
  return tree;
}

describe('Mermaid remark plugin', () => {
  it('replaces a mermaid fence with the renderer container', () => {
    const [node] = transform(
      '```mermaid\nflowchart LR\n  A --> B\n```\n',
    ).children;

    expect(node).toEqual({
      type: 'html',
      value:
        '<div class="kb-mermaid" data-mermaid-source="flowchart LR&#10;  A --&gt; B">' +
        '<pre>flowchart LR&#10;  A --&gt; B</pre></div>',
    });
  });

  it('escapes markup so the source cannot break out of the attribute', () => {
    const [node] = transform(
      '```mermaid\nflowchart LR\n  A["<img src=x onerror=alert(1)>"] --> B\n```\n',
    ).children;

    expect(node?.type).toBe('html');
    expect(node && 'value' in node ? node.value : '').not.toContain('<img');
  });

  it('leaves other code blocks alone', () => {
    const [node] = transform('```ts\nconst a = 1;\n```\n').children;

    expect(node?.type).toBe('code');
  });
});
