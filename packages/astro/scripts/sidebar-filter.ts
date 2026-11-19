/**
 * The sidebar filter (components/Sidebar.astro).
 *
 * A document stays when every word typed appears in its title or in the name
 * of a folder above it, so "seo guide" finds the guides in the SEO folder.
 * Folders holding a match open; the rest of the tree hides. Clearing the
 * field puts every folder back as the reader left it. Enter opens the first
 * match, Escape clears, and `/` reaches the field from anywhere on the page.
 */

const field = document.querySelector<HTMLInputElement>('#kb-sidebar-filter');
const wrapper = field?.closest<HTMLElement>('.kb-sidebar-filter');
const statusLine = document.getElementById('kb-sidebar-filter-status');
const tree = document.querySelector<HTMLElement>(
  '#starlight__sidebar ul.top-level',
);

/** Lower case, without accents, so "resume" finds "Résumé". */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

function labelOf(element: Element | null): string {
  return normalize(element?.textContent ?? '');
}

/** The open state of every folder before the reader started typing. */
let saved: Map<HTMLDetailsElement, boolean> | undefined;
/** Folders the reader opened or closed by hand while filtering keep that. */
const touched = new Set<HTMLDetailsElement>();

function items(list: Element): HTMLLIElement[] {
  return [...list.children].filter(
    (child): child is HTMLLIElement => child instanceof HTMLLIElement,
  );
}

/** Filters one list; returns how many documents it keeps. */
function filterList(list: Element, context: string, terms: string[]): number {
  let kept = 0;
  for (const item of items(list)) {
    const details = item.querySelector<HTMLDetailsElement>(':scope > details');
    if (details) {
      const name = labelOf(
        details.querySelector(':scope > summary .group-label .large'),
      );
      const nested = details.querySelector(':scope > ul');
      const found = nested
        ? filterList(nested, `${context} ${name}`, terms)
        : 0;
      item.hidden = found === 0;
      if (found > 0) {
        details.open = true;
      }
      kept += found;
      continue;
    }
    const link = item.querySelector(':scope > a');
    const text = `${context} ${labelOf(link?.querySelector(':scope > span') ?? link)}`;
    const match = terms.every((term) => text.includes(term));
    item.hidden = !match;
    if (match) {
      kept += 1;
    }
  }
  return kept;
}

function clearList(list: Element): void {
  for (const item of list.querySelectorAll('li')) {
    item.hidden = false;
  }
}

function apply(): void {
  if (!field || !tree || !statusLine) {
    return;
  }
  const terms = normalize(field.value).split(' ').filter(Boolean);
  if (terms.length === 0) {
    clearList(tree);
    for (const [details, open] of saved ?? []) {
      if (!touched.has(details)) {
        details.open = open;
      }
    }
    saved = undefined;
    touched.clear();
    statusLine.textContent = '';
    return;
  }
  saved ??= new Map(
    [...tree.querySelectorAll('details')].map((details) => [
      details,
      details.open,
    ]),
  );
  const kept = filterList(tree, '', terms);
  statusLine.textContent =
    kept === 0
      ? 'No document matches.'
      : `${kept} ${kept === 1 ? 'document' : 'documents'}`;
}

/*
 * Drawn and visible: a closed phone menu hides the sidebar with
 * `visibility`, which leaves its boxes in place.
 */
function isShown(element: HTMLElement): boolean {
  return (
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility === 'visible'
  );
}

function firstMatch(): HTMLAnchorElement | undefined {
  return [...(tree?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? [])].find(
    isShown,
  );
}

/** Keeps a key's release from reaching the menu, which closes on Escape. */
function swallowRelease(key: string): void {
  field?.addEventListener(
    'keyup',
    (event) => {
      if (event.key === key) {
        event.stopPropagation();
      }
    },
    { once: true },
  );
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches('input, textarea, select, [role="textbox"]'))
  );
}

if (field && wrapper && tree && statusLine) {
  wrapper.hidden = false;
  statusLine.textContent = '';
  field.addEventListener('input', apply);
  tree.addEventListener('click', (event) => {
    const details = (event.target as Element | null)
      ?.closest('summary')
      ?.closest('details');
    if (saved && details) {
      touched.add(details);
    }
  });
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && field.value) {
      event.preventDefault();
      swallowRelease('Escape');
      field.value = '';
      apply();
    } else if (event.key === 'Enter') {
      const link = firstMatch();
      if (link && field.value.trim()) {
        event.preventDefault();
        link.click();
      }
    }
  });
  document.addEventListener('keydown', (event) => {
    if (
      event.key !== '/' ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isTyping(event.target) ||
      // On a narrow screen the sidebar is a menu, which may be closed.
      !isShown(field)
    ) {
      return;
    }
    field.focus();
    // The key is taken only when it moved the reader to the field.
    if (document.activeElement === field) {
      event.preventDefault();
      field.select();
    }
  });
}
