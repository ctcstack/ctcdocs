import {
  type MermaidThemeVariables,
  renderMermaidDiagrams,
} from './mermaid-renderer.js';

const SELECTOR =
  'pre > code.language-mermaid, .kb-mermaid[data-mermaid-source], .kb-mermaid-error[data-mermaid-source]';

let rendering = false;

/**
 * Reads the diagram palette from the live theme tokens, so a diagram follows
 * the light and dark grounds without a second colour system to keep in step.
 */
function themeVariables(): MermaidThemeVariables {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string): string => styles.getPropertyValue(name).trim();
  const ground = token('--sl-color-bg');
  const surface = token('--kb-surface-sunken');
  const hairline = token('--sl-color-hairline');
  const line = token('--kb-border-strong');

  return {
    /*
     * Mermaid derives the colours it was not given by lightening or darkening
     * the ones it was, and it picks the direction from this flag rather than
     * from the values. Without it a dark ground yields light node fills under
     * light text.
     */
    darkMode: document.documentElement.dataset.theme !== 'light',
    background: ground,
    mainBkg: surface,
    primaryColor: surface,
    primaryBorderColor: line,
    primaryTextColor: token('--sl-color-white'),
    secondaryColor: surface,
    secondaryBorderColor: line,
    tertiaryColor: ground,
    tertiaryBorderColor: hairline,
    nodeBorder: line,
    clusterBkg: ground,
    clusterBorder: hairline,
    lineColor: line,
    textColor: token('--sl-color-text'),
    nodeTextColor: token('--sl-color-white'),
    titleColor: token('--sl-color-white'),
    edgeLabelBackground: ground,
    fontFamily: `${token('--sl-font')}, ui-sans-serif, system-ui, sans-serif`,
    fontSize: '14px',
  };
}

async function render(): Promise<void> {
  if (rendering || !document.querySelector(SELECTOR)) {
    return;
  }
  rendering = true;
  try {
    const { default: mermaid } = await import('mermaid');
    await renderMermaidDiagrams(document, mermaid, themeVariables());
  } finally {
    rendering = false;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void render(), {
    once: true,
  });
} else {
  void render();
}

new MutationObserver((mutations) => {
  if (
    mutations.some(
      (mutation) =>
        mutation.type === 'attributes' &&
        mutation.attributeName === 'data-theme',
    )
  ) {
    void render();
  }
}).observe(document.documentElement, {
  attributeFilter: ['data-theme'],
  attributes: true,
});
