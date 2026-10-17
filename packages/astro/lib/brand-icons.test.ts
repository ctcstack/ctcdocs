import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BRAND_ICO_PATH,
  BRAND_ICO_SIZES,
  BRAND_PNG_PATH,
  BRAND_PNG_SIZE,
  icoFromPngs,
  writeBrandIcons,
} from './brand-icons.js';

const MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#3366cc"/></svg>';

const roots: string[] = [];
async function project(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'brand-icons-'));
  roots.push(root);
  const publicRoot = join(root, 'public');
  const distRoot = join(root, 'dist');
  await mkdir(publicRoot);
  await mkdir(distRoot);
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(publicRoot, path.slice(1)), content);
  }
  return {
    publicRoot,
    distRoot,
    publicFiles: new Set(Object.keys(files)),
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** Width and height a PNG's header states. */
function pngSize(png: Buffer): [number, number] {
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe('icoFromPngs', () => {
  it('lists each image with its size and where it starts', () => {
    const ico = icoFromPngs([
      { size: 16, png: Buffer.from('aaaa') },
      { size: 256, png: Buffer.from('bbbbbb') },
    ]);
    expect([
      ico.readUInt16LE(0),
      ico.readUInt16LE(2),
      ico.readUInt16LE(4),
    ]).toEqual([0, 1, 2]);
    expect([
      ico[6],
      ico[7],
      ico.readUInt32LE(14),
      ico.readUInt32LE(18),
    ]).toEqual([16, 16, 4, 38]);
    expect([
      ico[22],
      ico[23],
      ico.readUInt32LE(30),
      ico.readUInt32LE(34),
    ]).toEqual([0, 0, 6, 42]);
    expect(ico.subarray(38).toString('latin1')).toBe('aaaabbbbbb');
  });
});

describe('writeBrandIcons', () => {
  it('renders the favicon as a PNG and an ICO, and lists every icon', async () => {
    const fixture = await project({
      '/brand.svg': MARK,
      '/brand-dark.svg': MARK,
    });
    const icons = await writeBrandIcons({
      ...fixture,
      faviconPath: '/brand.svg',
      faviconDarkPath: '/brand-dark.svg',
    });
    expect(icons).toEqual([
      {
        path: BRAND_PNG_PATH,
        type: 'image/png',
        sizes: [`${BRAND_PNG_SIZE}x${BRAND_PNG_SIZE}`],
      },
      { path: '/brand.svg', type: 'image/svg+xml', sizes: ['any'] },
      {
        path: '/brand-dark.svg',
        type: 'image/svg+xml',
        sizes: ['any'],
        theme: 'dark',
      },
      {
        path: BRAND_ICO_PATH,
        type: 'image/x-icon',
        sizes: BRAND_ICO_SIZES.map((size) => `${size}x${size}`),
      },
    ]);
    const png = await readFile(join(fixture.distRoot, BRAND_PNG_PATH.slice(1)));
    expect(pngSize(png)).toEqual([BRAND_PNG_SIZE, BRAND_PNG_SIZE]);
    const ico = await readFile(join(fixture.distRoot, BRAND_ICO_PATH.slice(1)));
    expect(ico.readUInt16LE(4)).toBe(BRAND_ICO_SIZES.length);
    BRAND_ICO_SIZES.forEach((size, index) => {
      const entry = 6 + 16 * index;
      const start = ico.readUInt32LE(entry + 12);
      const image = ico.subarray(start, start + ico.readUInt32LE(entry + 8));
      expect(pngSize(image)).toEqual([size, size]);
    });
  });

  it('keeps the copies the project holds', async () => {
    const fixture = await project({
      '/brand.svg': MARK,
      [BRAND_PNG_PATH]: 'own png',
      [BRAND_ICO_PATH]: 'own ico',
    });
    const icons = await writeBrandIcons({
      ...fixture,
      faviconPath: '/brand.svg',
      rasterize: () => Promise.reject(new Error('nothing to render')),
    });
    expect(icons.map(({ path, sizes }) => [path, sizes])).toEqual([
      [BRAND_PNG_PATH, []],
      ['/brand.svg', ['any']],
      [BRAND_ICO_PATH, []],
    ]);
  });

  it('lists nothing when the favicon is not in public/', async () => {
    const fixture = await project({});
    expect(
      await writeBrandIcons({ ...fixture, faviconPath: '/brand.svg' }),
    ).toEqual([]);
  });
});
