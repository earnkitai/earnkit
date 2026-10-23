import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refKey, reportedNameIn } from './project-name';
import { displayName, keyName } from './bench-reply';

test('v3.1 GTM W3: one name per project, the builder-given one first, never the host when a name exists', () => {
  const projects = [
    { name: 'MealMate', live_url: 'https://mealmate.lovable.app' },
    { name: 'VaultPilot', repo: 'https://github.com/kai-onchain/vaultpilot', live_url: 'https://vaultpilot.app' },
  ];
  assert.equal(refKey('https://www.Mealmate.lovable.app/'), 'mealmate.lovable.app');
  assert.equal(reportedNameIn(projects, 'https://mealmate.lovable.app/'), 'MealMate');
  assert.equal(reportedNameIn(projects, 'kai-onchain/vaultpilot'), 'VaultPilot');
  assert.equal(reportedNameIn(projects, 'someone/else'), null);
  assert.equal(reportedNameIn(null, 'kai-onchain/vaultpilot'), null);
  // The reply keeps the builder's casing; with no name given, a host stays a host and a repo name is title-cased.
  assert.equal(displayName('VaultPilot', 'kai-onchain/vaultpilot', null), 'VaultPilot');
  assert.equal(displayName('MealMate', 'https://mealmate.lovable.app', null), 'MealMate');
  assert.equal(keyName('https://mealmate.lovable.app'), 'mealmate.lovable.app');
  assert.equal(displayName(keyName('https://mealmate.lovable.app'), 'https://mealmate.lovable.app', null), 'mealmate.lovable.app');
  assert.equal(displayName('vaultpilot', 'kai-onchain/vaultpilot', null), 'Vaultpilot');
  assert.equal(displayName('earnkit', 'jenil/earnkit', 'EarnKit | Get paid'), 'EarnKit');
});
