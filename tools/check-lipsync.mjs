/**
 * 口パクが実音声に追従しているかを数値で確認する。
 * 発話区間では口形が動き、カット間の「間」では閉じているはず。
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
await page.goto('http://localhost:5175/', { waitUntil: 'networkidle' });
await page.waitForFunction(
  () => document.getElementById('status-badge')?.textContent === '準備完了',
  { timeout: 60_000 },
);
await page.click('#btn-generate');
await page.waitForSelector('.cutitem', { timeout: 60_000 });
await page.waitForTimeout(400);

const spans = await page.evaluate(() =>
  window.__studio.timeline.spans.map((s) => ({
    id: s.id, start: s.start, speechEnd: s.speechEnd, end: s.end,
  })),
);

const openness = async (t) => {
  const v = await page.evaluate((x) => window.__studio.probe(x), t);
  return Math.max(v.aa, v.ih, v.ou, v.ee, v.oh);
};

let failures = 0;
for (const s of spans) {
  // 発話区間を 40 点サンプリング
  const samples = [];
  for (let i = 0; i < 40; i++) {
    samples.push(await openness(s.start + ((s.speechEnd - s.start) * (i + 0.5)) / 40));
  }
  const moving = samples.filter((v) => v > 0.05).length;
  const peak = Math.max(...samples);

  // 「間」の中央
  const gapMid = (s.speechEnd + s.end) / 2;
  const gap = s.end - s.speechEnd > 0.15 ? await openness(gapMid) : null;

  const ok = moving >= 24 && peak > 0.6 && (gap === null || gap < 0.02);
  if (!ok) failures++;
  console.log(
    `${ok ? '✓' : '✗'} ${s.id}  発話 ${(s.speechEnd - s.start).toFixed(2)}s  ` +
      `口が開いたサンプル ${moving}/40  最大 ${peak.toFixed(2)}  ` +
      `間 ${gap === null ? '—' : gap.toFixed(3)}`,
  );
}

console.log(failures ? `\n${failures} 件が期待外れ` : '\nすべて期待どおり');
await browser.close();
