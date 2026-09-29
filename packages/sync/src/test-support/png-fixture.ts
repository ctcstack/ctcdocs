/**
 * Synthetic PNG images for the tests, encoded and read by the codec the sync
 * crops with, so a test can say which pixels a file holds.
 */
import { convertIndexedToRgb, decode, encode } from 'fast-png';

interface GridOptions {
  /** 4 for RGBA (the default), 3 for RGB. */
  channels?: 3 | 4;
  depth?: 8 | 16;
}

/** A PNG whose every pixel says where it is: red is x, green is y. */
export function gridPng(
  width: number,
  height: number,
  { channels = 4, depth = 8 }: GridOptions = {},
): Uint8Array {
  const data =
    depth === 16
      ? new Uint16Array(width * height * channels)
      : new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel =
        channels === 4 ? [x, y, 7, depth === 16 ? 65535 : 255] : [x, y, 7];
      data.set(pixel, (y * width + x) * channels);
    }
  }
  return encode({ width, height, data, channels, depth });
}

/**
 * A palette PNG of the same grid for a width of at most 16: each pixel's
 * index names its [x, y] among width × height colors, without transparency.
 */
export function gridPalettePng(width: number, height: number): Uint8Array {
  const palette: number[][] = [];
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = palette.length;
      palette.push([x, y, 7]);
    }
  }
  return encode({ width, height, data, channels: 1, depth: 8, palette });
}

/** The size, channels and depth of a PNG, and each pixel as [x, y]. */
export function gridPositions(png: Uint8Array): {
  width: number;
  height: number;
  channels: number;
  depth: number;
  positions: Array<[number, number]>;
} {
  const decoded = decode(png);
  const data = decoded.palette ? convertIndexedToRgb(decoded) : decoded.data;
  const channels = data.length / (decoded.width * decoded.height);
  const positions: Array<[number, number]> = [];
  for (let index = 0; index < data.length; index += channels) {
    positions.push([data[index] ?? -1, data[index + 1] ?? -1]);
  }
  return {
    width: decoded.width,
    height: decoded.height,
    channels,
    depth: decoded.palette ? 8 : decoded.depth,
    positions,
  };
}

/** The pixels a grid PNG holds after a crop to this rectangle. */
export function gridRectangle(
  x: number,
  y: number,
  width: number,
  height: number,
): Array<[number, number]> {
  const positions: Array<[number, number]> = [];
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      positions.push([column, row]);
    }
  }
  return positions;
}
