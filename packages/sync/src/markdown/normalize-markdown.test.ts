import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  MarkdownNormalizationError,
  normalizeMarkdown,
} from './normalize-markdown.js';

const fixturePath = new URL(
  '../../fixtures/markdown/basic.md',
  import.meta.url,
);

describe('Markdown normalization', () => {
  it('removes a matching first H1, demotes other H1s, and is idempotent', async () => {
    const input = await readFile(fixturePath);
    const first = normalizeMarkdown(input, 'Architecture');
    const second = normalizeMarkdown(first.body, 'Architecture');

    expect(first.body).not.toContain('# 01 - Architecture');
    expect(first.body).toContain('## Operational notes');
    expect(first.body).toContain('- first');
    expect(first.body).toContain('* second');
    expect(first.body).toContain('```text\nline with *literal* _content_\n```');
    expect(first.description).toBe(
      'This is a sanitized introductory paragraph with a safe link.',
    );
    expect(second).toEqual(first);
  });

  it('demotes a non-matching leading H1 and accepts safe relative URLs', () => {
    const result = normalizeMarkdown(
      '# Different\n\n[Local](../guide)\n',
      'Expected',
    );
    expect(result.body).toBe('## Different\n\n[Local](../guide)\n');
  });

  it('returns no description for empty content and truncates long paragraphs', () => {
    expect(normalizeMarkdown('', 'Empty')).toEqual({ body: '', warnings: [] });
    const result = normalizeMarkdown(`${'word '.repeat(60)}\n`, 'Long');
    expect(result.description?.endsWith('…')).toBe(true);
    expect(result.description?.length).toBeLessThanOrEqual(201);
  });

  it('restores escaped code from a Google Docs export end to end', async () => {
    const input = await readFile(
      new URL('../../fixtures/markdown/google-code.md', import.meta.url),
      'utf8',
    );
    const first = normalizeMarkdown(input, 'Deployment notes');
    const second = normalizeMarkdown(first.body, 'Deployment notes');

    expect(first.body).toContain(
      '```ts\nconst value = "<unsafe>";\n  console.log(value);\n```',
    );
    expect(first.body).toContain(
      '```mermaid\nflowchart LR\n  Drive --> Markdown\n```',
    );
    expect(first.body).toContain('run `pnpm verify` before');
    expect(first.warnings).toEqual(['unterminated_code_fence']);
    expect(second.body).toBe(first.body);
  });

  it.each([
    ['<script>alert(1)</script>', 'unsupported_html'],
    ['![image](https://example.com/a.png)', 'unsupported_image'],
    ['[unsafe](javascript:alert(1))', 'unsafe_url'],
    ['[unsafe](//example.com/path)', 'unsafe_url'],
  ])('rejects unsupported or unsafe input', (input, issue) => {
    try {
      normalizeMarkdown(input, 'Title');
      expect.unreachable('Expected normalization to fail');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(MarkdownNormalizationError);
      expect((error as MarkdownNormalizationError).issues).toContainEqual({
        code: issue,
      });
    }
  });

  it('only permits generated local images in HTML fallback output', () => {
    expect(
      normalizeMarkdown(
        '![safe](../../../assets/generated/document/image-001.png)\n',
        'Title',
        { allowImages: true },
      ).body,
    ).toContain('../../../assets/generated/document/image-001.png');
    expect(() =>
      normalizeMarkdown('![unsafe](https://example.com/image.png)\n', 'Title', {
        allowImages: true,
      }),
    ).toThrow(MarkdownNormalizationError);
  });
});
