import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

test('automatic source checks use no deployment credentials or distribution artifacts', () => {
  const directory = new URL('../.github/workflows/', import.meta.url);
  assert.deepEqual(readdirSync(directory).sort(), ['android-publish.yml', 'android-release.yml', 'checks.yml', 'deploy.yml']);
  const workflow = readFileSync(new URL('checks.yml', directory), 'utf8');
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /backend-run\.mjs/);
  assert.match(workflow, /backend-api\.mjs/);
  assert.match(workflow, /:app:testDebugUnitTest :app:assembleDebug/);
  assert.doesNotMatch(workflow, /secrets\.|contents: write|id-token: write|self-hosted|workflow_run|pull_request_target|upload-artifact/);
  assert.doesNotMatch(workflow, /\b(?:scp|ssh|sftp|rsync)\s|wrangler\s+(?:deploy|publish)|npm\s+publish|docker\s+push|gh\s+release\s+create|bundleRelease|assembleRelease/);
  for (const path of ['server/config.php', 'server/var', 'public/downloads/GENESIS-Android-1.2.2.apk'])
    assert(!existsSync(new URL(`../${path}`, import.meta.url)), `${path} must remain outside public sources`);
});

test('Android distribution remains manual, source-gated and separate from automatic checks', () => {
  for (const name of ['android-release.yml','android-publish.yml']) {
    const workflow=readFileSync(new URL(`../.github/workflows/${name}`,import.meta.url),'utf8');
    const triggers=workflow.slice(workflow.indexOf('\non:'),workflow.indexOf('\npermissions:'));
    assert.match(triggers,/workflow_dispatch:/);
    assert.doesNotMatch(triggers,/\b(?:push|pull_request|schedule|workflow_run):/);
    assert.doesNotMatch(workflow,/contents: write|id-token: write|self-hosted|cancel-in-progress: true/);
    assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
    const gate=workflow.indexOf('node scripts/deployment/source-checks.mjs');
    assert(gate>0&&gate<workflow.indexOf('secrets.'));
    for(const match of workflow.matchAll(/TARGET: ['"]([^'"]+)['"]/g))
      assert(match[1].startsWith('/home/u531952483/domains/genesiscalendar.com/'),match[1]);
  }
  const release=readFileSync(new URL('../.github/workflows/android-release.yml',import.meta.url),'utf8');
  assert.match(release,/certificate SHA-256 digest: 1e161d36f574b0560d808c7ee95e1abe98165b3385336d0276fb381dfd901cb8/);
  assert.doesNotMatch(release,/HOSTINGER_SSH_KEY|\b(?:rsync|scp)\s/);
  const publish=readFileSync(new URL('../.github/workflows/android-publish.yml',import.meta.url),'utf8');
  assert.match(publish,/vars\.GENESIS_DEPLOY_ANDROID == 'true'/);
  assert.match(publish,/group: genesis-production/);
  assert.match(publish,/\.head_sha == \$sha and \.head_branch == "main"/);
  assert.match(publish,/\.path == "\.github\/workflows\/android-release\.yml"/);
  assert.match(publish,/\.event == "workflow_dispatch" and \.status == "completed" and \.conclusion == "success"/);
  assert(publish.indexOf('name: Stage the immutable checked APK')<publish.indexOf('name: Activate the update manifest'));
  assert.match(publish,/BACKUP="\$ROOT\/backups\/android-manifest-/);
  assert.doesNotMatch(publish,/--delete|GENESIS_ANDROID_RELEASE_|server\/config\.php/);
});

test('production deployment is manual, source-gated and restricted to the website root', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const triggers = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
  assert.match(triggers, /workflow_dispatch:/);
  assert.doesNotMatch(triggers, /\b(?:push|pull_request|schedule|workflow_run):/);
  assert.match(workflow, /actions: read/);
  assert.doesNotMatch(workflow, /contents: write|id-token: write|cancel-in-progress: true|self-hosted/);
  const sourceGate = workflow.indexOf('run: node scripts/deployment/source-checks.mjs');
  assert(sourceGate > 0 && sourceGate < workflow.indexOf('secrets.HOSTINGER_SSH_KEY'));
  assert.match(workflow, /GENESIS_DEPLOY_ANDROID: 'false'/);
  assert.doesNotMatch(workflow, /assembleRelease|bundleRelease|gh\s+release|BEGET_SSH_KEY/);
  assert.deepEqual([...new Set([...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map(match => match[1]))], ['HOSTINGER_SSH_KEY']);
  for (const match of workflow.matchAll(/TARGET: "([^"]+)"/g))
    assert(match[1].startsWith('/home/u531952483/domains/genesiscalendar.com/'), match[1]);
  assert.match(workflow, /EXCLUDE: "config.php, config.example.php, var\/, .git\/"/);
  assert.match(workflow, /EXCLUDE: "assets\/, downloads\/, android-update.json"/);
  assert.match(workflow, /SCRIPT_BEFORE_REQUIRED: true/);
  assert.match(workflow, /--backup-root="\$ROOT\/backups" --retain=20/);
  assert.match(workflow, /--root=\/home\/u531952483\/domains\/genesiscalendar.com --prune/);
  assert(workflow.indexOf('name: Back up runtime') < workflow.indexOf('name: Deploy private server'));
  assert(workflow.indexOf('name: Stage immutable') < workflow.indexOf('name: Deploy public client'));
});
