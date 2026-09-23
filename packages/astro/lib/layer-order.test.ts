import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { STARLIGHT_LAYER_ORDER } from './layer-order.js';

describe('STARLIGHT_LAYER_ORDER', () => {
  it('matches the statement the installed Starlight declares', async () => {
    const require = createRequire(import.meta.url);
    const starlightRoot = path.dirname(require.resolve('@astrojs/starlight'));
    const declared = await readFile(
      path.join(starlightRoot, 'style', 'layers.css'),
      'utf8',
    );

    expect(declared.trim()).toBe(STARLIGHT_LAYER_ORDER);
  });
});
