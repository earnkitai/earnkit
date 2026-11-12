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

// v6.1.18 Task 6a (L40-B2, L40-C3): a trailing dot, a look-alike earnkit.com, the Railway app domain, an empty database
// host and a `hostaddr=` parameter are refused.
test('reproTarget (L40-B2): earnkit.com with a trailing dot or in look-alike letters is refused, even with REPRO_ALLOW_REMOTE=1', () => {
  for (const url of ['https://earnkit.com.', 'https://earnkit.com..', 'https://www.earnkit.com./mcp', 'https://еarnkit.com', 'https://earnkіt.com',
    'https://ꓰꓮꓣꓠꓗꓲꓔ.com', 'https://earnᏦit.com', 'https://xn--arnkit-2of.com', 'https://api.еarnkit.com.', 'https://ｅarnkit.com']) {
    assert.throws(() => reproTarget({ REPRO_BASE_URL: url }), /local only/, url);
    assert.throws(() => reproTarget({ REPRO_BASE_URL: url, REPRO_ALLOW_REMOTE: '1' }), /local only/, url);
  }
  // A trailing dot on this machine's name is still this machine.
  assert.equal(reproTarget({ REPRO_BASE_URL: 'http://localhost.:4600' }).base, 'http://localhost.:4600');
  // Another name that merely contains the word is not earnkit.com.
  assert.equal(reproTarget({ REPRO_BASE_URL: 'http://notearnkit.example', REPRO_ALLOW_REMOTE: '1' }).base, 'http://notearnkit.example');
});

test('reproTarget (L40-B2): the Railway app domain is refused always', () => {
  for (const url of ['https://earnkit-production.up.railway.app', 'https://x.up.railway.app.', 'https://X.UP.RAILWAY.APP/mcp', 'https://up.railway.app']) {
    assert.throws(() => reproTarget({ REPRO_BASE_URL: url }), /local only/, url);
    assert.throws(() => reproTarget({ REPRO_BASE_URL: url, REPRO_ALLOW_REMOTE: '1' }), /local only/, url);
  }
});

test('reproTarget (L40-C3): the database check refuses an empty host and a hostaddr parameter', () => {
  for (const database of ['postgresql:///earnkit_journeys', 'postgresql://:5432/x', 'postgresql://localhost/x?hostaddr=10.0.0.5',
    'postgresql://localhost/x?hostaddr=127.0.0.1', 'postgresql://localhost/x?sslmode=disable&HOSTADDR=10.0.0.5', 'postgresql://db.example.com./x'])
    assert.throws(() => reproTarget({ REPRO_DATABASE_URL: database }), /local only/, database);
  assert.equal(reproTarget({ REPRO_DATABASE_URL: 'postgresql://127.0.0.1:5432/x' }).database, 'postgresql://127.0.0.1:5432/x');
  assert.equal(reproTarget({ REPRO_DATABASE_URL: 'postgresql://localhost/x?host=/tmp' }).database, 'postgresql://localhost/x?host=/tmp');
});
