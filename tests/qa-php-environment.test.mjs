import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { backendPhpEnvironment } from '../scripts/qa/backend-php.mjs';

test('system PHP retains the system OpenSSL configuration', () => {
  assert.deepEqual(backendPhpEnvironment('php', {}, 'linux'), {});
  assert.deepEqual(backendPhpEnvironment('/usr/bin/php', {}, 'darwin'), {});
});

test('an explicit OpenSSL configuration remains authoritative', () => {
  for (const platform of ['linux', 'win32']) {
    assert.deepEqual(backendPhpEnvironment('php', { OPENSSL_CONF: '/custom/openssl.cnf' }, platform), {
      OPENSSL_CONF: '/custom/openssl.cnf',
    });
  }
});

test('Windows PHP uses a bundled OpenSSL configuration only when the file exists', () => {
  const directory = mkdtempSync(join(tmpdir(), 'genesis-php-config-'));
  try {
    const binary = join(directory, 'php.exe');
    assert.deepEqual(backendPhpEnvironment(binary, {}, 'win32'), {});
    const config = join(directory, 'extras', 'ssl', 'openssl.cnf');
    mkdirSync(join(directory, 'extras', 'ssl'), { recursive: true });
    writeFileSync(config, '# Local fixture\n');
    assert.deepEqual(backendPhpEnvironment(binary, {}, 'win32'), { OPENSSL_CONF: config });
    assert.deepEqual(backendPhpEnvironment(binary, {}, 'linux'), {});
  } finally {
    rmSync(directory, { recursive: true });
  }
});
