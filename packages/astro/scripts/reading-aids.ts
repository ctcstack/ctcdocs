/**
 * Small aids for reading long pages, all progressive: without this script a
 * page reads exactly as Starlight renders it.
 *
 * - The sidebar opens scrolled to the current page.
 * - The contents list keeps the heading being read in view.
 * - A screenshot shown smaller than it is opens full size on click.
 * - A long page offers a way back to the top.
 */

const WIDE = '(min-width: 50em)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function scrollBehavior(): ScrollBehavior {
  return matchMedia(REDUCED_MOTION).matches ? 'auto' : 'smooth';
}

/** Where `element` sits inside the scrolling `container`, in its own pixels. */
function offsetWithin(container: HTMLElement, element: HTMLElement): number {
  return (
    element.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop
  );
}

function isInView(container: HTMLElement, element: HTMLElement): boolean {
  const box = container.getBoundingClientRect();
  const item = element.getBoundingClientRect();
  return item.top >= box.top && item.bottom <= box.bottom;
}

/** Centres `element` in `container` when it is out of view. */
function bringIntoView(
  container: HTMLElement,
  element: HTMLElement,
  behavior: ScrollBehavior,
): void {
  if (isInView(container, element)) {
    return;
  }
  const top =
    offsetWithin(container, element) -
    (container.clientHeight - element.offsetHeight) / 2;
  container.scrollTo({ top: Math.max(0, top), behavior });
}

/*
 * Starlight restores the sidebar's scroll position within a session; this
 * steps in only when the current page is still out of view after that, as on
 * a page opened from a link.
 */
function revealCurrentPage(): void {
  if (!matchMedia(WIDE).matches) {
    return;
  }
  const sidebar = document.getElementById('starlight__sidebar');
  const current = sidebar?.querySelector<HTMLElement>('a[aria-current="page"]');
  if (sidebar && current) {
    bringIntoView(sidebar, current, 'auto');
  }
}

/*
 * Starlight marks the heading being read with `aria-current` but does not
 * scroll the list, which on a long document is taller than the screen.
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
      if (
        link.getAttribute('aria-current') === 'true' &&
        link.offsetParent !== null
      ) {
        bringIntoView(rail, link, scrollBehavior());
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

/** The button appears once the reader is this many screens down. */
const BACK_TO_TOP_AFTER = 2;

function backToTop(): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'kb-back-to-top';
  button.hidden = true;
  button.setAttribute('aria-label', 'Back to top');
  button.title = 'Back to top';
  button.innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';
  button.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
    // Keyboard focus follows the reader back to the start of the page.
    const title = document.querySelector<HTMLElement>('#_top, main h1');
    if (title) {
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    }
  });
  document.body.append(button);

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
followContents();
enlargeableImages();
backToTop();
