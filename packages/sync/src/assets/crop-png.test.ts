import { crc32, deflateSync } from 'node:zlib';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  gridPalettePng,
  gridPng,
  gridPositions,
  gridRectangle,
} from '../test-support/png-fixture.js';
import {
  cropPng,
  MAX_DECODED_PIXELS,
  visiblePixels,
  type CropFrame,
} from './crop-png.js';

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** The PNG with chunks added after its header. */
function withChunks(png: Uint8Array, added: readonly Buffer[]): Uint8Array {
  const bytes = Buffer.from(png);
  return Buffer.concat([bytes.subarray(0, 33), ...added, bytes.subarray(33)]);
}

function chunkTypes(png: Uint8Array): string[] {
  const bytes = Buffer.from(png);
  const types: string[] = [];
  for (let offset = 8; offset < bytes.length;) {
    types.push(bytes.toString('latin1', offset + 4, offset + 8));
    offset += bytes.readUInt32BE(offset) + 12;
  }
  return types;
}

// As Google's export drew the two crops in a test document.
const rightAndBottom: CropFrame = {
  frameWidth: 427,
  frameHeight: 258,
  imageWidth: 624,
  imageHeight: 333,
  left: 0,
  top: 0,
};
const top: CropFrame = {
  frameWidth: 230,
  frameHeight: 1206,
  imageWidth: 230,
  imageHeight: 2048,
  left: 0,
  top: -842,
};

describe('visiblePixels', () => {
  it('turns the frame into the pixels of the file it shows', () => {
    // 427 / 624 of 64 is 43.8 and 258 / 333 of 32 is 24.8: rounded inward.
    expect(visiblePixels(rightAndBottom, 64, 32)).toEqual({
      x: 0,
      y: 0,
      width: 43,
      height: 24,
    });
    // 842 / 2048 of 32 is 13.2, so the first row shown is 14.
    expect(visiblePixels(top, 64, 32)).toEqual({
      x: 0,
      y: 14,
      width: 64,
      height: 18,
    });
  });

  it('finds nothing when the frame shows less than a pixel', () => {
    expect(
      visiblePixels({ ...rightAndBottom, frameWidth: 5 }, 64, 32),
    ).toBeUndefined();
  });

  it('never takes a pixel from outside the frame', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 400 }),
        fc.integer({ min: 1, max: 400 }),
        fc.double({ min: 1, max: 2000, noNaN: true }),
        fc.double({ min: 1, max: 2000, noNaN: true }),
        fc.double({ min: 0.1, max: 1, noNaN: true }),
        fc.double({ min: 0.1, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (width, height, drawnWidth, drawnHeight, shownX, shownY, atX, atY) => {
          const frame: CropFrame = {
            imageWidth: drawnWidth,
            imageHeight: drawnHeight,
            frameWidth: drawnWidth * shownX,
            frameHeight: drawnHeight * shownY,
            left: -drawnWidth * (1 - shownX) * atX,
            top: -drawnHeight * (1 - shownY) * atY,
          };
          const rectangle = visiblePixels(frame, width, height);
          if (!rectangle) {
            return;
          }
          const scaleX = width / drawnWidth;
          const scaleY = height / drawnHeight;
          // Every pixel kept lies wholly inside the window the frame shows,
          // in the file's pixels, to the same rounding the code allows.
          expect(rectangle.x).toBeGreaterThanOrEqual(0);
          expect(rectangle.y).toBeGreaterThanOrEqual(0);
          expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(width);
          expect(rectangle.y + rectangle.height).toBeLessThanOrEqual(height);
          expect(rectangle.x).toBeGreaterThanOrEqual(
            -frame.left * scaleX - 1e-6,
          );
          expect(rectangle.y).toBeGreaterThanOrEqual(
            -frame.top * scaleY - 1e-6,
          );
          expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(
            (frame.frameWidth - frame.left) * scaleX + 1e-6,
          );
          expect(rectangle.y + rectangle.height).toBeLessThanOrEqual(
            (frame.frameHeight - frame.top) * scaleY + 1e-6,
          );
        },
      ),
    );
  });
});

describe('cropPng', () => {
  it('keeps exactly the pixels the frame shows', () => {
    const cropped = cropPng(gridPng(64, 32), top);
    if (!cropped) {
      throw new Error('The crop was not applied.');
    }

    expect(gridPositions(cropped)).toMatchObject({
      width: 64,
      height: 18,
      positions: gridRectangle(0, 14, 64, 18),
    });
  });

  it('keeps the channels and bit depth of what it crops', () => {
    for (const options of [
      { channels: 3, depth: 8 },
      { channels: 4, depth: 16 },
    ] as const) {
      const cropped = cropPng(gridPng(64, 32, options), top);
      if (!cropped) {
        throw new Error('The crop was not applied.');
      }
      expect(gridPositions(cropped)).toEqual({
        width: 64,
        height: 18,
        ...options,
        positions: gridRectangle(0, 14, 64, 18),
      });
    }
  });

  it('crops a palette image as the colors it shows', () => {
    const cropped = cropPng(gridPalettePng(16, 8), {
      frameWidth: 50,
      frameHeight: 50,
      imageWidth: 100,
      imageHeight: 100,
      left: -50,
      top: 0,
    });
    if (!cropped) {
      throw new Error('The crop was not applied.');
    }
    // The right half of 16 by 8, as RGB.
    expect(gridPositions(cropped)).toEqual({
      width: 8,
      height: 4,
      channels: 3,
      depth: 8,
      positions: gridRectangle(8, 0, 8, 4),
    });
  });

  it('keeps the color an RGB image names as transparent', () => {
    const transparent = chunk('tRNS', Uint8Array.of(0, 0, 0, 0, 0, 7));
    const cropped = cropPng(
      withChunks(gridPng(64, 32, { channels: 3 }), [transparent]),
      rightAndBottom,
    );
    expect(cropped && chunkTypes(cropped)).toEqual([
      'IHDR',
      'tRNS',
      'IDAT',
      'IEND',
    ]);
  });

  it('leaves grayscale packed below eight bits uncropped', () => {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(8, 0);
    header.writeUInt32BE(1, 4);
    header[8] = 1;
    header[9] = 0;
    const oneBit = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Uint8Array.of(0, 0b10101010))),
      chunk('IEND', new Uint8Array()),
    ]);
    expect(
      cropPng(oneBit, { ...rightAndBottom, frameHeight: 333 }),
    ).toBeUndefined();
  });

  it('writes the same bytes for the same crop', () => {
    const source = gridPng(64, 32);
    expect(cropPng(source, rightAndBottom)).toEqual(
      cropPng(source, rightAndBottom),
    );
  });

  it('keeps how colors display and drops metadata', () => {
    const source = withChunks(gridPng(64, 32), [
      chunk('sRGB', Uint8Array.of(0)),
      chunk('eXIf', Buffer.from('synthetic', 'latin1')),
      chunk('tEXt', Buffer.from('Comment\0synthetic', 'latin1')),
    ]);
    const cropped = cropPng(source, rightAndBottom);

    expect(cropped && chunkTypes(cropped)).toEqual([
      'IHDR',
      'sRGB',
      'IDAT',
      'IEND',
    ]);
  });

  it('refuses a file too large to decode before decoding it', () => {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(100_000, 0);
    header.writeUInt32BE(100_000, 4);
    header[8] = 8;
    header[9] = 6;
    const bomb = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', Uint8Array.of(0)),
      chunk('IEND', new Uint8Array()),
    ]);
    expect(100_000 * 100_000).toBeGreaterThan(MAX_DECODED_PIXELS);

    expect(cropPng(bomb, rightAndBottom)).toBeUndefined();
  });

  it('refuses a file that is not a whole PNG', () => {
    const source = gridPng(64, 32);
    expect(cropPng(source.subarray(0, 40), rightAndBottom)).toBeUndefined();
    expect(cropPng(Uint8Array.of(1, 2, 3), rightAndBottom)).toBeUndefined();
  });
});
