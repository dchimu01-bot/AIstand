/**
 * 書き出した WebM の中身を確認する。out/sample.mp4 を一時的に public/ へ置いて開く。
 *   node tools/peek.mjs
 */
import { chromium } from 'playwright';
import { copyFile, writeFile, rm } from 'node:fs/promises';

const PAGE = 'public/__peek.html';
const VIDEO = 'public/__peek.mp4';

await copyFile('out/sample.mp4', VIDEO);
await writeFile(
  PAGE,
  `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">
<video id="v" width="1280" height="720" src="./__peek.mp4" muted></video>
<script>
const v = document.getElementById('v');
v.addEventListener('loadeddata', async () => {
  await v.play().catch(() => {}); v.pause();
  const s = v.captureStream ? v.captureStream() : null;
  window.__info = { duration: v.duration, w: v.videoWidth, h: v.videoHeight,
    audioTracks: s ? s.getAudioTracks().length : -1,
    videoTracks: s ? s.getVideoTracks().length : -1 };
  window.__ready = true;
});
window.__seek = (t) => { v.currentTime = t; };
</script></body>`,
);

const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1320, height: 760 } });
await page.goto('http://localhost:5175/__peek.html');
await page.waitForFunction(() => window.__ready === true, { timeout: 60_000 });
console.log(await page.evaluate(() => window.__info));

for (const t of [6, 16, 28, 40]) {
  await page.evaluate((s) => window.__seek(s), t);
  await page.waitForTimeout(1000);
  await page.locator('video').screenshot({ path: `shots/webm-${t}s.png` });
}

await browser.close();
await Promise.all([rm(PAGE), rm(VIDEO)]);
