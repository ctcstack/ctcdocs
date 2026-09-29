/**
 * Applies the crop Google Docs makes to a PNG image (ADR-031).
 *
 * Google Docs crops an image without changing it: the HTML export ships the
 * whole file and frames it in CSS, which the site does not keep. So the crop
 * is applied to the file: decoded, cut to the pixels the frame shows, and
 * encoded again without loss, in the image's own channels and bit depth. The
 * codec is plain JavaScript, so a file comes out byte for byte the same on
 * any machine.
 */
import { inflateSync } from 'node:zlib';

import { convertIndexedToRgb, decode, encode } from 'fast-png';

import { PNG_SIGNATURE } from './validate-asset.js';

/** How the export draws a cropped image in its frame, in CSS pixels. */
export interface CropFrame {
  frameWidth: number;
  frameHeight: number;
  imageWidth: number;
  imageHeight: number;
  /** The image's margins inside the frame; negative moves it up or left. */
  left: number;
  top: number;
}

/**
 * The version of how the sync processes images. A page with a crop published
 * by an earlier version is exported again once, so the crop is applied.
 */
export const IMAGE_VERSION = 1;

/** A rectangle of a file's pixels. */
export interface PixelRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A file larger than this is not decoded: decoding holds four bytes per
 * pixel, and a small file can declare an enormous size. Google's export keeps
 * images under 2,000 pixels on a side, so a genuine one is far below it.
 */
export const MAX_DECODED_PIXELS = 4096 * 4096;

/** Absorbs floating-point error at an edge that falls on a whole pixel. */
const EDGE_EPSILON = 1e-6;

/** The chunks that decide how colors display, carried over from the source. */
const COLOR_CHUNKS: ReadonlySet<string> = new Set([
  'cHRM',
  'gAMA',
  'iCCP',
  'sRGB',
]);

/** The deflate level the crop is encoded at: the smallest file. */
const ZLIB_LEVEL = 9;

/** Samples per pixel, by PNG color type. */
const SAMPLES_BY_COLOR_TYPE: Readonly<Record<number, number>> = {
  0: 1,
  2: 3,
  3: 1,
  4: 2,
  6: 4,
};

/** Adam7's seven passes: the first pixel's x and y, then the steps between. */
const ADAM7_PASSES = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/**
 * The bytes a PNG's image data inflates to, as its header describes it: a
 * filter byte and the packed samples of each row, of each pass if interlaced.
 */
function inflatedSize(
  width: number,
  height: number,
  bitsPerPixel: number,
  interlaced: boolean,
): number {
  const rows = (columns: number, count: number) =>
    columns <= 0 || count <= 0
      ? 0
      : count * (1 + Math.ceil((columns * bitsPerPixel) / 8));
  if (!interlaced) {
    return rows(width, height);
  }
  return ADAM7_PASSES.reduce(
    (total, [x, y, stepX, stepY]) =>
      total +
      rows(Math.ceil((width - x) / stepX), Math.ceil((height - y) / stepY)),
    0,
  );
}

/**
 * The pixels of a file `fileWidth` by `fileHeight` that the frame shows.
 * Edges round inward: a pixel partly outside the frame is left out, so no
 * pixel of what was cropped away is published. `undefined` when none is left.
 */
export function visiblePixels(
  frame: CropFrame,
  fileWidth: number,
  fileHeight: number,
): PixelRectangle | undefined {
  if (frame.imageWidth <= 0 || frame.imageHeight <= 0) {
    return undefined;
  }
  const span = (
    offset: number,
    shown: number,
    drawn: number,
    scale: number,
    size: number,
  ) => {
    const start = Math.max(0, -offset);
    const end = Math.min(drawn, shown - offset);
    return [
      Math.max(0, Math.ceil(start * scale - EDGE_EPSILON)),
      Math.min(size, Math.floor(end * scale + EDGE_EPSILON)),
    ] as const;
  };
  const [x0, x1] = span(
    frame.left,
    frame.frameWidth,
    frame.imageWidth,
    fileWidth / frame.imageWidth,
    fileWidth,
  );
  const [y0, y1] = span(
    frame.top,
    frame.frameHeight,
    frame.imageHeight,
    fileHeight / frame.imageHeight,
    fileHeight,
  );
  return x1 - x0 < 1 || y1 - y0 < 1
    ? undefined
    : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

interface Chunk {
  type: string;
  /** The whole chunk: length, type, data and CRC. */
  bytes: Uint8Array;
}

/** A PNG's chunks in order, or `undefined` when it is not a whole PNG. */
function readChunks(png: Uint8Array): Chunk[] | undefined {
  if (!PNG_SIGNATURE.every((value, index) => png[index] === value)) {
    return undefined;
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Chunk[] = [];
  for (let offset = PNG_SIGNATURE.length; offset < png.length;) {
    if (offset + 12 > png.length) {
      return undefined;
    }
    const end = offset + 12 + view.getUint32(offset);
    if (end > png.length) {
      return undefined;
    }
    chunks.push({
      type: String.fromCharCode(...png.subarray(offset + 4, offset + 8)),
      bytes: png.subarray(offset, end),
    });
    offset = end;
  }
  return chunks;
}

/**
 * The PNG cut to what the frame shows, in the same channels and bit depth,
 * with the source's color chunks and none of its metadata. `undefined` when
 * the crop cannot be applied: the file is not a whole PNG, is too large to
 * decode, shows nothing, will not decode, or is grayscale packed below eight
 * bits a pixel, which does not occur in Google's exports.
 */
export function cropPng(
  png: Uint8Array,
  frame: CropFrame,
): Uint8Array | undefined {
  const chunks = readChunks(png);
  const header = chunks?.[0];
  if (!chunks || header?.type !== 'IHDR' || header.bytes.length !== 25) {
    return undefined;
  }
  const headerView = new DataView(
    header.bytes.buffer,
    header.bytes.byteOffset,
    header.bytes.byteLength,
  );
  const width = headerView.getUint32(8);
  const height = headerView.getUint32(12);
  const samples = SAMPLES_BY_COLOR_TYPE[header.bytes[17] ?? -1];
  const bitDepth = header.bytes[16] ?? 0;
  if (width * height > MAX_DECODED_PIXELS || samples === undefined) {
    return undefined;
  }
  /*
   * The decoder inflates the image data without a limit, so a small file
   * could inflate to far more than its pixels. It is inflated here first, up
   * to what the header describes, and refused beyond it.
   */
  try {
    inflateSync(
      Buffer.concat(
        chunks
          .filter((chunk) => chunk.type === 'IDAT')
          .map((chunk) => chunk.bytes.subarray(8, chunk.bytes.length - 4)),
      ),
      {
        maxOutputLength: inflatedSize(
          width,
          height,
          samples * bitDepth,
          header.bytes[20] === 1,
        ),
      },
    );
  } catch {
    return undefined;
  }
  const rectangle = visiblePixels(frame, width, height);
  if (!rectangle) {
    return undefined;
  }

  let decoded: ReturnType<typeof decode>;
  try {
    decoded = decode(png);
  } catch {
    return undefined;
  }
  if (decoded.width !== width || decoded.height !== height) {
    return undefined;
  }
  /*
   * A palette image is cut as the colors it shows, with any transparency in
   * an alpha channel; any other keeps its channels, and its transparent color
   * if it names one.
   */
  const indexed = decoded.palette !== undefined;
  if (!indexed && decoded.depth < 8) {
    return undefined;
  }
  const source = indexed ? convertIndexedToRgb(decoded) : decoded.data;
  const channels = source.length / (width * height);
  const depth = indexed ? 8 : decoded.depth;
  const rowLength = rectangle.width * channels;
  const pixels =
    source instanceof Uint16Array
      ? new Uint16Array(rectangle.height * rowLength)
      : new Uint8Array(rectangle.height * rowLength);
  for (let row = 0; row < rectangle.height; row += 1) {
    const from = ((rectangle.y + row) * width + rectangle.x) * channels;
    pixels.set(source.subarray(from, from + rowLength), row * rowLength);
  }

  let encoded: Chunk[] | undefined;
  try {
    encoded = readChunks(
      encode(
        {
          width: rectangle.width,
          height: rectangle.height,
          data: pixels,
          channels,
          depth: depth === 16 ? 16 : 8,
        },
        { zlib: { level: ZLIB_LEVEL } },
      ),
    );
  } catch {
    return undefined;
  }
  if (!encoded?.[0] || encoded[0].type !== 'IHDR') {
    return undefined;
  }
  const carried = chunks.filter(
    (chunk) =>
      COLOR_CHUNKS.has(chunk.type) || (!indexed && chunk.type === 'tRNS'),
  );
  const parts = [
    Uint8Array.from(PNG_SIGNATURE),
    encoded[0].bytes,
    ...carried.map((chunk) => chunk.bytes),
    ...encoded.slice(1).map((chunk) => chunk.bytes),
  ];
  const output = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
