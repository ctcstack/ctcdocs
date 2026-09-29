import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/*
 * The interface reads the platform's own `--kb-*` tokens, and Starlight's
 * `--sl-*` ones are assigned from them in one block of styles.css (see its
 * adapter section and docs/DESIGN.md). A component that reads `--sl-*` still
 * renders the same, because the adapter keeps them defined, so nothing but
 * this test notices the coupling coming back.
 *
 * `config.ts` is outside the rule: it is Starlight's configuration, and its
 * Expressive Code overrides keep Starlight's names on purpose.
 */
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const STARLIGHT_TOKEN = /--_*sl-[a-z0-9]/u;
const STARLIGHT_TOKEN_READ = /var\(\s*--_*sl-[a-z0-9]/u;
const ADAPTER_START =
  '/* --------------------------------------------------------------- adapter */';

function sources(directory: string, extensions: readonly string[]): string[] {
  return readdirSync(join(packageRoot, directory), { recursive: true })
    .map(String)
    .filter(
      (file) =>
        extensions.some((extension) => file.endsWith(extension)) &&
        !file.endsWith('.test.ts'),
    )
    .map((file) => join(packageRoot, directory, file));
}

function offendingLines(file: string, pattern: RegExp): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      pattern.test(line)
        ? [`${relative(packageRoot, file)}:${index + 1}: ${line.trim()}`]
        : [],
    );
}

describe('the design-token boundary', () => {
  it('keeps Starlight token names out of components, routes and scripts', () => {
    const files = [
      ...sources('components', ['.astro', '.ts']),
      ...sources('routes', ['.astro', '.ts']),
      ...sources('scripts', ['.ts']),
      ...sources('lib', ['.ts']),
    ];

    expect(files.length).toBeGreaterThan(0);
    expect(
      files.flatMap((file) => offendingLines(file, STARLIGHT_TOKEN)),
    ).toEqual([]);
  });

  it('reads Starlight tokens in styles.css only inside the adapter', () => {
    const stylesheet = readFileSync(join(packageRoot, 'styles.css'), 'utf8');
    const start = stylesheet.indexOf(ADAPTER_START);
    expect(start).toBeGreaterThan(0);
    // The adapter ends where the next section's banner begins.
    const end = stylesheet.indexOf('/* ----', start + ADAPTER_START.length);
    expect(end).toBeGreaterThan(start);

    const outside = `${stylesheet.slice(0, start)}${stylesheet.slice(end)}`;
    const reads = outside
      .split('\n')
      .filter((line) => STARLIGHT_TOKEN_READ.test(line))
      .map((line) => line.trim());
    expect(reads).toEqual([]);
  });
});
