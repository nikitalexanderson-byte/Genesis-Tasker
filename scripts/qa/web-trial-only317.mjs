import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { verifyTrialWeb317 } from './web-trials317.mjs';

const baseURL = process.env.GENESIS_QA_WEB_ORIGIN;
const output = process.env.GENESIS_QA_WEB_OUTPUT;
assert(process.env.GENESIS_QA_PHASE === 'isolated' && /^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL ?? '') && output);
const browser = await chromium.launch({ headless: true });
try {
  const results = await verifyTrialWeb317({ browser, baseURL, output });
  const summary = { PASS: results.filter(row => row.status === 'PASS').length, FAIL: results.filter(row => row.status === 'FAIL').length };
  writeFileSync(`${output}/results.json`, JSON.stringify({ suite: 'trial317', summary, results }, null, 2));
  console.log(JSON.stringify(summary));
  process.exitCode = summary.FAIL || !results.length ? 1 : 0;
} finally { await browser.close(); }
