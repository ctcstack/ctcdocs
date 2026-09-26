import { describe, expect, it } from 'vitest';

import {
  GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
  GOOGLE_DRIVE_FOLDER_MIME_TYPE,
  type DriveItem,
} from './google/drive-types.js';
import { buildInventorySelection } from './inventory/inventory-graph.js';
import { findNameScriptIssues } from './name-scripts.js';

function item(
  id: string,
  name: string,
  parent: string,
  mimeType = GOOGLE_DRIVE_DOCUMENT_MIME_TYPE,
): DriveItem {
  return {
    id,
    name,
    mimeType,
    parents: [parent],
    modifiedTime: '2026-01-01T00:00:00.000Z',
    createdTime: '2026-01-01T00:00:00.000Z',
    trashed: false,
  };
}

function issuesFor(
  names: readonly string[],
  nameScripts: readonly string[] | null = null,
) {
  const items = [
    item('root', 'Опубликовано', 'drive', GOOGLE_DRIVE_FOLDER_MIME_TYPE),
    ...names.map((name, index) => item(`doc-${index}`, name, 'root')),
  ];
  return findNameScriptIssues(
    buildInventorySelection(items, 'root', [], ['drive']),
    nameScripts,
  );
}

describe('letters from the wrong alphabet in Drive names', () => {
  it('reports a Cyrillic letter typed into a Latin word', () => {
    // The first letter is CYRILLIC CAPITAL LETTER ES, on the key of Latin C.
    expect(issuesFor(['Сompany handbook'])).toEqual([
      {
        code: 'mixed_script_name',
        itemId: 'doc-0',
        detail: 'U+0421 Cyrillic at character 1',
      },
    ]);
  });

  it('reports a Latin letter typed into a Cyrillic word', () => {
    // The fourth letter is LATIN SMALL LETTER O.
    expect(issuesFor(['Отчoт за квартал'])).toEqual([
      {
        code: 'mixed_script_name',
        itemId: 'doc-0',
        detail: 'U+006F Latin at character 4',
      },
    ]);
  });

  it('counts positions in characters, prefixes and spaces included', () => {
    expect(issuesFor(['01 — Tеam notes'])[0]?.detail).toBe(
      'U+0435 Cyrillic at character 7',
    );
  });

  it('lets the rest of the name decide which letter is the stray', () => {
    expect(issuesFor(['Сt handbook'])[0]?.detail).toBe(
      'U+0421 Cyrillic at character 1',
    );
    expect(issuesFor(['Сt справочник'])[0]?.detail).toBe(
      'U+0074 Latin at character 2',
    );
  });

  it('names at most three letters of one item', () => {
    expect(issuesFor(['Нandbооk еdition'])[0]?.detail).toBe(
      'U+041D Cyrillic at character 1, U+043E Cyrillic at character 6, U+043E Cyrillic at character 7, 1 more',
    );
  });

  it('accepts a name in one script, whichever it is', () => {
    expect(
      issuesFor([
        'Company handbook',
        'Рабочие заметки',
        'Οδηγός χρήσης',
        'Café menu',
        '会議の記録',
      ]),
    ).toEqual([]);
  });

  it('accepts words of different scripts side by side', () => {
    expect(
      issuesFor([
        'Настройка SEO-продвижения',
        'API для партнёров',
        'Guide: Москва office',
      ]),
    ).toEqual([]);
  });

  it('checks folders as well as documents, but not the root', () => {
    const items = [
      item('root', 'Pubлished', 'drive', GOOGLE_DRIVE_FOLDER_MIME_TYPE),
      item('folder', 'Тeam', 'root', GOOGLE_DRIVE_FOLDER_MIME_TYPE),
      item('doc', 'Notes', 'folder'),
    ];
    expect(
      findNameScriptIssues(
        buildInventorySelection(items, 'root', [], ['drive']),
        null,
      ).map((issue) => issue.itemId),
    ).toEqual(['folder']);
  });

  it('skips what an ignored folder holds', () => {
    const items = [
      item('root', 'Published', 'drive', GOOGLE_DRIVE_FOLDER_MIME_TYPE),
      item('drafts', 'Drafts', 'root', GOOGLE_DRIVE_FOLDER_MIME_TYPE),
      item('doc', 'Тeam draft', 'drafts'),
    ];
    expect(
      findNameScriptIssues(
        buildInventorySelection(items, 'root', ['drafts'], ['drive']),
        null,
      ),
    ).toEqual([]);
  });

  describe('when the project names the scripts it writes in', () => {
    it('reports a whole word typed on the other layout', () => {
      // Every letter of the first word is Cyrillic, so the word is not mixed.
      expect(issuesFor(['СТС team notes'], ['Latin'])).toEqual([
        {
          code: 'disallowed_name_script',
          itemId: 'doc-0',
          detail:
            'U+0421 Cyrillic at character 1, U+0422 Cyrillic at character 2, U+0421 Cyrillic at character 3',
        },
      ]);
      expect(issuesFor(['СТС team notes'])).toEqual([]);
    });

    it('reports a letter of any other script', () => {
      expect(issuesFor(['Team 会議'], ['Latin'])[0]).toMatchObject({
        code: 'disallowed_name_script',
        detail: 'U+4F1A Han at character 6, U+8B70 Han at character 7',
      });
    });

    it('accepts accented letters, digits and punctuation', () => {
      expect(
        issuesFor(['01 — Café & résumé (2026): Q3/Q4 — v2.1'], ['Latin']),
      ).toEqual([]);
    });

    it('still reports a word that mixes two allowed scripts', () => {
      expect(
        issuesFor(['Сompany справочник'], ['Latin', 'Cyrillic'])[0]?.code,
      ).toBe('mixed_script_name');
    });

    it('reports each item once, with the stricter code', () => {
      expect(issuesFor(['Сompany handbook'], ['Latin'])).toEqual([
        {
          code: 'disallowed_name_script',
          itemId: 'doc-0',
          detail: 'U+0421 Cyrillic at character 1',
        },
      ]);
    });
  });
});
