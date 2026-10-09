/**
 * 埋め込みデモ体験ウィジェットの通し確認。
 * お題を選ぶ→作る→再生→終了→別のお題、まで動かす。
 *   node tools/check-embed.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5175/embed';
mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: false });
// LP に貼る想定のサイズ（16:9）
const page = await browser.newPage({ viewport: { width: 1000, height: 563 } });

const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(
  () => !document.getElementById('btn-start')?.disabled,
  { timeout: 60_000 },
);
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/e1-choose.png' });
console.log('✓ お題選択');

// 2つめのお題を選ぶ
await page.click('.chip:nth-child(2)');
await page.waitForTimeout(250);
await page.screenshot({ path: 'shots/e2-chip.png' });
console.log('✓ お題の切り替え:', await page.textContent('#outline'));

await page.click('#btn-start');
await page.waitForTimeout(1800);
await page.screenshot({ path: 'shots/e3-generating.png' });

await page.waitForSelector('#bar:not([hidden])', { timeout: 90_000 });
console.log('✓ 生成完了・再生開始');

await page.waitForTimeout(6000);
await page.screenshot({ path: 'shots/e4-playing.png' });

// 終了まで待つ
await page.waitForSelector('#panel-end:not([hidden])', { timeout: 120_000 });
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/e5-end.png' });
console.log('✓ 再生完了:', await page.textContent('#end-note'));

await page.click('#btn-again');
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/e6-again.png' });
const backToChoose = await page.isVisible('#panel-start');
console.log(backToChoose ? '✓ お題選択に戻る' : '✗ お題選択に戻らない');

console.log(errors.length ? `\nエラー:\n${errors.join('\n')}` : '\nコンソールエラーなし');
await browser.close();
