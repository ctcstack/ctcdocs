import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { restoreCodeFences, UNTERMINATED_CODE_FENCE } from './restore-code.js';

const fixturePath = new URL(
  '../../fixtures/markdown/google-code.md',
  import.meta.url,
);

describe('Google Docs code fence restoration', () => {
  it('rebuilds fences from an escaped export and is idempotent', async () => {
    const source = await readFile(fixturePath, 'utf8');
    const first = restoreCodeFences(source);
    const second = restoreCodeFences(first.markdown);

    expect(first.markdown).toContain(
      '```ts\nconst value = "<unsafe>";\n  console.log(value);\n```',
    );
    expect(first.markdown).toContain('```bash\npnpm sync --full\n```');
    expect(first.markdown).toContain(
      '```mermaid\nflowchart LR\n  Drive --> Markdown\n```',
    );
    expect(second.markdown).toBe(first.markdown);
  });

  it('reports an unterminated fence and leaves it as prose', async () => {
    const source = await readFile(fixturePath, 'utf8');
    const result = restoreCodeFences(source);

    expect(result.warnings).toEqual([UNTERMINATED_CODE_FENCE]);
    expect(result.markdown).toContain('\\`\\`\\`text');
    expect(result.markdown).toContain('this line stays prose');
  });

  it('accepts the two-space hard break the export may use instead', () => {
    const result = restoreCodeFences(
      'Sample:  \n\\`\\`\\`js  \n  const a \\= 1;  \n\\`\\`\\`\n',
    );

    expect(result.markdown).toContain('```js\n  const a = 1;\n```');
  });

  it('returns the source unchanged when no fence is present', () => {
    const source = '# Title\n\nProse with \\`inline\\` text.\n\n| a | b |\n';

    expect(restoreCodeFences(source)).toEqual({
      markdown: source,
      warnings: [],
    });
  });

  it('leaves a genuine fenced block alone', () => {
    const source = 'Intro\n\n```ts\nconst a = 1;\n```\n\nOutro\n';

    expect(restoreCodeFences(source).markdown).toBe(source);
  });

  it('drops an unusable language tag but keeps the block', () => {
    const result = restoreCodeFences(
      'Sample:\\\n\\`\\`\\`123 not a language\\\ncode line\\\n\\`\\`\\`\n',
    );

    expect(result.markdown).toContain('```\ncode line\n```');
  });

  it('widens the fence when the code contains a backtick run', () => {
    const result = restoreCodeFences(
      'Sample:\\\n\\`\\`\\`text\\\nuse \\`\\`\\` to open a block\\\n\\`\\`\\`\n',
    );

    expect(result.markdown).toContain(
      '````text\nuse ``` to open a block\n````',
    );
  });

  it('abandons a fence that would have to cross a list', () => {
    const source = 'Intro\\\n\\`\\`\\`ts\\\ncode\n\n- item\n\n\\`\\`\\`\n';
    const result = restoreCodeFences(source);

    expect(result.markdown).toBe(source);
    expect(result.warnings).toEqual([UNTERMINATED_CODE_FENCE]);
  });
});
