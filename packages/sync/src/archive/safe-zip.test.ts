import { deflateRawSync } from 'node:zlib';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  extractSafeZipEntries,
  UnsafeZipError,
  ZIP_SAFETY_LIMITS,
} from './safe-zip.js';

interface ZipFixtureEntry {
  path: string;
  content?: string;
  compressionMethod?: 0 | 8;
  declaredCompressedBytes?: number;
  declaredUncompressedBytes?: number;
  crc32?: number;
  externalAttributes?: number;
  flags?: number;
  localHeaderOffset?: number;
}

function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(entries: readonly ZipFixtureEntry[]): Uint8Array {
  let localOffset = 0;
  const localEntries: Buffer[] = [];
  const centralEntries = entries.map((entry) => {
    const path = Buffer.from(entry.path, 'utf8');
    const content = Buffer.from(entry.content ?? '', 'utf8');
    const compressionMethod = entry.compressionMethod ?? 0;
    const compressed =
      compressionMethod === 8 ? deflateRawSync(content) : content;
    const flags =
      entry.flags ?? (path.some((byte) => byte > 0x7f) ? 0x0800 : 0);
    const crc32 = entry.crc32 ?? computeCrc32(content);
    const compressedBytes =
      entry.declaredCompressedBytes ?? compressed.byteLength;
    const uncompressedBytes =
      entry.declaredUncompressedBytes ?? content.byteLength;
    const local = Buffer.alloc(30 + path.length + compressed.length);
    const central = Buffer.alloc(46 + path.length);

    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(compressionMethod, 8);
    local.writeUInt32LE(crc32, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(path.length, 26);
    path.copy(local, 30);
    compressed.copy(local, 30 + path.length);

    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(compressionMethod, 10);
    central.writeUInt32LE(crc32, 16);
    central.writeUInt32LE(compressedBytes, 20);
    central.writeUInt32LE(uncompressedBytes, 24);
    central.writeUInt16LE(path.length, 28);
    central.writeUInt32LE(entry.externalAttributes ?? 0, 38);
    central.writeUInt32LE(entry.localHeaderOffset ?? localOffset, 42);
    path.copy(central, 46);

    localEntries.push(local);
    localOffset += local.length;
    return central;
  });
  const localData = Buffer.concat(localEntries);
  const centralDirectory = Buffer.concat(centralEntries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralDirectory, end]);
}

describe('safe ZIP extraction', () => {
  it('extracts stored and deflated UTF-8 files in deterministic order', () => {
    const entries = extractSafeZipEntries(
      createZip([
        { path: 'images/café.png', content: 'image', compressionMethod: 8 },
        { path: 'document.html', content: '<p>Safe</p>' },
        { path: 'empty/' },
      ]),
    );

    expect(entries.map((entry) => entry.path)).toEqual([
      'document.html',
      'images/café.png',
    ]);
    expect(new TextDecoder().decode(entries[0]?.bytes)).toBe('<p>Safe</p>');
    expect(new TextDecoder().decode(entries[1]?.bytes)).toBe('image');
  });

  it.each([
    '../outside.txt',
    '/absolute.txt',
    'images/../../outside.svg',
    'C:\\outside.txt',
    'bad\0name',
  ])('rejects unsafe path %s', (path) => {
    expect(() => extractSafeZipEntries(createZip([{ path }]))).toThrow(
      UnsafeZipError,
    );
  });

  it('rejects duplicate normalized paths and symbolic links', () => {
    expect(() =>
      extractSafeZipEntries(
        createZip([{ path: 'images/a.png' }, { path: 'images/A.png' }]),
      ),
    ).toThrow('duplicate normalized path');
    expect(() =>
      extractSafeZipEntries(
        createZip([
          {
            path: 'link',
            externalAttributes: (0o120777 << 16) >>> 0,
          },
        ]),
      ),
    ).toThrow('symbolic links');
  });

  it('rejects entry count, size, total size, and compression ratio limits', () => {
    expect(() =>
      extractSafeZipEntries(
        createZip(
          Array.from(
            { length: ZIP_SAFETY_LIMITS.maxEntries + 1 },
            (_, index) => ({ path: `entry-${index}` }),
          ),
        ),
      ),
    ).toThrow('too many entries');
    expect(() =>
      extractSafeZipEntries(
        createZip([
          {
            path: 'large',
            declaredCompressedBytes:
              ZIP_SAFETY_LIMITS.maxEntryUncompressedBytes + 1,
            declaredUncompressedBytes:
              ZIP_SAFETY_LIMITS.maxEntryUncompressedBytes + 1,
          },
        ]),
      ),
    ).toThrow('uncompressed size');
    expect(() =>
      extractSafeZipEntries(
        createZip([
          {
            path: 'ratio',
            declaredCompressedBytes: 1,
            declaredUncompressedBytes:
              ZIP_SAFETY_LIMITS.maxCompressionRatio + 1,
          },
        ]),
      ),
    ).toThrow('compression ratio');
    expect(() =>
      extractSafeZipEntries(
        createZip([
          {
            path: 'one',
            declaredCompressedBytes:
              ZIP_SAFETY_LIMITS.maxEntryUncompressedBytes,
            declaredUncompressedBytes:
              ZIP_SAFETY_LIMITS.maxEntryUncompressedBytes,
          },
          {
            path: 'two',
            declaredCompressedBytes:
              ZIP_SAFETY_LIMITS.maxEntryUncompressedBytes,
            declaredUncompressedBytes:
              ZIP_SAFETY_LIMITS.maxEntryUncompressedBytes,
          },
          {
            path: 'three',
            declaredCompressedBytes:
              ZIP_SAFETY_LIMITS.maxEntryUncompressedBytes,
            declaredUncompressedBytes:
              ZIP_SAFETY_LIMITS.maxEntryUncompressedBytes,
          },
        ]),
      ),
    ).toThrow('total uncompressed size');
  });

  it('rejects corrupted content and invalid archive bounds', () => {
    expect(() =>
      extractSafeZipEntries(
        createZip([{ path: 'bad.txt', content: 'content', crc32: 1 }]),
      ),
    ).toThrow('integrity');

    const truncated = createZip([{ path: 'safe.txt', content: 'safe' }]).slice(
      0,
      -1,
    );
    expect(() => extractSafeZipEntries(truncated)).toThrow(UnsafeZipError);
    expect(() => extractSafeZipEntries(Uint8Array.from([0x50, 0x4b]))).toThrow(
      UnsafeZipError,
    );
  });

  it('rejects unsupported flags and local headers that overlap metadata', () => {
    expect(() =>
      extractSafeZipEntries(createZip([{ path: 'flagged', flags: 0x0020 }])),
    ).toThrow('unsupported general flags');
    expect(() =>
      extractSafeZipEntries(
        createZip([{ path: 'overlap', localHeaderOffset: 0xfffffff0 }]),
      ),
    ).toThrow('overlaps the central directory');
  });

  it('normalizes safe path permutations without escaping the archive', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc
            .tuple(
              fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/u),
              fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/u),
            )
            .map(([directory, file]) => `${directory}/${file}.txt`),
          { minLength: 1, maxLength: 20 },
        ),
        (paths) => {
          const uniquePaths = [...new Set(paths)];
          expect(
            extractSafeZipEntries(
              createZip(uniquePaths.map((path) => ({ path, content: path }))),
            ).map((entry) => entry.path),
          ).toEqual([...uniquePaths].sort());
        },
      ),
    );
  });
});
