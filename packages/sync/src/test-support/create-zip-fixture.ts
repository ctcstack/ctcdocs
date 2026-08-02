export interface StoredZipFixtureEntry {
  bytes: Uint8Array | string;
  path: string;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createStoredZipFixture(
  entries: readonly StoredZipFixtureEntry[],
): Uint8Array {
  let localOffset = 0;
  const localEntries: Buffer[] = [];
  const centralEntries = entries.map((entry) => {
    const path = Buffer.from(entry.path, 'utf8');
    const bytes =
      typeof entry.bytes === 'string'
        ? Buffer.from(entry.bytes, 'utf8')
        : Buffer.from(entry.bytes);
    const flags = path.some((byte) => byte > 0x7f) ? 0x0800 : 0;
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30 + path.length + bytes.length);
    const central = Buffer.alloc(46 + path.length);

    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(path.length, 26);
    path.copy(local, 30);
    bytes.copy(local, 30 + path.length);

    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(flags, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(path.length, 28);
    central.writeUInt32LE(localOffset, 42);
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
