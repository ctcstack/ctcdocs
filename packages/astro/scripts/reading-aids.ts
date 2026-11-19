/**
 * Small aids for reading long pages, all progressive: without this script a
 * page reads exactly as Starlight renders it.
 *
 * - The sidebar opens scrolled to the current page.
 * - The contents list keeps the heading being read in view.
 * - A screenshot shown smaller than it is opens full size on click.
 * - A long page offers a way back to the top.
 */
import { SIDEBAR_SHOWN_EVENT } from '../lib/sidebar-state';

const WIDE = '(min-width: 50em)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function scrollBehavior(): ScrollBehavior {
  return matchMedia(REDUCED_MOTION).matches ? 'auto' : 'smooth';
}

/** Whether the element is drawn at all: not hidden, nor in a closed folder. */
function isRendered(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

/**
 * Centres `element` in the part of `container` a reader can see, below
 * `inset` pixels covered at its top, when it is out of that part.
 */
function bringIntoView(
  container: HTMLElement,
  element: HTMLElement,
  inset: number,
  behavior: ScrollBehavior,
): void {
  if (!isRendered(container) || !isRendered(element)) {
    return;
  }
  const box = container.getBoundingClientRect();
  const item = element.getBoundingClientRect();
  const top = box.top + inset;
  if (item.top >= top && item.bottom <= box.bottom) {
    return;
  }
  const visible = box.bottom - top;
  const target =
    item.top - top + container.scrollTop - (visible - item.height) / 2;
  container.scrollTo({ top: Math.max(0, target), behavior });
}

/*
 * Starlight restores the sidebar's scroll position within a session; this
 * steps in only when the current page is still out of view after that, as on
 * a page opened from a link, or when a hidden sidebar is shown again. The
 * sidebar filter sticks to the top of the pane and covers what is under it.
 */
function revealCurrentPage(): void {
  if (!matchMedia(WIDE).matches) {
    return;
  }
  const sidebar = document.getElementById('starlight__sidebar');
  const current = sidebar?.querySelector<HTMLElement>('a[aria-current="page"]');
  if (!sidebar || !current) {
    return;
  }
  const filter = sidebar.querySelector<HTMLElement>('.kb-sidebar-filter');
  const inset =
    filter && isRendered(filter)
      ? filter.getBoundingClientRect().bottom -
        sidebar.getBoundingClientRect().top
      : 0;
  bringIntoView(sidebar, current, Math.max(0, inset), 'auto');
}

/*
 * Starlight marks the heading being read with `aria-current` but does not
 * scroll the list, which on a long document is taller than the screen. The
 * rail runs under the fixed header and pads its top by the header's height.
 */
function followContents(): void {
  const rail = document.querySelector<HTMLElement>('.right-sidebar');
  const contents = rail?.querySelector('starlight-toc');
  if (!rail || !contents) {
    return;
  }
  new MutationObserver((records) => {
    for (const record of records) {
      const link = record.target as HTMLElement;
      // The rail also holds a collapsed copy of the list, which is skipped.
      if (link.getAttribute('aria-current') === 'true' && isRendered(link)) {
        const inset = parseFloat(getComputedStyle(rail).paddingTop) || 0;
        bringIntoView(rail, link, inset, scrollBehavior());
      }
    }
  }).observe(contents, {
    attributeFilter: ['aria-current'],
    subtree: true,
  });
}

let zoomDialog: HTMLDialogElement | undefined;

function openZoom(image: HTMLImageElement): void {
  if (!zoomDialog) {
    zoomDialog = document.createElement('dialog');
    zoomDialog.className = 'kb-zoom-dialog';
    zoomDialog.setAttribute('aria-label', 'Enlarged image');
    zoomDialog.append(document.createElement('img'));
    // Any click closes it, as Escape does: there is nothing else to do here.
    zoomDialog.addEventListener('click', () => zoomDialog?.close());
    document.body.append(zoomDialog);
  }
  const enlarged = zoomDialog.querySelector('img');
  if (enlarged) {
    enlarged.src = image.currentSrc || image.src;
    enlarged.alt = image.alt;
  }
  zoomDialog.showModal();
}

/** A screenshot drawn at least this much smaller than its file opens. */
const ZOOM_GAIN = 1.15;

function offerZoom(image: HTMLImageElement): void {
  if (
    image.closest('a, button') ||
    image.naturalWidth < image.clientWidth * ZOOM_GAIN
  ) {
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'kb-zoom';
  button.setAttribute(
    'aria-label',
    image.alt ? `Enlarge image: ${image.alt}` : 'Enlarge image',
  );
  image.replaceWith(button);
  button.append(image);
  button.addEventListener('click', () => openZoom(image));
}

function enlargeableImages(): void {
  for (const image of document.querySelectorAll<HTMLImageElement>(
    '.sl-markdown-content img',
  )) {
    if (image.complete) {
      offerZoom(image);
    } else {
      image.addEventListener('load', () => offerZoom(image), { once: true });
    }
  }
}

const SVG = 'http://www.w3.org/2000/svg';

/** An upward arrow, drawn to the icon rule: 16×16, 1.5 stroke, 1em. */
function arrowUpIcon(): SVGSVGElement {
  const icon = document.createElementNS(SVG, 'svg');
  for (const [name, value] of Object.entries({
    'aria-hidden': 'true',
    viewBox: '0 0 16 16',
    width: '1em',
    height: '1em',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  })) {
    icon.setAttribute(name, value);
  }
  for (const d of ['M8 13V3', 'M3.5 7.5 8 3l4.5 4.5']) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    icon.append(path);
  }
  return icon;
}

/** The button appears once the reader is this many screens down. */
const BACK_TO_TOP_AFTER = 2;

function backToTop(): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'kb-back-to-top';
  button.hidden = true;
  button.setAttribute('aria-label', 'Back to top');
  button.title = 'Back to top';
  button.append(arrowUpIcon());
  button.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
    // Keyboard focus follows the reader back to the start of the page.
    const title = document.querySelector<HTMLElement>('#_top, main h1');
    if (title) {
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    }
  });
  /*
   * Inside the main frame, which Starlight makes inert while the phone menu
   * is open, and below the menu's layer: the open menu covers it.
   */
  (document.querySelector('.main-frame') ?? document.body).append(button);

  let pending = false;
  const update = (): void => {
    pending = false;
    button.hidden = window.scrollY < window.innerHeight * BACK_TO_TOP_AFTER;
  };
  window.addEventListener(
    'scroll',
    () => {
      if (!pending) {
        pending = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  update();
}

revealCurrentPage();
document.addEventListener(SIDEBAR_SHOWN_EVENT, revealCurrentPage);
followContents();
enlargeableImages();
backToTop();
