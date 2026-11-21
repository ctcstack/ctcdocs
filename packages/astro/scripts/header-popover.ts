/**
 * The header's two menus, the site switcher (SiteSwitcher.astro) and the
 * account menu (HeaderActions.astro), are popovers: the browser opens and
 * closes them from their button, closes them on Escape or a click elsewhere,
 * keeps the button's expanded state, and draws them above everything. The
 * site title clips its overflow, so a menu drawn inside it any other way would
 * be cut off.
 *
 * What the browser does not do everywhere yet is place a popover beside its
 * button, so this does: under the button, aligned to its start or its end
 * edge, and kept inside the window on a narrow screen.
 */

const GAP_PX = 6;
const MARGIN_PX = 8;

export function anchorPopover(
  button: HTMLElement,
  panel: HTMLElement,
  align: 'start' | 'end',
): void {
  /*
   * Placed before it shows, from the button alone: a closed popover has no
   * width to measure, and placing it after it opens would draw one frame of
   * it in the window's corner.
   */
  const place = (): void => {
    const box = button.getBoundingClientRect();
    const room = document.documentElement.clientWidth;
    panel.style.top = `${Math.round(box.bottom + GAP_PX)}px`;
    if (align === 'start') {
      panel.style.left = `${Math.round(Math.max(MARGIN_PX, box.left))}px`;
      panel.style.right = 'auto';
    } else {
      panel.style.right = `${Math.round(Math.max(MARGIN_PX, room - box.right))}px`;
      panel.style.left = 'auto';
    }
  };
  // Once it has a width, it is moved back inside the window if it spills out.
  const contain = (): void => {
    const room = document.documentElement.clientWidth;
    const shown = panel.getBoundingClientRect();
    if (shown.right > room - MARGIN_PX || shown.left < MARGIN_PX) {
      const left = Math.max(
        MARGIN_PX,
        Math.min(shown.left, room - shown.width - MARGIN_PX),
      );
      panel.style.left = `${Math.round(left)}px`;
      panel.style.right = 'auto';
    }
  };
  panel.addEventListener('beforetoggle', (event) => {
    if ((event as ToggleEvent).newState === 'open') {
      place();
    }
  });
  panel.addEventListener('toggle', (event) => {
    if ((event as ToggleEvent).newState === 'open') {
      contain();
    }
  });
  // The window changing size moves the button; the menu follows it.
  window.addEventListener('resize', () => {
    if (panel.matches(':popover-open')) {
      place();
      contain();
    }
  });
}
