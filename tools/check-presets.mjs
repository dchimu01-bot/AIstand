/**
 * プリセットの say と kana で句読点の数がそろっているかを検査する。
 * ずれていると TTS のタイムポイントを口パクのアンカーに使えず、
 * そのカットだけ均等割りにフォールバックしてしまう。
 *   node tools/check-presets.mjs
 */
import { readFileSync } from 'node:fs';

const split = (t) =>
  (t.match(/[^、。！？]*[、。！？]|[^、。！？]+/g) ?? []).map((s) => s.trim()).filter(Boolean);

let bad = 0;
for (const file of ['src/presets.ts', 'src/sample.ts']) {
  const src = readFileSync(file, 'utf8');
  const says = [...src.matchAll(/^\s+say: '(.+)',$/gm)].map((m) => m[1]);
  const kanas = [...src.matchAll(/^\s+kana: '(.+)',$/gm)].map((m) => m[1]);
  if (says.length !== kanas.length) {
    console.log(`✗ ${file}: say と kana の数が違う (${says.length} / ${kanas.length})`);
    bad++;
    continue;
  }
  says.forEach((s, i) => {
    const a = split(s).length;
    const b = split(kanas[i]).length;
    if (a !== b) {
      bad++;
      console.log(`✗ ${file} [${i}] say=${a} kana=${b}\n    ${s}\n    ${kanas[i]}`);
    }
  });
  console.log(`${file}: ${says.length} カットを検査`);
}
console.log(bad ? `\n${bad} 件ずれています` : '\nすべてそろっています');
process.exit(bad ? 1 : 0);
