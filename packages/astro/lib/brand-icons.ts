/**
 * The brand mark as the icons served before sign-in (ADR-052).
 *
 * An assistant's connector list and a browser's tab fetch a site's icon
 * without its session, so a private deployment answers a few icon paths to
 * anyone: the project's favicon, its dark variant, and two raster copies the
 * build makes from the favicon — a PNG for clients that ignore SVG, and a
 * `/favicon.ico` for those that look nowhere else. A copy the project's
 * `public/` already holds is kept as it is.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import sharp from 'sharp';

/** Where the raster copy is served, and its size in pixels. */
export const BRAND_PNG_PATH = '/icon-192.png';
export const BRAND_PNG_SIZE = 192;
/** Where the icon file is served, and the sizes it holds. */
export const BRAND_ICO_PATH = '/favicon.ico';
export const BRAND_ICO_SIZES = [16, 32, 48] as const;

/** An icon served before sign-in, as the access map lists it. */
export interface BrandIcon {
  /** The canonical site path. */
  readonly path: string;
  readonly type: string;
  /** `WxH` sizes, or `any` for a vector. */
  readonly sizes: readonly string[];
  readonly theme?: 'light' | 'dark';
}

const TYPES: Readonly<Record<string, string>> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

function typeOf(path: string): string | undefined {
  const extension = /\.([a-z]+)$/iu.exec(path)?.[1]?.toLowerCase();
  return extension ? TYPES[extension] : undefined;
}

/**
 * An ICO file holding each image as PNG, as Windows Vista and every browser
 * since read it: a six-byte header, a sixteen-byte entry per image, then the
 * images.
 */
export function icoFromPngs(
  images: readonly { readonly size: number; readonly png: Uint8Array }[],
): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index;
    // A dimension of 256 is written as 0.
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

/** Renders the brand mark at one square size, as PNG. */
type Rasterize = (source: Buffer, size: number) => Promise<Buffer>;

const sharpRasterize: Rasterize = async (source, size) => {
  return sharp(source, { density: 384 })
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
};

export interface BrandIconsOptions {
  readonly publicRoot: string;
  readonly distRoot: string;
  readonly faviconPath: string;
  readonly faviconDarkPath?: string | undefined;
  /** Files the project's `public/` holds, as canonical paths. */
  readonly publicFiles: ReadonlySet<string>;
  readonly rasterize?: Rasterize;
}

/**
 * Writes the raster copies into the build and lists every icon served before
 * sign-in. Without a favicon in `public/` there is nothing to copy, and the
 * icons are the ones the project holds.
 */
export async function writeBrandIcons({
  publicRoot,
  distRoot,
  faviconPath,
  faviconDarkPath,
  publicFiles,
  rasterize = sharpRasterize,
}: BrandIconsOptions): Promise<BrandIcon[]> {
  const icons: BrandIcon[] = [];
  const listed = (path: string, entry: Omit<BrandIcon, 'path' | 'type'>) => {
    const type = typeOf(path);
    if (publicFiles.has(path) && type) {
      icons.push({ path, type, ...entry });
    }
  };
  const vector = (path: string) =>
    typeOf(path) === 'image/svg+xml' ? ['any'] : [];

  if (!publicFiles.has(faviconPath)) {
    return icons;
  }
  const source = await readFile(resolve(publicRoot, faviconPath.slice(1)));
  const square = (size: number) => `${size}x${size}`;

  if (!publicFiles.has(BRAND_PNG_PATH)) {
    await writeFile(
      resolve(distRoot, BRAND_PNG_PATH.slice(1)),
      await rasterize(source, BRAND_PNG_SIZE),
    );
  }
  icons.push({
    path: BRAND_PNG_PATH,
    type: 'image/png',
    // A copy the project holds may be any size.
    sizes: publicFiles.has(BRAND_PNG_PATH) ? [] : [square(BRAND_PNG_SIZE)],
  });
  listed(faviconPath, { sizes: vector(faviconPath) });
  if (faviconDarkPath && faviconDarkPath !== faviconPath) {
    listed(faviconDarkPath, { sizes: vector(faviconDarkPath), theme: 'dark' });
  }
  if (!publicFiles.has(BRAND_ICO_PATH)) {
    const images = [];
    for (const size of BRAND_ICO_SIZES) {
      images.push({ size, png: await rasterize(source, size) });
    }
    await writeFile(
      resolve(distRoot, BRAND_ICO_PATH.slice(1)),
      icoFromPngs(images),
    );
  }
  icons.push({
    path: BRAND_ICO_PATH,
    type: 'image/x-icon',
    sizes: publicFiles.has(BRAND_ICO_PATH) ? [] : BRAND_ICO_SIZES.map(square),
  });
  return icons;
}
