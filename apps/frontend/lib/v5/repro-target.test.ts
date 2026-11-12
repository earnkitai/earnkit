import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reproTarget } from '../../scripts/repro/target';

// v6.1.17 Task 5 (Review Focus 7): the repro pack runs against the base URL and database in the environment, and
// refuses a target that is not this machine unless told otherwise; earnkit.com never.
test('reproTarget: the defaults are the local instance and earnkit_journeys', () => {
  const t = reproTarget({});
  assert.equal(t.base, 'http://localhost:4600');
  assert.equal(t.database, 'postgresql://localhost:5432/earnkit_journeys');
  assert.equal(reproTarget({ REPRO_BASE_URL: 'http://127.0.0.1:4600' }).base, 'http://127.0.0.1:4600');
  assert.equal(reproTarget({ REPRO_BASE_URL: 'http://[::1]:4597' }).base, 'http://[::1]:4597');
  assert.equal(reproTarget({ REPRO_DATABASE_URL: 'postgresql://localhost:5432/ek_t5' }).database, 'postgresql://localhost:5432/ek_t5');
});

test('reproTarget: earnkit.com is refused always; another host only with REPRO_ALLOW_REMOTE=1', () => {
  for (const url of ['https://earnkit.com', 'https://www.earnkit.com/mcp', 'https://EARNKIT.com']) {
    assert.throws(() => reproTarget({ REPRO_BASE_URL: url }), /local only/);
    assert.throws(() => reproTarget({ REPRO_BASE_URL: url, REPRO_ALLOW_REMOTE: '1' }), /local only/);
  }
  assert.throws(() => reproTarget({ REPRO_BASE_URL: 'http://example.com' }), /local only/);
  assert.throws(() => reproTarget({ REPRO_BASE_URL: 'http://localhost.example.com' }), /local only/);
  assert.throws(() => reproTarget({ REPRO_BASE_URL: 'http://example.com', REPRO_ALLOW_REMOTE: 'yes' }), /local only/);
  assert.equal(reproTarget({ REPRO_BASE_URL: 'http://example.com', REPRO_ALLOW_REMOTE: '1' }).base, 'http://example.com');
  assert.throws(() => reproTarget({ REPRO_BASE_URL: 'not a url' }), /local only/);
  assert.throws(() => reproTarget({ REPRO_DATABASE_URL: 'postgresql://db.example.com:5432/x' }), /local only/);
  assert.throws(() => reproTarget({ REPRO_DATABASE_URL: 'postgresql://localhost/x?host=db.example.com' }), /local only/);
});
