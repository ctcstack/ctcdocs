import { parseHTML } from 'linkedom';
import { describe, expect, it, vi } from 'vitest';

import { type MermaidApi, renderMermaidDiagrams } from './mermaid-renderer.js';

function api(options: { invalid?: boolean; renderFailure?: boolean } = {}): {
  api: MermaidApi;
  initialize: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
} {
  const initialize = vi.fn();
  const run = vi.fn(async ({ nodes }: { nodes: ArrayLike<HTMLElement> }) => {
    if (options.renderFailure) {
      throw new Error('Synthetic render failure');
    }
    for (const node of Array.from(nodes)) {
      const svg = node.ownerDocument.createElement('svg');
      node.replaceChildren(svg);
    }
  });
  return {
    api: {
      initialize,
      parse: options.invalid
        ? () => Promise.reject(new Error('Synthetic parse failure'))
        : () => Promise.resolve({ diagramType: 'flowchart-v2' }),
      run,
    },
    initialize,
    run,
  };
}

describe('Mermaid renderer', () => {
  it('renders a Mermaid fence with strict configuration', async () => {
    const { document } = parseHTML(
      '<main><pre><code class="language-mermaid">flowchart LR\nA --> B</code></pre></main>',
    );
    const mock = api();

    await renderMermaidDiagrams(document, mock.api, { lineColor: '#4a4a4a' });

    expect(document.querySelector('.kb-mermaid svg')).not.toBeNull();
    expect(mock.initialize).toHaveBeenCalledWith({
      flowchart: { htmlLabels: false },
      securityLevel: 'strict',
      startOnLoad: false,
      theme: 'base',
      themeVariables: { lineColor: '#4a4a4a' },
    });
    expect(mock.run).toHaveBeenCalledOnce();
  });

  it.each([{ invalid: true }, { renderFailure: true }])(
    'shows a controlled error block for invalid input',
    async (options) => {
      const source = 'not a valid diagram';
      const { document } = parseHTML(
        `<main><pre><code class="language-mermaid">${source}</code></pre></main>`,
      );

      await renderMermaidDiagrams(document, api(options).api, {});

      const error = document.querySelector('.kb-mermaid-error');
      expect(error?.getAttribute('role')).toBe('alert');
      expect(error?.textContent).toContain('Diagram could not be rendered.');
      expect(error?.textContent).toContain(source);
    },
  );
});
