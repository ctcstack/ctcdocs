import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findMachineKey,
  parseMachineKeys,
  presentedKey,
} from '../dist-node/worker/machine-keys.js';
import { issueMachineKey, parseMachineKeyArguments } from './machine-key.mjs';

const NOW = Date.parse('2026-10-03T12:00:00Z');

test('a key the command issues is one the Worker admits until it expires', async () => {
  const { key, record } = issueMachineKey(
    parseMachineKeyArguments([
      '--name',
      'smoke',
      '--owner',
      'ops@example.com',
      '--days',
      '30',
    ]),
    NOW,
  );
  const records = parseMachineKeys([record]);
  assert.equal(records.length, 1);
  const request = new Request('https://docs.example.com/', {
    headers: { Authorization: `Bearer ${key}` },
  });
  assert.equal(presentedKey(request), key);
  assert.equal((await findMachineKey(key, records, NOW))?.name, 'smoke');
  assert.equal(
    await findMachineKey(key, records, NOW + 31 * 86_400_000),
    undefined,
  );
  assert.equal(record.expires, '2026-11-02T12:00:00.000Z');
  assert.ok(!JSON.stringify(record).includes(key));
});

test('groups are lowercased, deduplicated and sorted; expiry defaults to 90 days', () => {
  assert.deepEqual(
    parseMachineKeyArguments([
      '--name',
      'agent',
      '--owner',
      'Team',
      '--group',
      'Writers@example.com',
      '--group',
      'engineering@example.com',
      '--group',
      'writers@example.com',
    ]),
    {
      name: 'agent',
      owner: 'Team',
      groups: ['engineering@example.com', 'writers@example.com'],
      days: 90,
    },
  );
});

test('a missing name or owner, a bad group or a bad lifetime is refused', () => {
  assert.throws(() => parseMachineKeyArguments(['--name', 'x']), /Usage:/u);
  assert.throws(() => parseMachineKeyArguments(['--owner', 'x']), /Usage:/u);
  assert.throws(
    () => parseMachineKeyArguments(['--name', 'x', '--owner', 'y', 'stray']),
    /Usage:/u,
  );
  assert.throws(
    () =>
      parseMachineKeyArguments([
        '--name',
        'x',
        '--owner',
        'y',
        '--group',
        'not an address',
      ]),
    /--group takes a group address/u,
  );
  for (const days of ['0', '91', '1.5', '-1', '']) {
    assert.throws(
      () =>
        parseMachineKeyArguments([
          '--name',
          'x',
          '--owner',
          'y',
          '--days',
          days,
        ]),
      // `-1` reads as a flag, so it is refused with the usage line.
      /--days takes a whole number|Usage:/u,
      days,
    );
  }
});
