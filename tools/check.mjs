/**
 * デモ画面の動作確認。既存の Google Chrome を使い、
 * 読み込み → 生成 → 再生 の各段階でスクリーンショットを撮る。
 *
 *   node tools/check.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:5175/';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });

// VRM の読み込み完了を待つ
await page.waitForFunction(
  () => document.getElementById('status-badge')?.textContent === '準備完了',
  { timeout: 60_000 },
);
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/1-ready.png` });
console.log('✓ VRM 読み込み完了');

// 生成
await page.click('#btn-generate');
await page.waitForTimeout(2600);
await page.screenshot({ path: `${OUT}/2-generating.png` });

await page.waitForSelector('.cutitem', { timeout: 30_000 });
console.log('✓ シーングラフ生成完了');

// 再生中の各カットを撮る
const marks = [1.5, 8, 16, 26, 34];
for (const [i, sec] of marks.entries()) {
  await page.evaluate((s) => {
    const track = document.getElementById('track');
    const r = track.getBoundingClientRect();
    const dur = Number(track.dataset.duration ?? 38);
    const ev = (type) =>
      new PointerEvent(type, {
        clientX: r.left + (s / dur) * r.width,
        clientY: r.top + r.height / 2,
        bubbles: true,
        pointerId: 1,
      });
    track.dispatchEvent(ev('pointerdown'));
  }, sec);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/3-play-${i + 1}-${sec}s.png` });
}
console.log('✓ 再生・スクラブ');

// インスペクタ編集
await page.click('.cutitem:nth-child(3)');
await page.selectOption('#ed-camera', 'wide');
await page.waitForTimeout(1100);
await page.screenshot({ path: `${OUT}/4-edit.png` });
console.log('✓ シーングラフ編集');

// シネマ表示
await page.click('#btn-cinema');
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/5-cinema.png` });
console.log('✓ シネマ表示');

if (errors.length) {
  console.log('\n--- コンソールエラー ---');
  for (const e of errors) console.log(e);
} else {
  console.log('\nコンソールエラーなし');
}

await browser.close();
