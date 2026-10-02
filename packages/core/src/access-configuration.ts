/**
 * Who may read which folder (ADR-039).
 *
 * A project names its admin groups and, per Drive folder, the Google groups
 * that may read it. The folder is named by its Drive ID, so a rename moves
 * nothing, and the rule carries the folder's name as a label a reviewer can
 * read; the label is checked against the corpus and reported when it drifts,
 * never failing a sync.
 *
 * Group addresses are compared case-insensitively by Google, so they are
 * lowercased here once and compared exactly everywhere else.
 */

/** A reader value meaning every signed-in member of the organization. */
export const EVERY_MEMBER = '*';

export interface AccessRule {
  /** The Drive folder the rule covers, with everything below it. */
  readonly folder: string;
  /** The folder's name as the rule's author knew it, for review. */
  readonly label: string;
  /**
   * Group addresses, sorted, or `["*"]` for every member. A folder's readers
   * are the groups every rule on its chain names (ADR-039).
   */
  readonly readers: readonly string[];
}

export interface AccessConfiguration {
  /** Groups that read every folder, including folders without a rule. */
  readonly admins: readonly string[];
  readonly rules: readonly AccessRule[];
}

type Fail = (path: string, expectation: string) => never;

const GROUP_ADDRESS =
  /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;

/** The characters Google uses in file and folder IDs. */
const FOLDER_ID = /^[A-Za-z0-9_-]{1,128}$/u;

function object(
  value: unknown,
  path: string,
  fail: Fail,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

/**
 * A misspelled key would otherwise be ignored and leave a folder governed by a
 * rule its author did not write, so an unknown key is an error.
 */
function knownKeys(
  source: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  fail: Fail,
): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) {
      fail(`${path}.${key}`, 'is not a known setting');
    }
  }
}

function groupAddress(value: unknown, path: string, fail: Fail): string {
  const address = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!GROUP_ADDRESS.test(address)) {
    fail(path, 'must be a group address such as "team@example.com"');
  }
  return address;
}

function groupList(
  value: unknown,
  path: string,
  fail: Fail,
  allowEveryMember: boolean,
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(path, 'must be a non-empty array of group addresses');
  }
  if (allowEveryMember && value.includes(EVERY_MEMBER)) {
    if (value.length !== 1) {
      fail(path, `must be ["${EVERY_MEMBER}"] alone, or group addresses`);
    }
    return Object.freeze([EVERY_MEMBER]);
  }
  const groups = value.map((entry, index) =>
    groupAddress(entry, `${path}[${index}]`, fail),
  );
  if (new Set(groups).size !== groups.length) {
    fail(path, 'must not repeat a group');
  }
  return Object.freeze([...groups].sort());
}

export function parseAccessConfiguration(
  value: unknown,
  fail: Fail,
): AccessConfiguration {
  const source = object(value, 'access', fail);
  knownKeys(source, ['admins', 'rules'], 'access', fail);
  const admins = groupList(source.admins, 'access.admins', fail, false);

  if (!Array.isArray(source.rules)) {
    fail('access.rules', 'must be an array');
  }
  const folders = new Set<string>();
  const rules = source.rules.map((raw: unknown, index: number) => {
    const path = `access.rules[${index}]`;
    const rule = object(raw, path, fail);
    knownKeys(rule, ['folder', 'label', 'readers'], path, fail);
    const folder = typeof rule.folder === 'string' ? rule.folder : '';
    if (!FOLDER_ID.test(folder)) {
      fail(`${path}.folder`, 'must be a Drive folder ID');
    }
    if (folders.has(folder)) {
      fail(`${path}.folder`, 'must not have a second rule');
    }
    folders.add(folder);
    const label = typeof rule.label === 'string' ? rule.label.trim() : '';
    if (label.length === 0) {
      fail(`${path}.label`, "must be the folder's name");
    }
    return Object.freeze({
      folder,
      label,
      readers: groupList(rule.readers, `${path}.readers`, fail, true),
    });
  });

  return Object.freeze({ admins, rules: Object.freeze(rules) });
}
