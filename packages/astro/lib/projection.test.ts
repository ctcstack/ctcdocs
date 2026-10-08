import { describe, expect, it } from 'vitest';

import { hasMarkdownProjection } from './projection.js';

describe('Markdown projection', () => {
  it('belongs to synchronized documents, PDFs, spreadsheets and recordings', () => {
    expect(hasMarkdownProjection('google-doc')).toBe(true);
    expect(hasMarkdownProjection('drive-pdf')).toBe(true);
    expect(hasMarkdownProjection('drive-sheet')).toBe(true);
    expect(hasMarkdownProjection('drive-media')).toBe(true);
    expect(hasMarkdownProjection('section-index')).toBe(false);
    expect(hasMarkdownProjection('manual')).toBe(false);
    expect(hasMarkdownProjection(undefined)).toBe(false);
  });
});
