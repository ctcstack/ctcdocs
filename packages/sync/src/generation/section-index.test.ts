import { describe, expect, it } from 'vitest';

import {
  generateSectionIndexDocument,
  sectionIndexPath,
  type SectionIndexInput,
} from './section-index.js';
import { TEST_MARKDOWN_HEADER } from '../test-support/project-fixture.js';

function input(overrides: Partial<SectionIndexInput> = {}): SectionIndexInput {
  return {
    title: 'Team',
    slug: 'team',
    folderPath: [],
    entries: [],
    ...overrides,
  };
}

describe('section index pages', () => {
  it('names the file after the folder it describes', () => {
    expect(sectionIndexPath('folder-id')).toBe(
      'src/content/docs/_generated/section-folder-id.md',
    );
  });

  it('lists entries as links, with the description each one publishes', () => {
    const content = generateSectionIndexDocument(
      input({
        entries: [
          { label: 'Runbooks', slug: 'team/runbooks' },
          {
            label: 'Guide',
            slug: 'team/guide',
            description: 'How the thing is done.',
          },
        ],
      }),
      TEST_MARKDOWN_HEADER,
    );

    expect(content).toContain('- [Runbooks](/team/runbooks/)\n');
    expect(content).toContain(
      '- [Guide](/team/guide/) — How the thing is done.\n',
    );
  });

  it('says so when a folder has nothing in it', () => {
    expect(
      generateSectionIndexDocument(input(), TEST_MARKDOWN_HEADER),
    ).toContain('This section has no documents yet.');
  });

  it('carries the frontmatter the reader interface needs and no provenance', () => {
    const content = generateSectionIndexDocument(
      input({ folderPath: ['Company'], title: 'Team' }),
      TEST_MARKDOWN_HEADER,
    );

    expect(content).toContain('"title": "Team"');
    expect(content).toContain('"sourceType": "section-index"');
    expect(content).toContain('"pagefind": false');
    expect(content).toContain('- "Company"');
    expect(content).not.toContain('editUrl');
    expect(content).not.toContain('syncedAt');
  });

  it('produces the same bytes for the same section', () => {
    expect(generateSectionIndexDocument(input(), TEST_MARKDOWN_HEADER)).toBe(
      generateSectionIndexDocument(input(), TEST_MARKDOWN_HEADER),
    );
  });

  it('escapes a label that would otherwise open a link', () => {
    const content = generateSectionIndexDocument(
      input({
        entries: [{ label: 'Rates [2026]', slug: 'team/rates' }],
      }),
      TEST_MARKDOWN_HEADER,
    );

    expect(content).toContain('- [Rates \\[2026\\]](/team/rates/)');
  });
});
