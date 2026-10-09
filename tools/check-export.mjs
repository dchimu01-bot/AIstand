/**
 * 書き出しの実測。生成 → 書き出しを走らせ、out/ に MP4 が保存されるまで見る。
 *   node tools/check-export.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5175/';
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(
  () => document.getElementById('status-badge')?.textContent === '準備完了',
  { timeout: 60_000 },
);
await page.click('#btn-generate');
await page.waitForSelector('.cutitem', { timeout: 60_000 });
console.log('生成完了 — 書き出しを開始（実時間で録画するので約50秒 + MP4変換）');

await page.click('#btn-export');
await page.waitForTimeout(12_000);
await page.screenshot({ path: 'shots/6-exporting.png' });

await page.waitForSelector('#saved:not([hidden])', { timeout: 180_000 });
console.log('保存先:', await page.textContent('#saved-path'));
console.log('サイズ:', await page.textContent('#saved-size'));
console.log('バッジ:', await page.textContent('#status-badge'));
await page.screenshot({ path: 'shots/7-saved.png' });

if (errors.length) console.log('pageerror:', errors);
await browser.close();
