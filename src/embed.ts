/**
 * 埋め込み用のデモ体験ウィジェット。
 *
 * スタジオ画面（app.ts）から、訪問者が触る部分だけを抜いたもの。
 * 入力はお題の選択だけ。シーングラフの編集も書き出しも持たない。
 * ステージ・音声・シーングラフのコンパイルはスタジオ版と同じコードを使う。
 */

import { Stage } from './stage';
import { compile, type SceneGraph, type Timeline } from './scenegraph';
import { EMBED_LOG, PRESETS, type Preset } from './presets';
import { Voice } from './voice';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  stage: $('stage'),
  canvas: $<HTMLCanvasElement>('canvas'),
  slideLayer: $('slide-layer'),
  slideTitle: $('slide-title'),
  slideBullets: $<HTMLUListElement>('slide-bullets'),
  subtitle: $('subtitle'),

  bar: $('bar'),
  play: $<HTMLButtonElement>('btn-play'),
  track: $('track'),
  fill: $('bar-fill'),
  time: $('time'),
  mute: $<HTMLButtonElement>('btn-mute'),

  panelStart: $('panel-start'),
  chips: $('chips'),
  outline: $('outline'),
  start: $<HTMLButtonElement>('btn-start'),
  note: $('note'),

  panelGen: $('panel-gen'),
  genlog: $<HTMLUListElement>('genlog'),

  panelEnd: $('panel-end'),
  endNote: $('end-note'),
  replay: $<HTMLButtonElement>('btn-replay'),
  again: $<HTMLButtonElement>('btn-again'),
};

const stage = new Stage(el.canvas);
const voice = new Voice();

type Phase = 'loading' | 'choose' | 'generating' | 'playing' | 'done';

let phase: Phase = 'loading';
let selected: Preset = PRESETS[0];
let timeline: Timeline | null = null;
let t = 0;
let playing = false;
/** 生成前後にアバターを立たせておくための待機タイムライン */
let idleTimeline: Timeline | null = null;

let shownSlide: string | null | undefined;
let shownSubtitle = '';

/* ------------------------------------------------------------ 表示制御 */

function setPhase(next: Phase): void {
  phase = next;
  el.panelStart.hidden = next !== 'loading' && next !== 'choose';
  el.panelGen.hidden = next !== 'generating';
  el.panelEnd.hidden = next !== 'done';
  el.bar.hidden = next !== 'playing' && next !== 'done';
}

const fmt = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------- お題 */

function renderChips(): void {
  el.chips.replaceChildren(
    ...PRESETS.map((p) => {
      const b = document.createElement('button');
      b.className = `chip${p.id === selected.id ? ' is-on' : ''}`;
      b.textContent = p.label;
      b.addEventListener('click', () => {
        selected = p;
        renderChips();
        el.outline.textContent = p.outline;
      });
      return b;
    }),
  );
}

/* ------------------------------------------------------------ 生成 */

async function generate(): Promise<void> {
  if (phase === 'generating') return;
  setPhase('generating');
  el.genlog.replaceChildren();
  await voice.unlock(); // 自動再生制限を外す。ボタンのクリック内で呼ぶ必要がある

  const graph: SceneGraph = structuredClone(selected.graph);

  // 音声合成と見せかけのログを同時に走らせ、どちらも終わってから再生する
  const synth = voice.synthesizeAll(graph).catch((err) => {
    console.error('音声合成に失敗:', err);
    return null;
  });

  for (const step of EMBED_LOG) {
    const li = document.createElement('li');
    li.className = 'is-pending';
    li.textContent = step.label;
    el.genlog.append(li);
    await sleep(step.ms);
    li.classList.remove('is-pending');
  }

  const li = document.createElement('li');
  li.className = 'is-pending';
  li.textContent = '声を合成しています';
  el.genlog.append(li);
  await synth;
  li.classList.remove('is-pending');
  await sleep(320);

  timeline = compile(graph, voice.results);
  stage.setTimeline(timeline);
  shownSlide = undefined;
  shownSubtitle = '';
  t = 0;

  el.endNote.textContent =
    `「${selected.label}」から ${timeline.spans.length}カット・` +
    `${timeline.duration.toFixed(0)}秒の動画を作りました。`;

  setPhase('playing');
  play();
}

/* -------------------------------------------------------------- 再生 */

function play(): void {
  if (!timeline) return;
  if (t >= timeline.duration - 0.05) t = 0;
  playing = true;
  el.play.classList.add('is-playing');
  voice.start(t, timeline.spans);
  if (phase === 'done') setPhase('playing');
}

function pause(): void {
  playing = false;
  el.play.classList.remove('is-playing');
  voice.stop();
}

function seek(to: number): void {
  if (!timeline) return;
  t = Math.min(Math.max(0, to), timeline.duration);
  if (playing) voice.start(t, timeline.spans);
  else voice.stop();
}

/* ---------------------------------------------------------- 画面更新 */

/** スライドと字幕を引っ込める。次に表示されるとき再構築されるよう印も消す。 */
function clearOverlay(): void {
  el.slideLayer.classList.add('is-hidden');
  el.subtitle.classList.remove('is-on');
  shownSlide = undefined;
  shownSubtitle = '';
}

function updateOverlay(): void {
  if (!timeline) return;
  const span = timeline.spans.find((s) => t < s.end) ?? timeline.spans[timeline.spans.length - 1];

  if (span.slide !== shownSlide) {
    shownSlide = span.slide;
    const slide = timeline.slides.find((s) => s.id === span.slide);
    if (slide) {
      el.slideLayer.classList.remove('is-hidden');
      el.slideTitle.textContent = slide.title;
      el.slideBullets.replaceChildren(
        ...slide.bullets.map((b, i) => {
          const li = document.createElement('li');
          li.textContent = b;
          li.style.animationDelay = `${0.18 + i * 0.12}s`;
          return li;
        }),
      );
    } else {
      el.slideLayer.classList.add('is-hidden');
    }
  }

  const sub = t < span.speechEnd ? span.say : '';
  if (sub !== shownSubtitle) {
    shownSubtitle = sub;
    el.subtitle.textContent = sub;
    el.subtitle.classList.toggle('is-on', Boolean(sub));
  }

  el.fill.style.width = `${(t / timeline.duration) * 100}%`;
  el.time.textContent = `${fmt(t)} / ${fmt(timeline.duration)}`;
}

/* -------------------------------------------------------------- ループ */

let last = performance.now();

function loop(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (phase === 'playing' || phase === 'done') {
    if (timeline) {
      if (playing) {
        t = voice.clock() ?? t + dt;
        if (t >= timeline.duration) {
          t = timeline.duration;
          pause();
          clearOverlay();
          setPhase('done');
        }
      }
      stage.seek(t);
      // done に入ったあとは clearOverlay の結果を上書きしない
      if (phase === 'playing') updateOverlay();
    }
  } else if (idleTimeline) {
    // 選択中・生成中もアバターは動かしておく
    t += dt;
    stage.seek(t);
  }

  requestAnimationFrame(loop);
}

/* -------------------------------------------------------------- 初期化 */

function fitStage(): void {
  const r = el.stage.getBoundingClientRect();
  if (r.width > 0) stage.resize(Math.round(r.width), Math.round(r.height));
}

function bind(): void {
  el.start.addEventListener('click', generate);
  el.play.addEventListener('click', () => (playing ? pause() : play()));
  el.replay.addEventListener('click', () => {
    if (!timeline) return;
    stage.setTimeline(timeline);
    t = 0;
    clearOverlay();
    setPhase('playing');
    play();
  });
  el.again.addEventListener('click', () => {
    pause();
    t = 0;
    clearOverlay();
    if (idleTimeline) stage.setTimeline(idleTimeline);
    setPhase('choose');
  });

  el.mute.addEventListener('click', () => {
    const on = el.mute.classList.toggle('is-on');
    voice.setMuted(!on);
  });

  const scrub = (e: PointerEvent) => {
    if (!timeline) return;
    const r = el.track.getBoundingClientRect();
    seek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * timeline.duration);
  };
  el.track.addEventListener('pointerdown', (e) => {
    try {
      el.track.setPointerCapture(e.pointerId);
    } catch {
      /* 合成イベントでは capture できないことがある */
    }
    scrub(e);
  });
  el.track.addEventListener('pointermove', (e) => {
    if (el.track.hasPointerCapture(e.pointerId)) scrub(e);
  });

  // 一時停止中はバーを出しっぱなしにする
  const syncBar = () => el.bar.classList.toggle('is-shown', !playing);
  el.play.addEventListener('click', syncBar);
  el.track.addEventListener('pointerup', syncBar);
}

async function main(): Promise<void> {
  renderChips();
  el.outline.textContent = selected.outline;
  bind();
  setPhase('loading');

  new ResizeObserver(fitStage).observe(el.stage);
  fitStage();
  requestAnimationFrame(loop);

  try {
    await stage.load('./models/avatar.vrm', (r) => {
      el.note.textContent = `VRMモデルを読み込んでいます… ${Math.round(r * 100)}%`;
    });
  } catch (err) {
    el.note.textContent = `モデルを読み込めませんでした: ${String(err)}`;
    return;
  }

  idleTimeline = compile({
    ...selected.graph,
    slides: [],
    cuts: [
      {
        id: 'idle',
        say: '',
        kana: '',
        slide: null,
        camera: 'medium',
        emotion: 'relaxed',
        gesture: 'idle',
        pauseAfter: 3600,
      },
    ],
  });
  stage.setTimeline(idleTimeline);
  t = 0;

  el.start.disabled = false;
  el.note.textContent = 'デモ用に3つのお題を用意しています。所要 約10秒。';
  setPhase('choose');
}

void main();
