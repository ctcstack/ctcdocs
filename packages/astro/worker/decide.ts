/**
 * Whether a reader may have a file (ADR-039, ADR-040).
 *
 * A file is admitted when it is a platform file or in the members class, when
 * the reader is in an admin group, or when one of the reader's groups is among
 * its class's readers. An optimized image shown on several pages takes their
 * classes, and is admitted for any of them. A stale snapshot serves the members
 * class and platform files only, to everyone, admins included. A machine key
 * reads as the groups it was issued and never as an admin.
 */
import {
  ADMINS_CLASS,
  MEMBERS_CLASS,
  PLATFORM_FILE,
  type AccessMapFile,
  type FileClass,
} from './access-map.js';

export type Reader =
  | {
      readonly kind: 'person';
      readonly sub: string;
      readonly email: string;
      readonly groups: readonly string[];
    }
  | {
      readonly kind: 'machine';
      readonly name: string;
      readonly groups: readonly string[];
    };

export function isAdmin(map: AccessMapFile, reader: Reader): boolean {
  return (
    reader.kind === 'person' &&
    reader.groups.some((group) => map.admins.includes(group))
  );
}

function mayReadClass(
  map: AccessMapFile,
  reader: Reader,
  cls: string,
  stale: boolean,
): boolean {
  if (cls === PLATFORM_FILE || cls === MEMBERS_CLASS) {
    return true;
  }
  if (stale) {
    return false;
  }
  if (isAdmin(map, reader)) {
    return true;
  }
  if (cls === ADMINS_CLASS) {
    return false;
  }
  const readers = map.classes[cls]?.readers;
  if (readers === undefined) {
    return false;
  }
  return (
    readers === '*' || reader.groups.some((group) => readers.includes(group))
  );
}

export function mayRead(
  map: AccessMapFile,
  reader: Reader,
  fileClass: FileClass,
  stale: boolean,
): boolean {
  const classes = typeof fileClass === 'string' ? [fileClass] : fileClass;
  return classes.some((cls) => mayReadClass(map, reader, cls, stale));
}

/** The search bundles beyond the members bundle that a reader may open. */
export function readableBundles(
  map: AccessMapFile,
  reader: Reader,
  stale: boolean,
): string[] {
  return Object.entries(map.bundles)
    .filter(
      ([cls]) => cls !== MEMBERS_CLASS && mayReadClass(map, reader, cls, stale),
    )
    .map(([, bundle]) => bundle)
    .sort();
}

/** The groups that may read a class, for a refusal page to name. */
export function groupsFor(map: AccessMapFile, fileClass: FileClass): string[] {
  const classes = typeof fileClass === 'string' ? [fileClass] : fileClass;
  const groups = new Set<string>();
  for (const cls of classes) {
    const readers = map.classes[cls]?.readers;
    if (Array.isArray(readers)) {
      for (const group of readers) {
        groups.add(group);
      }
    }
  }
  return [...groups].sort();
}
