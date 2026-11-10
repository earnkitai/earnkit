/**
 * A valid program for tests, with any field overridden. Parsed, so defaults are filled.
 */
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
