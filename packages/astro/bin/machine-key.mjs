/**
 * Issues a machine key for a private deployment (ADR-038).
 *
 * Prints the key once, for whoever will use it, and the record to add to the
 * deployment's MACHINE_KEYS secret, which holds only the key's hash. Nothing is
 * written to disk and nothing is sent anywhere: the operator puts the record
 * into the secret with `wrangler secret put`, and the key into the place its
 * user reads it from.
 */
import { createHash, randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const USAGE =
  'Usage: ctcdocs-machine-key --name <name> --owner <who answers for it> [--group <address>]... [--days <1-365>]';
const GROUP = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/u;
const LONGEST_DAYS = 365;
const DEFAULT_DAYS = 90;

export function parseMachineKeyArguments(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        name: { type: 'string' },
        owner: { type: 'string' },
        group: { type: 'string', multiple: true },
        days: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new Error(USAGE);
  }
  const name = values.name?.trim();
  const owner = values.owner?.trim();
  if (!name || !owner) {
    throw new Error(USAGE);
  }
  const groups = [
    ...new Set((values.group ?? []).map((group) => group.toLowerCase())),
  ].sort();
  for (const group of groups) {
    if (!GROUP.test(group)) {
      throw new Error(`--group takes a group address: ${group}`);
    }
  }
  const days = values.days === undefined ? DEFAULT_DAYS : Number(values.days);
  if (
    !/^\d+$/u.test(values.days ?? String(DEFAULT_DAYS)) ||
    days < 1 ||
    days > LONGEST_DAYS
  ) {
    throw new Error(`--days takes a whole number from 1 to ${LONGEST_DAYS}.`);
  }
  return { name, owner, groups, days };
}

/** A new key and the record that admits it, expiring `days` after `now`. */
export function issueMachineKey({ name, owner, groups, days }, now) {
  const key = `kbk_${randomBytes(32).toString('base64url')}`;
  return {
    key,
    record: {
      name,
      owner,
      hash: createHash('sha256').update(key).digest('hex'),
      groups,
      expires: new Date(now + days * 86_400_000).toISOString(),
    },
  };
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  try {
    const { key, record } = issueMachineKey(
      parseMachineKeyArguments(process.argv.slice(2)),
      Date.now(),
    );
    console.log(
      [
        'Key, shown once — give it to whoever will use it:',
        key,
        '',
        'Record — add it to the list in the MACHINE_KEYS secret:',
        JSON.stringify(record),
      ].join('\n'),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
