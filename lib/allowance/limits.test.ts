import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allow } from './limits.ts';

test('a client gets its quota per window and then waits', () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(allow('k', 3, 1000, t0 + i), true);
  assert.equal(allow('k', 3, 1000, t0 + 10), false);
  assert.equal(allow('other', 3, 1000, t0 + 10), true);
  assert.equal(allow('k', 3, 1000, t0 + 1500), true);
});
