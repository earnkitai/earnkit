import { test } from 'node:test';
import assert from 'node:assert/strict';
import { llamaPrice, type PriceFetch } from './prices';

const MINI = 'base:0x534b7aAD1Cdb6F02eC48CAbe428f0D9131E40B07';
const answer = (status: number, body: unknown): PriceFetch => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('llamaPrice reads the coin (case-insensitive key) and its time', async () => {
  const urls: string[] = [];
  const r = await llamaPrice(MINI, async (url) => {
    urls.push(url);
    return answer(200, { coins: { [MINI.toLowerCase()]: { price: 0.00000118, timestamp: 1_791_158_400 } } })(url);
  });
  assert.equal(urls[0], `https://coins.llama.fi/prices/current/${MINI}`);
  assert.equal(r.price, 0.00000118);
  assert.equal(r.at.toISOString(), new Date(1_791_158_400_000).toISOString());
});

test('llamaPrice refuses a missing coin, a zero price and a failed request', async () => {
  await assert.rejects(llamaPrice(MINI, answer(200, { coins: {} })), /no price/);
  await assert.rejects(llamaPrice(MINI, answer(200, { coins: { [MINI]: { price: 0 } } })), /no price/);
  await assert.rejects(llamaPrice(MINI, answer(502, {})), /502/);
});
