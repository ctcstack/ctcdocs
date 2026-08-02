import { posix, win32 } from 'node:path';
import { inflateRawSync } from 'node:zlib';
export const ZIP_SAFETY_LIMITS = Object.freeze({
    maxEntries: 1_000,
    maxEntryUncompressedBytes: 20 * 1024 * 1024,
    maxTotalUncompressedBytes: 50 * 1024 * 1024,
    maxCompressionRatio: 200,
});
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const MAX_END_COMMENT_BYTES = 65_535;
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;
const ENCRYPTED_FLAG = 0x0001;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const UTF8_FLAG = 0x0800;
const SUPPORTED_FLAGS = DATA_DESCRIPTOR_FLAG | UTF8_FLAG;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_SYMBOLIC_LINK = 0o120000;
export class UnsafeZipError extends Error {
    name = 'UnsafeZipError';
}
function asBuffer(bytes) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function findEndOfCentralDirectory(bytes) {
    if (bytes.length < 22) {
        throw new UnsafeZipError('ZIP archive is shorter than its end record.');
    }
    const minimumOffset = Math.max(0, bytes.length - 22 - MAX_END_COMMENT_BYTES);
    for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
        if (bytes.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
            return offset;
        }
    }
    throw new UnsafeZipError('ZIP end-of-central-directory record was not found.');
}
function normalizeArchivePath(fileName) {
    if (fileName.includes('\0')) {
        throw new UnsafeZipError('ZIP contains a NUL path entry.');
    }
    const slashNormalized = fileName.replaceAll('\\', '/');
    if (slashNormalized.includes('\uFFFD') ||
        posix.isAbsolute(slashNormalized) ||
        win32.isAbsolute(fileName) ||
        slashNormalized.split('/').includes('..')) {
        throw new UnsafeZipError('ZIP contains an unsafe path entry.');
    }
    const normalized = posix.normalize(slashNormalized).normalize('NFC');
    if (normalized === '.' || normalized.length === 0) {
        throw new UnsafeZipError('ZIP contains an empty normalized path.');
    }
    return normalized;
}
function computeCrc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function readEntry(archive, entry, centralDirectoryOffset) {
    if (entry.localHeaderOffset + 30 > archive.length ||
        archive.readUInt32LE(entry.localHeaderOffset) !==
            LOCAL_FILE_HEADER_SIGNATURE) {
        throw new UnsafeZipError('ZIP local-file header is invalid.');
    }
    const localFlags = archive.readUInt16LE(entry.localHeaderOffset + 6);
    const localCompressionMethod = archive.readUInt16LE(entry.localHeaderOffset + 8);
    const fileNameLength = archive.readUInt16LE(entry.localHeaderOffset + 26);
    const extraFieldLength = archive.readUInt16LE(entry.localHeaderOffset + 28);
    const dataOffset = entry.localHeaderOffset + 30 + fileNameLength + extraFieldLength;
    const dataEnd = dataOffset + entry.compressedBytes;
    const localPath = normalizeArchivePath(archive
        .subarray(entry.localHeaderOffset + 30, entry.localHeaderOffset + 30 + fileNameLength)
        .toString('utf8'));
    if (localFlags !== entry.flags ||
        localCompressionMethod !== entry.compressionMethod ||
        localPath !== entry.path ||
        dataOffset > centralDirectoryOffset ||
        dataEnd > centralDirectoryOffset) {
        throw new UnsafeZipError('ZIP local-file data is inconsistent with its central directory.');
    }
    const compressedData = archive.subarray(dataOffset, dataEnd);
    let data;
    if (entry.compressionMethod === 0) {
        data = compressedData;
    }
    else if (entry.compressionMethod === 8) {
        try {
            data = inflateRawSync(compressedData, {
                maxOutputLength: Math.min(entry.uncompressedBytes + 1, ZIP_SAFETY_LIMITS.maxEntryUncompressedBytes + 1),
            });
        }
        catch (error) {
            throw new UnsafeZipError('ZIP entry decompression failed.', {
                cause: error,
            });
        }
    }
    else {
        throw new UnsafeZipError('ZIP uses an unsupported compression method.');
    }
    if (data.byteLength !== entry.uncompressedBytes ||
        computeCrc32(data) !== entry.crc32) {
        throw new UnsafeZipError('ZIP entry integrity validation failed.');
    }
    return data;
}
export function extractSafeZipEntries(input) {
    const archive = asBuffer(input);
    const endOffset = findEndOfCentralDirectory(archive);
    const diskNumber = archive.readUInt16LE(endOffset + 4);
    const centralDirectoryDisk = archive.readUInt16LE(endOffset + 6);
    const diskEntryCount = archive.readUInt16LE(endOffset + 8);
    const entryCount = archive.readUInt16LE(endOffset + 10);
    const centralDirectorySize = archive.readUInt32LE(endOffset + 12);
    const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16);
    const commentLength = archive.readUInt16LE(endOffset + 20);
    if (diskNumber !== 0 ||
        centralDirectoryDisk !== 0 ||
        diskEntryCount !== entryCount) {
        throw new UnsafeZipError('Multi-disk ZIP archives are not supported.');
    }
    if (entryCount === ZIP64_SENTINEL_16 ||
        centralDirectorySize === ZIP64_SENTINEL_32 ||
        centralDirectoryOffset === ZIP64_SENTINEL_32) {
        throw new UnsafeZipError('ZIP64 archives are not supported.');
    }
    if (entryCount > ZIP_SAFETY_LIMITS.maxEntries) {
        throw new UnsafeZipError('ZIP contains too many entries.');
    }
    if (endOffset + 22 + commentLength !== archive.length ||
        centralDirectoryOffset + centralDirectorySize !== endOffset) {
        throw new UnsafeZipError('ZIP central directory bounds are invalid.');
    }
    const entries = [];
    const normalizedPaths = new Set();
    let totalUncompressedBytes = 0;
    let offset = centralDirectoryOffset;
    for (let index = 0; index < entryCount; index += 1) {
        if (offset + 46 > endOffset ||
            archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
            throw new UnsafeZipError('ZIP central-directory entry is invalid.');
        }
        const flags = archive.readUInt16LE(offset + 8);
        const compressionMethod = archive.readUInt16LE(offset + 10);
        const crc32 = archive.readUInt32LE(offset + 16);
        const compressedBytes = archive.readUInt32LE(offset + 20);
        const uncompressedBytes = archive.readUInt32LE(offset + 24);
        const fileNameLength = archive.readUInt16LE(offset + 28);
        const extraFieldLength = archive.readUInt16LE(offset + 30);
        const entryCommentLength = archive.readUInt16LE(offset + 32);
        const externalAttributes = archive.readUInt32LE(offset + 38);
        const localHeaderOffset = archive.readUInt32LE(offset + 42);
        const entryLength = 46 + fileNameLength + extraFieldLength + entryCommentLength;
        if (offset + entryLength > endOffset) {
            throw new UnsafeZipError('ZIP central-directory entry exceeds archive bounds.');
        }
        if (compressedBytes === ZIP64_SENTINEL_32 ||
            uncompressedBytes === ZIP64_SENTINEL_32 ||
            localHeaderOffset === ZIP64_SENTINEL_32) {
            throw new UnsafeZipError('ZIP64 entries are not supported.');
        }
        if ((flags & ENCRYPTED_FLAG) !== 0) {
            throw new UnsafeZipError('Encrypted ZIP entries are not supported.');
        }
        if ((flags & ~SUPPORTED_FLAGS) !== 0) {
            throw new UnsafeZipError('ZIP entry uses unsupported general flags.');
        }
        if (localHeaderOffset >= centralDirectoryOffset) {
            throw new UnsafeZipError('ZIP local-file header overlaps the central directory.');
        }
        const rawPathBytes = archive.subarray(offset + 46, offset + 46 + fileNameLength);
        const path = normalizeArchivePath(rawPathBytes.toString('utf8'));
        if ((flags & UTF8_FLAG) === 0 && rawPathBytes.some((byte) => byte > 0x7f)) {
            throw new UnsafeZipError('Non-ASCII ZIP paths must declare UTF-8 encoding.');
        }
        const pathKey = path.toLocaleLowerCase('en');
        if (normalizedPaths.has(pathKey)) {
            throw new UnsafeZipError('ZIP contains a duplicate normalized path.');
        }
        normalizedPaths.add(pathKey);
        const unixMode = externalAttributes >>> 16;
        if ((unixMode & UNIX_FILE_TYPE_MASK) === UNIX_SYMBOLIC_LINK) {
            throw new UnsafeZipError('ZIP symbolic links are not supported.');
        }
        if (uncompressedBytes > ZIP_SAFETY_LIMITS.maxEntryUncompressedBytes) {
            throw new UnsafeZipError('ZIP entry exceeds the uncompressed size limit.');
        }
        const compressionRatio = compressedBytes === 0
            ? uncompressedBytes === 0
                ? 0
                : Number.POSITIVE_INFINITY
            : uncompressedBytes / compressedBytes;
        if (compressionRatio > ZIP_SAFETY_LIMITS.maxCompressionRatio) {
            throw new UnsafeZipError('ZIP entry exceeds the compression ratio limit.');
        }
        totalUncompressedBytes += uncompressedBytes;
        if (totalUncompressedBytes > ZIP_SAFETY_LIMITS.maxTotalUncompressedBytes) {
            throw new UnsafeZipError('ZIP exceeds the total uncompressed size limit.');
        }
        entries.push({
            compressedBytes,
            compressionMethod,
            crc32,
            flags,
            localHeaderOffset,
            path,
            uncompressedBytes,
        });
        offset += entryLength;
    }
    if (offset !== endOffset) {
        throw new UnsafeZipError('ZIP central-directory size does not match its entries.');
    }
    return entries
        .filter((entry) => !entry.path.endsWith('/'))
        .map((entry) => ({
        path: entry.path,
        bytes: readEntry(archive, entry, centralDirectoryOffset),
    }))
        .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
