/**
 * ブラウザだけで完結する動画書き出し。
 *
 * WebGL キャンバス（アバター）と、Canvas2D で描き直したスライド・字幕を
 * 1枚のキャンバスに合成し、MediaRecorder で WebM にする。
 * 本番はここをヘッドレス Chromium + ffmpeg に差し替える想定で、
 * 合成のレイアウト規則だけ共有すればよいようにしてある。
 */

import type { Stage } from './stage';
import type { Timeline, CutSpan } from './scenegraph';

/**
 * レイアウト定数は style.css の .slide-layer / .slide-title / .slide-bullets と
 * 対応させてある。片方を変えたらもう片方も合わせること。
 */
const PAD_LEFT = 0.055; // .slide-layer の padding-left
const SLIDE_WIDTH = 0.505; // 100% - 44%(右余白) - 5.5%(左余白)
const TITLE_RATIO = 0.074; // .slide-title の 7.4cqw
const BULLET_RATIO = 0.045; // .slide-bullets li の 4.5cqw
const SUBTITLE_WIDTH = 0.92; // .subtitle の left/right 4%

function pickMime(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

/** 日本語は単語境界がないので文字単位で折り返す。 */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const ch of paragraph) {
      if (ctx.measureText(line + ch).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createRadialGradient(w * 0.78, h * 0.18, 0, w * 0.78, h * 0.18, w * 1.15);
  g.addColorStop(0, '#2b3560');
  g.addColorStop(0.45, '#171d33');
  g.addColorStop(1, '#0e1322');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawSlide(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  span: CutSpan,
  tl: Timeline,
  alpha: number,
): void {
  const slide = tl.slides.find((s) => s.id === span.slide);
  if (!slide || alpha <= 0.01) return;

  const maxWidth = w * SLIDE_WIDTH;
  const x = w * PAD_LEFT;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 22;

  const titleSize = Math.round(maxWidth * TITLE_RATIO);
  const bulletSize = Math.round(maxWidth * BULLET_RATIO);
  const titleLead = titleSize * 1.32;
  const bulletLead = bulletSize * 1.45;
  const bulletGap = bulletSize * 0.58;

  // .slide-title の letter-spacing に合わせる。ここ1%で改行位置が変わる
  ctx.letterSpacing = '-0.01em';
  ctx.font = `700 ${titleSize}px "Hiragino Sans", "Noto Sans JP", sans-serif`;
  const titleLines = wrap(ctx, slide.title, maxWidth);

  ctx.letterSpacing = '0px';
  ctx.font = `400 ${bulletSize}px "Hiragino Sans", "Noto Sans JP", sans-serif`;
  const bulletBlocks = slide.bullets.map((b) => wrap(ctx, b, maxWidth - bulletSize * 1.2));

  const totalH =
    titleLines.length * titleLead +
    maxWidth * 0.04 +
    bulletBlocks.reduce((s, b) => s + b.length * bulletLead + bulletGap, 0);

  let y = (h - totalH) / 2;

  ctx.letterSpacing = '-0.01em';
  ctx.font = `700 ${titleSize}px "Hiragino Sans", "Noto Sans JP", sans-serif`;
  ctx.fillStyle = '#ffffff';
  for (const line of titleLines) {
    ctx.fillText(line, x, y);
    y += titleLead;
  }
  y += maxWidth * 0.04;

  ctx.letterSpacing = '0px';
  ctx.font = `400 ${bulletSize}px "Hiragino Sans", "Noto Sans JP", sans-serif`;
  for (const block of bulletBlocks) {
    const dashY = y + bulletSize * 0.62;
    ctx.save();
    ctx.shadowBlur = 0;
    const g = ctx.createLinearGradient(x, dashY, x + bulletSize * 0.72, dashY);
    g.addColorStop(0, '#37d6c3');
    g.addColorStop(1, '#6d7cff');
    ctx.fillStyle = g;
    ctx.fillRect(x, dashY, bulletSize * 0.72, 2);
    ctx.restore();

    ctx.fillStyle = 'rgba(232,236,246,0.9)';
    for (const line of block) {
      ctx.fillText(line, x + bulletSize * 1.2, y);
      y += bulletLead;
    }
    y += bulletGap;
  }

  ctx.restore();
}

function drawSubtitle(ctx: CanvasRenderingContext2D, w: number, h: number, text: string): void {
  if (!text) return;
  const size = Math.round(w * 0.025);
  ctx.save();
  ctx.font = `600 ${size}px "Hiragino Sans", "Noto Sans JP", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = 'rgba(0,0,0,0.95)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#fff';

  const lines = wrap(ctx, text, w * SUBTITLE_WIDTH);
  const lead = size * 1.5;
  let y = h * 0.958 - (lines.length - 1) * lead;
  for (const line of lines) {
    ctx.fillText(line, w / 2, y);
    y += lead;
  }
  ctx.restore();
}

export interface ExportHandle {
  /** 録画完了を待つ。停止は cancel() */
  done: Promise<Blob>;
  cancel(): void;
}

export interface ExportOptions {
  onProgress: (ratio: number) => void;
  /**
   * 現在のタイムライン時刻。音声の AudioContext クロックを渡すので、
   * 書き出した映像と音がずれない。
   */
  clock: () => number;
  /** 音声トラック。無ければ無音の動画になる */
  audioTrack?: MediaStreamTrack | null;
}

export function exportVideo(stage: Stage, tl: Timeline, opts: ExportOptions): ExportHandle {
  const { onProgress, clock, audioTrack } = opts;
  const w = tl.width;
  const h = tl.height;

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;

  // 書き出し解像度で描かせる。CSS サイズは触らないので画面の見た目は保たれる
  stage.resize(w, h);

  const stream = out.captureStream(tl.fps);
  if (audioTrack) stream.addTrack(audioTrack);
  const mime = pickMime();
  const recorder = new MediaRecorder(stream, {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: 8_000_000,
    audioBitsPerSecond: 160_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  let cancelled = false;
  let raf = 0;

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime || 'video/webm' }));
  });

  const frame = () => {
    if (cancelled) return;
    const t = clock();

    if (t >= tl.duration) {
      onProgress(1);
      recorder.stop();
      return;
    }

    stage.seek(t);

    const span = tl.spans.find((s) => t < s.end) ?? tl.spans[tl.spans.length - 1];
    drawBackground(ctx, w, h);
    // スライドはカット頭で 0.45 秒かけて入れる（画面側の CSS トランジションに合わせる）
    const fade = Math.min(1, (t - span.start) / 0.45);
    drawSlide(ctx, w, h, span, tl, span.slide ? fade : 0);
    ctx.drawImage(stage.renderer.domElement, 0, 0, w, h);
    drawSubtitle(ctx, w, h, t < span.speechEnd ? span.say : '');

    onProgress(t / tl.duration);
    raf = requestAnimationFrame(frame);
  };

  recorder.start();
  raf = requestAnimationFrame(frame);

  return {
    done,
    cancel() {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (recorder.state !== 'inactive') recorder.stop();
    },
  };
}
