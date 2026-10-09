/**
 * デモ用の最小サーバー。public/ を配信しつつ、/api/tts で Google Cloud TTS を叩く。
 *
 * ブラウザに API キーを置かないためだけに存在する。
 * 合成結果は .cache/tts に置いて、2回目以降は API を叩かない
 * （デモは同じ台詞を何度も喋らせるので、これが無いと無駄に課金される）。
 */

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);

try {
  process.loadEnvFile('.env');
} catch {
  /* .env が無ければ環境変数をそのまま使う */
}

const PORT = Number(process.env.PORT ?? 5175);
const PUBLIC_DIR = new URL('./public/', import.meta.url).pathname;
const CACHE_DIR = new URL('./.cache/tts/', import.meta.url).pathname;
const OUT_DIR = new URL('./out/', import.meta.url).pathname;
const API_KEY = process.env.GOOGLE_TTS_API_KEY;

await mkdir(CACHE_DIR, { recursive: true });
await mkdir(OUT_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.vrm': 'model/gltf-binary',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

const escapeXml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * セグメントの切れ目に mark を挿し、そのタイムポイントを返してもらう。
 * これが口パクのアンカーになるので、長い台詞でもズレが溜まらない。
 */
function buildSsml(segments) {
  const body = segments.map((s, i) => `<mark name="s${i}"/>${escapeXml(s)}`).join('');
  return `<speak>${body}<mark name="s${segments.length}"/></speak>`;
}

async function synthesize({ segments, voice, pitch, rate }) {
  const key = createHash('sha1')
    .update(JSON.stringify({ segments, voice, pitch, rate }))
    .digest('hex');
  const audioPath = join(CACHE_DIR, `${key}.mp3`);
  const metaPath = join(CACHE_DIR, `${key}.json`);

  if (existsSync(audioPath) && existsSync(metaPath)) {
    const [audio, meta] = await Promise.all([readFile(audioPath), readFile(metaPath, 'utf8')]);
    return { audio, marks: JSON.parse(meta), cached: true };
  }

  const res = await fetch(
    `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: { ssml: buildSsml(segments) },
        voice: { languageCode: 'ja-JP', name: voice },
        audioConfig: { audioEncoding: 'MP3', speakingRate: rate, pitch },
        enableTimePointing: ['SSML_MARK'],
      }),
    },
  );

  if (!res.ok) throw new Error(`Google TTS ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const audio = Buffer.from(data.audioContent, 'base64');
  // timepoints は mark 名の順に返るとは限らないので並べ直す
  const marks = (data.timepoints ?? [])
    .map((tp) => ({ i: Number(tp.markName.slice(1)), t: tp.timeSeconds ?? 0 }))
    .sort((a, b) => a.i - b.i)
    .map((m) => m.t);

  await Promise.all([writeFile(audioPath, audio), writeFile(metaPath, JSON.stringify(marks))]);
  return { audio, marks, cached: false };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** ファイル名に使えない文字を落とす。 */
function safeName(name) {
  return (name || 'video').replace(/[\\/:*?"<>|\n\r\t]/g, '_').slice(0, 120);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * ブラウザが録った WebM を out/ に保存し、MP4 に変換する。
 * MediaRecorder の WebM は尺がヘッダに入らず QuickTime でも開けないので、
 * 配布や広告に使えるのは実質こちら。
 */
async function saveRecording(buffer, rawName) {
  const base = `${safeName(rawName)}-${stamp()}`;
  const webmPath = join(OUT_DIR, `${base}.webm`);
  const mp4Path = join(OUT_DIR, `${base}.mp4`);
  await writeFile(webmPath, buffer);

  try {
    await run(ffmpegPath, [
      '-y',
      '-i', webmPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      // MediaRecorder の可変フレームレートを固定にならす
      '-vsync', 'cfr',
      '-r', '30',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      mp4Path,
    ]);
  } catch (err) {
    console.error('[save] mp4 変換に失敗:', err.stderr?.slice(-400) ?? err.message);
    const { size } = await stat(webmPath);
    return { file: `${base}.webm`, size, mp4: false };
  }

  await rm(webmPath, { force: true }); // MP4 ができたら WebM は残さない
  const { size } = await stat(mp4Path);
  return { file: `${base}.mp4`, size, mp4: true };
}

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/tts') {
    if (!API_KEY) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'GOOGLE_TTS_API_KEY が設定されていません' }));
      return;
    }
    try {
      const { segments, voice, pitch, rate } = JSON.parse((await readBody(req)).toString('utf8'));
      if (!Array.isArray(segments) || !segments.length) throw new Error('segments が空です');
      const { audio, marks, cached } = await synthesize({
        segments,
        voice: voice ?? 'ja-JP-Neural2-B',
        pitch: pitch ?? 0,
        rate: rate ?? 1.0,
      });
      res.writeHead(200, {
        'content-type': 'application/json',
        'x-tts-cache': cached ? 'hit' : 'miss',
      });
      res.end(JSON.stringify({ audio: audio.toString('base64'), marks }));
    } catch (err) {
      console.error('[tts]', err.message);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err.message ?? err) }));
    }
    return;
  }

  if (req.method === 'POST' && req.url?.startsWith('/api/save')) {
    try {
      const name = new URL(req.url, 'http://x').searchParams.get('name') ?? 'video';
      const saved = await saveRecording(await readBody(req), name);
      console.log(`[save] out/${saved.file} (${(saved.size / 1e6).toFixed(1)} MB)`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(saved));
    } catch (err) {
      console.error('[save]', err.message);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err.message ?? err) }));
    }
    return;
  }

  // 静的配信。/out/ は書き出した動画を開けるように公開する
  const rel = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const fromOut = rel.startsWith('/out/');
  const root = fromOut ? OUT_DIR : PUBLIC_DIR;
  const ALIAS = { '/': 'index.html', '/embed': 'embed.html', '/demo': 'demo.html', '/chatbot': 'chatbot.html' };
  const path = join(root, fromOut ? rel.slice('/out/'.length) : (ALIAS[rel] ?? rel));
  if (!path.startsWith(root) || !existsSync(path)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(path)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  res.end(await readFile(path));
});

server.listen(PORT, () => {
  console.log(`VTuber Studio デモ: http://localhost:${PORT}`);
  if (!API_KEY) console.warn('警告: GOOGLE_TTS_API_KEY が無いので音声合成は使えません');
});
