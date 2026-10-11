import { describe, expect, it } from 'vitest';

import { agentOutline, HEADING_CHARACTERS } from './agent-outline.js';

describe('agentOutline', () => {
  it('lists each heading with where its line ends, its depth and words', () => {
    const text =
      '# Leave policy\n\nIntro.\n\n## Requests\n\nText.\n\n### **Who** [approves](/d/abc123/)\n\nMore.\n';
    expect(agentOutline(text, 'Leave policy')).toEqual([
      [text.indexOf('\n\nText'), 2, 'Requests'],
      [text.indexOf('\n\nMore'), 3, 'Who approves'],
    ]);
  });

  it('keeps a first-level heading that is not the title', () => {
    const text = '# Part one\n\nText.\n';
    expect(agentOutline(text, 'Handbook')).toEqual([
      [text.indexOf('\n\nText'), 1, 'Part one'],
    ]);
  });

  it('ignores a heading-like line inside code', () => {
    expect(agentOutline('```\n# not a heading\n```\n', 'Doc')).toEqual([]);
  });

  it('shortens a long heading without halving a character', () => {
    // The cut falls on an emoji, a pair of UTF-16 code units.
    const long = `${'é'.repeat(HEADING_CHARACTERS - 2)}🙂🙂🙂`;
    const [heading] = agentOutline(`## ${long}\n`, 'Doc');
    expect(heading?.[2]).toBe(`${'é'.repeat(HEADING_CHARACTERS - 2)}🙂…`);
  });
});
