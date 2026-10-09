/**
 * ポーズ確認用。各ジェスチャをカット先頭から 1.3 秒進めた状態でステージだけ撮る。
 *   node tools/poses.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5175/';
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(
  () => document.getElementById('status-badge')?.textContent === '準備完了',
  { timeout: 60_000 },
);
await page.click('#btn-generate');
await page.waitForSelector('.cutitem', { timeout: 30_000 });

const stage = page.locator('#stage');

for (const g of ['idle', 'present', 'nod', 'think', 'emphasize']) {
  await page.click('.cutitem:nth-child(1)');
  await page.selectOption('#ed-gesture', g);
  await page.selectOption('#ed-camera', 'wide');
  await page.waitForTimeout(1300);
  await stage.screenshot({ path: `shots/pose-${g}.png` });
  console.log('✓', g);
}

await browser.close();
