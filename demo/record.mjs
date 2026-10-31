// Records the demo against a live deployment with headless Chromium and writes demo/raw/<video>.webm plus
// demo/marks.json (when each narration segment starts). demo/compose.sh turns those into the final mp4.
//   PLAYWRIGHT_DIR=... CHROMIUM_PATH=... SHOTS_DIR=... node demo/record.mjs https://allowance-paypal-agents.vercel.app
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { title, flow, ablation, closing } from './slides.mjs';
const require = createRequire(process.env.PLAYWRIGHT_DIR + '/');
const { chromium } = require('playwright');
const BASE = process.argv[2] ?? 'https://allowance-paypal-agents.vercel.app';
const SHOTS = process.env.SHOTS_DIR ?? 'demo/shots';
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync('demo/raw', { recursive: true });
const dur = JSON.parse(fs.readFileSync('demo/audio/durations.json', 'utf8'));
const marks = {};
let T0 = 0;
const now = () => (Date.now() - T0) / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (t) => { const ms = (t - now()) * 1000; if (ms > 0) await sleep(ms); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir: 'demo/raw', size: { width: 1920, height: 1080 } } });
await context.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    Object.assign(c.style, { position: 'fixed', zIndex: 2147483647, width: '26px', height: '26px', borderRadius: '50%', background: 'rgba(20,112,90,.30)', border: '3px solid #14705a', pointerEvents: 'none', transform: 'translate(-50%,-50%)', left: '-100px', top: '-100px', transition: 'width .08s,height .08s' });
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { c.style.width = c.style.height = '16px'; }, true);
    addEventListener('mouseup', () => { c.style.width = c.style.height = '26px'; }, true);
  });
});
const page = await context.newPage();
T0 = Date.now();
page.on('dialog', (d) => d.accept());
page.on('response', async (res) => { if (res.url().includes('/api/purchases/') || res.url().includes('/api/agent')) console.log('API', res.request().method(), res.status(), (await res.text().catch(() => '')).slice(0, 140).replace(/\n/g, ' ')); });
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const smooth = (y) => page.evaluate((top) => window.scrollTo({ top, behavior: 'smooth' }), y);
async function settle() { let last = -1; for (let i = 0; i < 25; i++) { const y = await page.evaluate(() => window.scrollY); if (y === last) return; last = y; await sleep(200); } }
async function center(loc) { await loc.scrollIntoViewIfNeeded(); await settle(); const b = await loc.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 }); await sleep(300); }
async function click(loc) { await center(loc); await page.mouse.down(); await page.mouse.up(); }
async function segment(id, fn, tail = 1.2) { const start = now(); marks[id] = start; await fn(start); await until(start + dur[id] + tail); }
const mandatesApi = async () => (await fetch(BASE + '/api/mandates')).json();

// Warm the serverless functions while the title card shows.
void Promise.all(['/', '/dashboard', '/api/mandates', '/api/purchases'].map((p) => fetch(BASE + p).catch(() => null)));
await page.setContent(title);
await sleep(5500);
await page.setContent(flow);
await sleep(9500);

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await sleep(800);

await segment('s1', async () => {
  await page.mouse.move(1500, 330, { steps: 25 });
  await sleep(2500);
  await center(page.locator('aside p', { hasText: 'gift-finder' }).first());
  await sleep(2500);
  await center(page.locator('aside p', { hasText: 'office-restock' }).first());
  await sleep(2500);
  await smooth(430);
  await sleep(3000);
  await smooth(0);
}, 2.5);

await segment('s2', async () => {
  const input = page.getByLabel('Errand');
  await click(input);
  await input.fill('');
  await input.pressSequentially('Find warm merino hiking socks under $30 as a gift.', { delay: 28 });
  await sleep(500);
  const run = page.getByRole('button', { name: 'Run agent' });
  await click(run);
  await sleep(1500);
  for (let i = 0; i < 90; i++) {
    if (!(await page.getByRole('button', { name: 'Agent is shopping' }).count())) break;
    await sleep(1000);
  }
  if (await page.locator('p[role="alert"]').count()) console.log('agent run reported an error:', await page.locator('p[role="alert"]').first().innerText());
  await sleep(3500);
  await shot('01-agent-run');
  await smooth(520);
  await sleep(6000);
});

await segment('s3', async (start) => {
  await page.getByRole('heading', { name: /Waiting for you/ }).scrollIntoViewIfNeeded();
  await smooth(380);
  await shot('02-waiting-for-you');
  await until(start + 3.0);
  const watch = page.getByText('Altiplano Double Jeu').first();
  await watch.scrollIntoViewIfNeeded();
  await shot('03-denied-watch');
  await until(start + 9.5);
  await smooth(380);
  await sleep(1200);
  const approve = page.getByRole('button', { name: 'Approve and authorize' });
  const before = await approve.count();
  for (let attempt = 0; attempt < 2; attempt++) {
    await click(approve.first());
    for (let i = 0; i < 16; i++) { await sleep(500); if ((await approve.count()) < before) break; }
    if ((await approve.count()) < before) break;
    console.log('approve did not register, retrying');
  }
  await sleep(2500);
  const capture = page.getByRole('button', { name: /^Capture \$/ });
  const holds = await capture.count();
  await click(capture.first());
  for (let i = 0; i < 24; i++) { await sleep(500); if ((await capture.count()) < holds) break; }
  await sleep(2500);
  await shot('04-approved-and-captured');
}, 1.5);

await segment('s4', async (start) => {
  await click(page.getByRole('link', { name: 'Dashboard' }).first());
  await page.waitForLoadState('networkidle');
  await sleep(4500);
  await shot('05-dashboard-spend');
  await page.mouse.move(560, 560, { steps: 30 });
  await sleep(1500);
  await page.mouse.move(1180, 560, { steps: 30 });
  await until(start + 9.0);
  await click(page.getByText('Mandates and limits', { exact: true }).first());
  await sleep(5500);
  await shot('06-dashboard-limits');
  await page.mouse.move(700, 600, { steps: 30 });
  await sleep(2000);
  await click(page.getByText('Audit trail', { exact: true }).first());
  await sleep(6000);
  await shot('07-dashboard-audit');
}, 0.5);

await segment('s5', async () => {
  await click(page.getByText('Edit', { exact: true }).first());
  await sleep(3000);
  await click(page.getByText('Pause an agent', { exact: true }).first());
  for (let i = 0; i < 40; i++) {
    await sleep(2000);
    const m = await mandatesApi().catch(() => []);
    if (m.find((x) => x.agent === 'office-restock')?.paused) break;
  }
  await sleep(6000);
  await shot('08-treasurer-pauses-agent');
  await click(page.getByRole('link', { name: 'Approvals' }).first());
  await page.waitForLoadState('networkidle');
  await sleep(1500);
  await center(page.locator('aside p', { hasText: 'office-restock' }).first());
  await sleep(6500);
  await shot('08b-mandate-paused');
}, 1.5);

await segment('s6', async () => {
  await page.setContent(ablation);
  await shot('09-ablation');
}, 6);

await segment('s7', async () => {
  await page.setContent(closing);
  await shot('10-closing');
}, 7);

const videoPath = await page.video().path();
await context.close();
await browser.close();
fs.writeFileSync('demo/marks.json', JSON.stringify({ marks, total: now(), video: videoPath }, null, 2));
console.log('done', now().toFixed(1) + 's', videoPath);
