// Drives the Studio AI assistant in a headless browser: asks the treasurer agent to pause office-restock and
// confirms the mandate really changed through the API. Used to produce docs/ai-treasurer.png.
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_DIR + '/');
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:3100';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
page.on('dialog', (d) => { console.log('dialog:', d.message()); d.accept(); });
await page.goto(base + '/dashboard', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.getByText('Edit', { exact: true }).first().click();
await page.waitForTimeout(2500);
await page.getByText('Pause an agent', { exact: true }).first().click();
const before = await (await fetch(base + '/api/mandates')).json();
console.log('before', before.map((m) => [m.agent, m.paused]));
let after;
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(3000);
  after = await (await fetch(base + '/api/mandates')).json();
  if (after.find((m) => m.agent === 'office-restock')?.paused) break;
}
console.log('after', after.map((m) => [m.agent, m.paused]));
await page.waitForTimeout(6000);
await page.screenshot({ path: process.argv[3] ?? 'docs/ai-treasurer.png' });
await browser.close();
