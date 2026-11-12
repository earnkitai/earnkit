/**
 * A valid program for tests, with any field overridden. Parsed, so defaults are filled.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProgramFile, type Program } from '../program-file';

export function programFixture(over: Partial<Program> & { id: string }): Program {
  return ProgramFile.parse({
    organizer: 'Test Org',
    title: 'Test Grants',
    description: 'Grants for builders.',
    source_url: 'https://example.com/grants',
    submission_url: 'https://example.com/apply',
    reward: 'Up to $5,000 per grant',
    starts_at: null,
    ends_at: null,
    status: 'active',
    verified_at: '2026-11-01',
    existing_work: 'allowed',
    setup: [],
    each_time: [],
    chains: ['base'],
    summary: 'Up to $5,000 · rolling',
    rules: [],
    needs_repo: false,
    submission_requirements: [
      { key: 'project_name', label: 'Project name', type: 'text', required: true, from: 'project', kind: 'name', todo: 'a project name' },
    ],
    ...over,
  });
}

/**
 * v6.1.18 Task 6a (L39-1): a catalog file as it was while open: `status: active` and no `opens_note`. Base Builder
 * Grants is upcoming since Round 2 closed, but it is the one program with a Builder Codes rule, so the tests of that
 * rule (eligibility, find, the journey) seed it open with this.
 */
export function openCatalogProgram(id: string): Program {
  const file = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../../programs', `${id}.json`), 'utf8'));
  const { opens_note: _note, ...rest } = file;
  return ProgramFile.parse({ ...rest, status: 'active' });
}
