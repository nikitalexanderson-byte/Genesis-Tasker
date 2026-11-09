import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const productionRepository = 'nikitalexanderson-byte/Genesis-Tasker';
const fullSha = /^[a-f0-9]{40}$/;

/** Deployment accepts a reviewed current-main commit, never a fork or an older successful run. */
export function requireSuccessfulSourceChecks({ repository, requested, checkedOut, currentMain, runs }) {
  if (repository !== productionRepository) throw new Error('Unexpected deployment repository');
  if (!fullSha.test(requested ?? '') || checkedOut !== requested || currentMain !== requested)
    throw new Error('Requested commit must equal the checkout and current main');
  if (!Array.isArray(runs)) throw new Error('Source-check run list is unavailable');
  const eligible = runs.filter(run => run.head_sha === requested && run.head_branch === 'main'
    && run.head_repository?.full_name === repository && run.path === '.github/workflows/checks.yml'
    && ['push', 'workflow_dispatch'].includes(run.event)).sort((a, b) => b.id - a.id);
  const latest = eligible[0];
  if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success')
    throw new Error('The latest Source checks run for this exact main commit must succeed');
  return { runId: latest.id, commit: requested };
}

async function verify() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (repository !== productionRepository || process.env.GITHUB_REF !== 'refs/heads/main')
    throw new Error('Deployment must be dispatched from the production repository main branch');
  const requested = process.env.DEPLOY_COMMIT;
  if (!fullSha.test(requested ?? '')) throw new Error('A full commit SHA is required');
  if (!fullSha.test(process.env.EXPECTED_CURRENT_COMMIT ?? '')) throw new Error('A full incumbent production SHA is required');
  if (process.env.GENESIS_DEPLOY_TARGET !== 'hostinger' || process.env.GENESIS_DEPLOY_ANDROID !== 'false')
    throw new Error('This workflow publishes only the Hostinger website and API');
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('Read-only GitHub verification token is unavailable');
  const read = async path => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`GitHub verification returned HTTP ${response.status}`);
    return response.json();
  };
  const main = await read('git/ref/heads/main');
  const result = await read(`actions/workflows/checks.yml/runs?per_page=100&head_sha=${requested}`);
  const checkedOut = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const verified = requireSuccessfulSourceChecks({ repository, requested, checkedOut, currentMain: main.object?.sha, runs: result.workflow_runs });
  console.log(`Source checks verified: ${verified.commit}, run ${verified.runId}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verify();
}
