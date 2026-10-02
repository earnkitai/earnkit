import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SponsorCampaignInput } from './tools';

const REF = `0x${'a'.repeat(64)}`;

test('SponsorCampaignInput accepts a valid create input', () => {
  const result = SponsorCampaignInput.safeParse({
    action: 'create',
    sponsor_wallet: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    sponsor_name: 'Acme',
    title: 'Build on Acme',
    theme: 'Build something cool with the Acme SDK during the campaign.',
    criteria: 'Judged on creativity and polish.',
    chains: ['base'],
    token: 'USDC',
    amount: '5000',
    winners: 3,
    ends_at: '2026-12-01T00:00:00Z',
  });
  assert.equal(result.success, true);
});

test('SponsorCampaignInput accepts a valid status input', () => {
  const result = SponsorCampaignInput.safeParse({ action: 'status', ref: REF });
  assert.equal(result.success, true);
});

test('SponsorCampaignInput: status takes no tx hash any more', () => {
  assert.equal(
    SponsorCampaignInput.safeParse({
      action: 'status',
      ref: REF,
      tx: `0x${'b'.repeat(64)}`,
    }).success,
    false,
  );
});

test('SponsorCampaignInput: create needs sponsor_wallet', () => {
  const { success } = SponsorCampaignInput.safeParse({
    action: 'create',
    sponsor_name: 'Acme',
    title: 'Build on Acme',
    theme: 'Build something cool with the Acme SDK during the campaign.',
    criteria: 'Judged on creativity and polish.',
    chains: ['base'],
    token: 'USDC',
    amount: '5000',
    winners: 3,
    ends_at: '2026-12-01T00:00:00Z',
  });
  assert.equal(success, false);
});

test('SponsorCampaignInput accepts a valid award input', () => {
  const result = SponsorCampaignInput.safeParse({
    action: 'award',
    ref: REF,
    winners: [{ entry_id: 1, amount: '100', reason: 'Best use of the SDK' }],
  });
  assert.equal(result.success, true);
});

test('SponsorCampaignInput rejects an award whose winners is a number', () => {
  const result = SponsorCampaignInput.safeParse({
    action: 'award',
    ref: REF,
    winners: 3,
  });
  assert.equal(result.success, false);
});
