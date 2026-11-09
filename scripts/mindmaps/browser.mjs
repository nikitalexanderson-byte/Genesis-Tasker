import { createRequire } from 'node:module';
if (process.env.GENESIS_MINDMAPS_TEST !== 'isolated') throw new Error('Set GENESIS_MINDMAPS_TEST=isolated. These scripts are only for the local fixture.');
// Point to an installed Playwright package.json; no production dependency is added.
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE || import.meta.url);
export const { chromium } = require('playwright');
