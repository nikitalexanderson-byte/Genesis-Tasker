import assert from 'node:assert/strict';
import test from 'node:test';
import { requireSuccessfulSourceChecks } from '../scripts/deployment/source-checks.mjs';

const repository = 'nikitalexanderson-byte/Genesis-Tasker';
const commit = 'a'.repeat(40);
const run = { id: 3, head_sha: commit, head_branch: 'main', head_repository: { full_name: repository },
  path: '.github/workflows/checks.yml', event: 'push', status: 'completed', conclusion: 'success' };
const input = { repository, requested: commit, checkedOut: commit, currentMain: commit, runs: [run] };

test('deployment accepts successful source checks for the exact current checkout', () => {
  assert.deepEqual(requireSuccessfulSourceChecks(input), { runId: 3, commit });
});

test('deployment rejects a fork, stale commit, different checkout and missing checks', () => {
  for (const changes of [
    { repository: 'someone/Genesis-Tasker' }, { requested: 'main' }, { currentMain: 'b'.repeat(40) },
    { checkedOut: 'b'.repeat(40) }, { runs: [] }, { runs: [{ ...run, head_sha: 'b'.repeat(40) }] },
    { runs: [{ ...run, head_repository: { full_name: 'someone/Genesis-Tasker' } }] },
    { runs: [{ ...run, path: '.github/workflows/unrelated.yml' }] },
    { runs: [{ ...run, event: 'pull_request' }] }, { runs: [{ ...run, head_branch: 'other' }] },
  ]) assert.throws(() => requireSuccessfulSourceChecks({ ...input, ...changes }));
});

test('an older success cannot hide a failed, pending or cancelled newer run', () => {
  for (const newer of [
    { status: 'in_progress', conclusion: null }, { status: 'queued', conclusion: null },
    { status: 'completed', conclusion: 'failure' }, { status: 'completed', conclusion: 'cancelled' },
  ]) assert.throws(() => requireSuccessfulSourceChecks({ ...input, runs: [run, { ...run, id: 4, ...newer }] }));
});
