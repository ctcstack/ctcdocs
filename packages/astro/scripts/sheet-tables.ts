/**
 * Makes a spreadsheet's tables easier to read on its page (ADR-046).
 *
 * The page is built with every row in it, which is what search indexes and
 * what a reader without JavaScript sees. In the browser each table then keeps
 * its header row in view while it scrolls, a long one gets a field that hides
 * the rows not matching what is typed, and every column sorts by a click on
 * its header. Nothing here changes what the page says.
 */

import { compareCells } from './sheet-values';

/** Rows above which a table gets a filter field and a height of its own. */
const FILTER_ROWS = 10;

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function addFilter(wrapper: HTMLElement, rows: HTMLTableRowElement[]): void {
  const tools = document.createElement('div');
  tools.className = 'kb-sheet-tools';
  const label = document.createElement('label');
  label.className = 'kb-sheet-filter';
  const caption = document.createElement('span');
  caption.textContent = 'Filter rows';
  const input = document.createElement('input');
  input.type = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  label.append(caption, input);
  const status = document.createElement('span');
  status.className = 'kb-sheet-count';
  status.setAttribute('role', 'status');
  status.textContent = plural(rows.length, 'row');
  tools.append(label, status);
  wrapper.before(tools);

  const texts = rows.map((row) => (row.textContent ?? '').toLocaleLowerCase());
  input.addEventListener('input', () => {
    const query = input.value.trim().toLocaleLowerCase();
    let shown = 0;
    rows.forEach((row, index) => {
      const match = !query || (texts[index] ?? '').includes(query);
      row.hidden = !match;
      if (match) shown += 1;
    });
    status.textContent = query
      ? `${shown} of ${plural(rows.length, 'row')}`
      : plural(rows.length, 'row');
  });
}

function makeSortable(
  table: HTMLTableElement,
  body: HTMLTableSectionElement,
): void {
  const headers = [...(table.tHead?.rows[0]?.cells ?? [])];
  headers.forEach((header, column) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kb-sheet-sort';
    button.append(...header.childNodes);
    if (!button.textContent?.trim()) {
      button.setAttribute('aria-label', `Column ${column + 1}`);
    }
    const icon = document.createElement('span');
    icon.className = 'kb-sheet-sort-icon';
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);
    header.append(button);

    button.addEventListener('click', () => {
      const direction =
        header.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
      for (const other of headers) other.removeAttribute('aria-sort');
      header.setAttribute(
        'aria-sort',
        direction === 1 ? 'ascending' : 'descending',
      );
      const rows = [...body.rows];
      rows.sort((left, right) =>
        compareCells(
          left.cells[column]?.textContent ?? '',
          right.cells[column]?.textContent ?? '',
          direction,
        ),
      );
      body.append(...rows);
    });
  });
}

class SheetTables extends HTMLElement {
  connectedCallback() {
    for (const wrapper of this.querySelectorAll<HTMLElement>('.kb-table')) {
      const table = wrapper.querySelector('table');
      const body = table?.tBodies[0];
      if (!table || !body || wrapper.dataset['sheet']) continue;
      wrapper.dataset['sheet'] = 'ready';
      const rows = [...body.rows];
      if (rows.length > FILTER_ROWS) {
        wrapper.classList.add('kb-sheet-tall');
        addFilter(wrapper, rows);
      }
      if (rows.length > 1) makeSortable(table, body);
    }
  }
}

if (!customElements.get('sheet-tables')) {
  customElements.define('sheet-tables', SheetTables);
}
