/**
 * Mermaid's own themes bring their own palette. The diagram is drawn from the
 * site tokens instead, so it sits in the page rather than on it, and so the
 * accent stays reserved for what carries meaning.
 */
export type MermaidThemeVariables = Record<string, boolean | string>;

export interface MermaidApi {
  initialize(configuration: {
    flowchart: { htmlLabels: boolean };
    securityLevel: 'strict';
    startOnLoad: false;
    theme: 'base';
    themeVariables: MermaidThemeVariables;
  }): void;
  parse(source: string): Promise<unknown>;
  run(options: {
    nodes: ArrayLike<HTMLElement>;
    suppressErrors: true;
  }): Promise<void>;
}

function createErrorBlock(
  document: Document,
  source: string,
  message: string,
): HTMLElement {
  const error = document.createElement('div');
  error.className = 'kb-mermaid-error';
  error.setAttribute('role', 'alert');
  error.dataset.mermaidSource = source;

  const summary = document.createElement('strong');
  summary.textContent = message;
  const details = document.createElement('details');
  const detailsSummary = document.createElement('summary');
  detailsSummary.textContent = 'Show diagram source';
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = source;
  pre.append(code);
  details.append(detailsSummary, pre);
  error.append(summary, details);
  return error;
}

function sourceNodes(root: ParentNode): Array<{
  replaceTarget: Element;
  source: string;
}> {
  const codeBlocks = Array.from(
    root.querySelectorAll('pre > code.language-mermaid'),
  ).map((code) => ({
    replaceTarget: code.parentElement ?? code,
    source: code.textContent ?? '',
  }));
  const rendered = Array.from(
    root.querySelectorAll<HTMLElement>(
      '.kb-mermaid[data-mermaid-source], .kb-mermaid-error[data-mermaid-source]',
    ),
  ).map((element) => ({
    replaceTarget: element,
    source: element.dataset.mermaidSource ?? '',
  }));
  return [...codeBlocks, ...rendered];
}

export async function renderMermaidDiagrams(
  root: ParentNode,
  api: MermaidApi,
  themeVariables: MermaidThemeVariables,
): Promise<void> {
  const document =
    root.nodeType === 9
      ? (root as Document)
      : (root.ownerDocument ?? globalThis.document);
  api.initialize({
    flowchart: { htmlLabels: false },
    securityLevel: 'strict',
    startOnLoad: false,
    theme: 'base',
    themeVariables,
  });

  for (const { replaceTarget, source } of sourceNodes(root)) {
    try {
      await api.parse(source);
    } catch {
      replaceTarget.replaceWith(
        createErrorBlock(document, source, 'Diagram could not be rendered.'),
      );
      continue;
    }

    const container = document.createElement('div');
    container.className = 'mermaid kb-mermaid';
    container.dataset.mermaidSource = source;
    container.textContent = source;
    replaceTarget.replaceWith(container);
    try {
      await api.run({ nodes: [container], suppressErrors: true });
      if (!container.querySelector('svg')) {
        throw new Error('Mermaid did not produce an SVG.');
      }
    } catch {
      container.replaceWith(
        createErrorBlock(document, source, 'Diagram could not be rendered.'),
      );
    }
  }
}
