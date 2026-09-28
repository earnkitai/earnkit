import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareSubmission } from './submission';
import type { SubmissionRequirement } from './program-file';

const reqs: SubmissionRequirement[] = [
  {
    key: 'project_name',
    label: 'Project name',
    type: 'text',
    required: true,
    project_field: 'name',
    from: 'project',
  },
  {
    key: 'github',
    label: 'GitHub repo',
    type: 'url',
    required: true,
    project_field: 'repo_url',
    from: 'project',
  },
  {
    key: 'how_it_works',
    label: 'How does it use the API?',
    type: 'text',
    required: true,
    from: 'project',
  },
  {
    key: 'email',
    label: 'Contact email',
    type: 'email',
    required: true,
    from: 'builder',
  },
  {
    key: 'video',
    label: 'Demo video',
    type: 'url',
    required: false,
    project_field: 'demo_url',
    from: 'project',
  },
];

test('fills from project fields and explicit answers', () => {
  const r = prepareSubmission(reqs, {
    project: { name: 'Agent Checkout', repo_url: 'https://github.com/a/b' },
    answers: { email: 'me@example.com' },
  });
  assert.deepEqual(
    r.complete.map((c) => [c.key, c.value, c.filled_from]),
    [
      ['project_name', 'Agent Checkout', 'name'],
      ['github', 'https://github.com/a/b', 'repo_url'],
      ['email', 'me@example.com', 'answer'],
    ],
  );
  assert.deepEqual(
    r.missing.map((m) => m.key),
    ['how_it_works', 'video'],
  );
  assert.equal(r.ready, false);
});

test('explicit answer wins over project field', () => {
  const r = prepareSubmission(reqs, {
    project: { name: 'Old' },
    answers: { project_name: 'New' },
  });
  assert.equal(r.complete.find((c) => c.key === 'project_name')?.value, 'New');
});

test('personal info is never guessed and says to ask the builder', () => {
  const r = prepareSubmission(reqs, { project: { name: 'X' } });
  const email = r.missing.find((m) => m.key === 'email');
  assert.match(email!.next_step, /Ask the builder/);
  assert.equal(
    r.complete.some((c) => c.key === 'email'),
    false,
  );
});

test('invalid values are reported as missing with the problem', () => {
  const r = prepareSubmission(reqs, {
    project: { repo_url: 'not a url' },
    answers: { email: 'nope' },
  });
  assert.equal(
    r.missing.find((m) => m.key === 'github')?.problem,
    'Not a valid http(s) link.',
  );
  assert.equal(
    r.missing.find((m) => m.key === 'email')?.problem,
    'Not a valid email.',
  );
});

test('ready when only optional fields are missing; flags unknown answer keys', () => {
  const r = prepareSubmission(reqs, {
    project: { name: 'X', repo_url: 'https://github.com/a/b' },
    answers: {
      how_it_works: 'It calls the API.',
      email: 'a@b.co',
      typo_key: 'x',
    },
  });
  assert.equal(r.ready, true);
  assert.deepEqual(
    r.missing.map((m) => m.key),
    ['video'],
  );
  assert.deepEqual(r.unused_answers, ['typo_key']);
});

test('blank strings count as missing', () => {
  const r = prepareSubmission(reqs, { project: { name: '   ' } });
  assert.ok(r.missing.some((m) => m.key === 'project_name'));
});
