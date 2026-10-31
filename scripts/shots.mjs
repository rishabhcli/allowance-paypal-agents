// Screenshots of the running app with headless Chromium.
//   CHROMIUM_PATH=... NODE_PATH=... node scripts/shots.mjs http://localhost:3100 docs
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_DIR ? process.env.PLAYWRIGHT_DIR + '/' : import.meta.url);
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:3100';
const out = process.argv[3] ?? 'docs';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1400 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
page.on('pageerror', (e) => errors.push('pageerror ' + e.message.slice(0, 200)));
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/approvals.png`, fullPage: true });
await page.goto(base + '/dashboard', { waitUntil: 'networkidle' });
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}/dashboard-spend.png` });
for (const [name, file] of [['Mandates and limits', 'dashboard-limits'], ['Audit trail', 'dashboard-audit']]) {
  await page.getByText(name, { exact: true }).first().click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/${file}.png` });
}
console.log('console errors:', errors.length, errors.slice(0, 6));
await browser.close();
