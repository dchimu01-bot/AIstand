import { Stage } from './stage';
import { compile, type Cut, type SceneGraph, type Timeline } from './scenegraph';
import { GENERATION_LOG, SAMPLE_INPUT, SAMPLE_SCENEGRAPH } from './sample';
import { exportVideo, type ExportHandle } from './export';
import { Voice, VOICES } from './voice';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  badge: $('status-badge'),
  projectTitle: $('project-title'),
  outline: $<HTMLTextAreaElement>('in-outline'),
  material: $<HTMLTextAreaElement>('in-material'),
  format: $<HTMLInputElement>('in-format'),
  voice: $<HTMLSelectElement>('in-voice'),
  generate: $<HTMLButtonElement>('btn-generate'),
  genlog: $<HTMLUListElement>('genlog'),

  stage: $('stage'),
  canvas: $<HTMLCanvasElement>('canvas'),
  slideLayer: $('slide-layer'),
  slideTitle: $('slide-title'),
  slideBullets: $<HTMLUListElement>('slide-bullets'),
  subtitle: $('subtitle'),
  loading: $('stage-loading'),
  loadingText: $('stage-loading-text'),
  empty: $('stage-empty'),

  play: $<HTMLButtonElement>('btn-play'),
  time: $('time'),
  track: $('track'),
  trackCuts: $('track-cuts'),
  trackProgress: $('track-progress'),
  trackHead: $('track-head'),
  toggleVoice: $<HTMLInputElement>('toggle-voice'),
  export: $<HTMLButtonElement>('btn-export'),
  cinema: $<HTMLButtonElement>('btn-cinema'),
  saved: $('saved'),
  savedPath: $('saved-path'),
  savedSize: $('saved-size'),
  savedOpen: $<HTMLAnchorElement>('saved-open'),

  cutlist: $<HTMLOListElement>('cutlist'),
  inspector: $('inspector'),
  inspectorTitle: $('inspector-title'),
  inspectorDur: $('inspector-dur'),
  edSay: $<HTMLTextAreaElement>('ed-say'),
  edKana: $<HTMLTextAreaElement>('ed-kana'),
  edCamera: $<HTMLSelectElement>('ed-camera'),
  edSlide: $<HTMLSelectElement>('ed-slide'),
  edEmotion: $<HTMLSelectElement>('ed-emotion'),
  edGesture: $<HTMLSelectElement>('ed-gesture'),
  edNudge: $<HTMLInputElement>('ed-nudge'),
  nudge: $<HTMLButtonElement>('btn-nudge'),
};

/* ------------------------------------------------------------------ 状態 */

const stage = new Stage(el.canvas);
const voice = new Voice();

let graph: SceneGraph | null = null;
let timeline: Timeline | null = null;
let t = 0;
let playing = false;
let selectedId: string | null = null;
let modelReady = false;
let busy = false;
let exportHandle: ExportHandle | null = null;
/** 生成前。アバターだけ待機モーションで動かし、トランスポートは触らない */
let idleMode = false;

/** 直前フレームの表示状態。DOM を触る回数を減らすために持つ */
let shownSlide: string | null | undefined;
let shownSubtitle = '';

/* ------------------------------------------------------------- ユーティリティ */

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function setBadge(text: string, kind: '' | 'busy' | 'ready' = ''): void {
  el.badge.textContent = text;
  el.badge.className = `badge${kind ? ` is-${kind}` : ''}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function logLine(text: string, pending = false): HTMLLIElement {
  const li = document.createElement('li');
  li.textContent = text;
  if (pending) li.className = 'is-pending';
  el.genlog.append(li);
  li.scrollIntoView({ block: 'nearest' });
  return li;
}

/* ----------------------------------------------------------- タイムライン反映 */

function recompile(keepTime = true): void {
  if (!graph) return;
  const prev = t;
  timeline = compile(graph, voice.results);
  stage.setTimeline(timeline);
  t = keepTime ? Math.min(prev, timeline.duration) : 0;
  renderTrack();
  renderCutList();
  shownSlide = undefined;
  shownSubtitle = '';
  if (playing) voice.start(t, timeline.spans);
}

function renderTrack(): void {
  if (!timeline) return;
  el.track.dataset.duration = timeline.duration.toFixed(3);
  el.trackCuts.replaceChildren(
    ...timeline.spans.map((span, i) => {
      const d = document.createElement('div');
      d.className = 'track-cut';
      d.dataset.id = span.id;
      d.style.width = `${((span.end - span.start) / timeline!.duration) * 100}%`;
      d.textContent = String(i + 1);
      return d;
    }),
  );
}

const CAMERA_LABEL: Record<string, string> = {
  wide: 'ワイド',
  medium: 'ミディアム',
  closeup: 'クローズアップ',
  slideFocus: 'スライド寄り',
};
const EMOTION_LABEL: Record<string, string> = {
  neutral: 'ふつう',
  happy: '笑顔',
  relaxed: 'おだやか',
  surprised: 'おどろき',
  sad: '困り顔',
};
const GESTURE_LABEL: Record<string, string> = {
  idle: '待機',
  present: '指し示す',
  nod: 'うなずく',
  think: '考える',
  emphasize: '強調する',
};

function renderCutList(): void {
  if (!timeline) return;
  el.cutlist.replaceChildren(
    ...timeline.spans.map((span, i) => {
      const li = document.createElement('li');
      li.className = 'cutitem';
      li.dataset.id = span.id;
      if (span.id === selectedId) li.classList.add('is-selected');

      const no = document.createElement('span');
      no.className = 'cutitem-no';
      no.textContent = String(i + 1);

      const body = document.createElement('div');
      body.className = 'cutitem-body';
      const say = document.createElement('div');
      say.className = 'cutitem-say';
      say.textContent = span.say;
      const meta = document.createElement('div');
      meta.className = 'cutitem-meta';
      meta.textContent = [
        CAMERA_LABEL[span.camera],
        EMOTION_LABEL[span.emotion],
        GESTURE_LABEL[span.gesture],
      ].join(' · ');
      body.append(say, meta);

      const dur = document.createElement('span');
      dur.className = 'cutitem-dur';
      dur.textContent = `${(span.end - span.start).toFixed(1)}s`;

      li.append(no, body, dur);
      li.addEventListener('click', () => selectCut(span.id, true));
      return li;
    }),
  );
}

/* ------------------------------------------------------------ インスペクタ */

function currentCut(): Cut | undefined {
  return graph?.cuts.find((c) => c.id === selectedId);
}

function selectCut(id: string, seekTo = false): void {
  selectedId = id;
  const cut = currentCut();
  if (!cut || !timeline) return;

  for (const li of el.cutlist.children) {
    li.classList.toggle('is-selected', (li as HTMLElement).dataset.id === id);
  }

  const span = timeline.spans.find((s) => s.id === id);
  if (seekTo && span) seek(span.start + 0.001);

  el.inspector.hidden = false;
  el.inspectorTitle.textContent = `カット ${graph!.cuts.indexOf(cut) + 1}`;
  el.inspectorDur.textContent = span ? `${(span.end - span.start).toFixed(1)} 秒` : '';
  el.edSay.value = cut.say;
  el.edKana.value = cut.kana;
  el.edCamera.value = cut.camera;
  el.edEmotion.value = cut.emotion;
  el.edGesture.value = cut.gesture;

  el.edSlide.replaceChildren(
    new Option('（なし）', ''),
    ...graph!.slides.map((s) => new Option(s.title.replace(/\n/g, ' '), s.id)),
  );
  el.edSlide.value = cut.slide ?? '';
}

/**
 * 台詞を書き換えたら音声を作り直す。打つたびに API を叩かないよう間引き、
 * 待っている間はモーラ数からの推定尺で暫定的に組んでおく。
 */
let resynthTimer = 0;
function scheduleResynth(cut: Cut): void {
  voice.results.delete(cut.id);
  recompile();
  clearTimeout(resynthTimer);
  resynthTimer = window.setTimeout(async () => {
    if (!graph) return;
    setBadge('音声を再合成中', 'busy');
    try {
      await voice.resynthesizeCut(cut, graph);
      recompile();
      selectCut(cut.id);
      setBadge(`${graph.cuts.length}カット / ${timeline!.duration.toFixed(1)}秒`, 'ready');
    } catch (err) {
      setBadge(`音声合成に失敗: ${String(err)}`);
    }
  }, 1100);
}

function bindEditor(): void {
  const onText = () => {
    const cut = currentCut();
    if (!cut) return;
    const sayChanged = cut.say !== el.edSay.value;
    cut.say = el.edSay.value;
    cut.kana = el.edKana.value;
    if (sayChanged) scheduleResynth(cut);
    else recompile();
  };
  el.edSay.addEventListener('input', onText);
  el.edKana.addEventListener('input', onText);

  const onSelect = () => {
    const cut = currentCut();
    if (!cut || !timeline) return;
    cut.camera = el.edCamera.value as Cut['camera'];
    cut.emotion = el.edEmotion.value as Cut['emotion'];
    cut.gesture = el.edGesture.value as Cut['gesture'];
    cut.slide = el.edSlide.value || null;
    recompile();
    selectCut(cut.id, true); // 変更が見えるようにカット頭へ戻す
  };
  for (const s of [el.edCamera, el.edEmotion, el.edGesture, el.edSlide]) {
    s.addEventListener('change', onSelect);
  }

  el.nudge.addEventListener('click', applyNudge);
  el.edNudge.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyNudge();
  });
}

/**
 * 「AIに直してもらう」。デモではキーワードで局所的に書き換える。
 * 本番はこのカットだけを LLM に投げ直して差分を受け取る口になる。
 */
async function applyNudge(): Promise<void> {
  const cut = currentCut();
  const req = el.edNudge.value.trim();
  if (!cut || !req || busy || !graph) return;

  busy = true;
  el.nudge.disabled = true;
  setBadge('カットを再生成中', 'busy');
  await sleep(700);

  if (/カジュアル|くだけ|フランク/.test(req)) {
    cut.say = cut.say.replace(/してください/g, 'してね').replace(/です。/g, 'だよ。');
    cut.kana = cut.kana.replace(/してください/g, 'してね').replace(/です。/g, 'だよ。');
    cut.emotion = 'happy';
  }
  if (/短く|みじかく|縮め/.test(req)) {
    const sentences = cut.say.split('。').filter(Boolean);
    if (sentences.length > 1) {
      cut.say = `${sentences[0]}。`;
      cut.kana = `${cut.kana.split('。').filter(Boolean)[0]}。`;
    }
  }
  if (/寄っ|アップ|クローズ/.test(req)) cut.camera = 'closeup';
  if (/引い|ワイド/.test(req)) cut.camera = 'wide';
  if (/元気|明る|笑顔/.test(req)) cut.emotion = 'happy';
  if (/指|スライド/.test(req)) cut.gesture = 'present';

  try {
    await voice.resynthesizeCut(cut, graph);
  } catch (err) {
    console.error(err);
  }
  recompile();
  selectCut(cut.id, true);
  el.edNudge.value = '';
  el.nudge.disabled = false;
  busy = false;
  setBadge('編集を反映しました', 'ready');
}

/* ---------------------------------------------------------------- 生成 */

async function generate(): Promise<void> {
  if (busy || !modelReady) return;
  busy = true;
  stop();
  await voice.unlock(); // ボタンのクリック内で呼ぶ必要がある
  el.generate.disabled = true;
  el.generate.classList.add('is-busy');
  el.genlog.replaceChildren();
  el.inspector.hidden = true;
  el.empty.hidden = true;
  setBadge('生成中', 'busy');

  for (const step of GENERATION_LOG) {
    const li = logLine(step.label, true);
    await sleep(step.ms);
    li.classList.remove('is-pending');
  }

  // 参照を切ってから渡す（編集がサンプル定数を汚さないように）
  idleMode = false;
  graph = structuredClone(SAMPLE_SCENEGRAPH);
  graph.voice.name = el.voice.value;
  const preset = VOICES.find((v) => v.id === el.voice.value);
  if (preset) {
    graph.voice.pitch = preset.pitch;
    graph.voice.rate = preset.rate;
  }
  el.projectTitle.textContent = graph.meta.title;
  selectedId = graph.cuts[0].id;

  const synthLog = logLine('音声を合成中', true);
  try {
    await voice.synthesizeAll(graph, (done, total) => {
      synthLog.textContent = `音声を合成中 — ${done}/${total} カット`;
    });
    synthLog.classList.remove('is-pending');
    synthLog.textContent = `音声を合成 — ${graph.cuts.length}カット (${preset?.label ?? graph.voice.name})`;
  } catch (err) {
    synthLog.classList.remove('is-pending');
    synthLog.textContent = `音声合成に失敗: ${String(err)} — 推定尺で続行します`;
    setBadge('音声合成に失敗');
  }

  recompile(false);
  selectCut(graph.cuts[0].id);

  el.play.disabled = false;
  el.generate.disabled = false;
  el.generate.classList.remove('is-busy');
  el.export.disabled = false;
  busy = false;
  setBadge(`${graph.cuts.length}カット / ${timeline!.duration.toFixed(1)}秒`, 'ready');
  play();
}

/** 声を変えたら全カット作り直す。 */
async function changeVoice(): Promise<void> {
  if (!graph || busy) return;
  busy = true;
  const wasPlaying = playing;
  stop();
  el.voice.disabled = true;
  setBadge('声を差し替え中', 'busy');

  graph.voice.name = el.voice.value;
  const preset = VOICES.find((v) => v.id === el.voice.value);
  if (preset) {
    graph.voice.pitch = preset.pitch;
    graph.voice.rate = preset.rate;
  }

  try {
    await voice.synthesizeAll(graph, (done, total) => {
      setBadge(`声を差し替え中 ${done}/${total}`, 'busy');
    });
    recompile();
    setBadge(`${preset?.label ?? graph.voice.name}`, 'ready');
  } catch (err) {
    setBadge(`音声合成に失敗: ${String(err)}`);
  }

  el.voice.disabled = false;
  busy = false;
  if (wasPlaying) play();
}

/* -------------------------------------------------------------- 再生制御 */

function play(): void {
  if (!timeline) return;
  if (t >= timeline.duration - 0.05) t = 0;
  playing = true;
  el.play.classList.add('is-playing');
  voice.start(t, timeline.spans);
}

function stop(): void {
  playing = false;
  el.play.classList.remove('is-playing');
  voice.stop();
}

/** 再生位置を動かす。再生中なら音声も追従させる。 */
function seek(to: number): void {
  if (!timeline) return;
  t = Math.min(Math.max(0, to), timeline.duration);
  if (playing) voice.start(t, timeline.spans);
  else voice.stop();
}

/* ------------------------------------------------------------ 画面更新 */

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

  const ratio = t / timeline.duration;
  el.trackProgress.style.width = `${ratio * 100}%`;
  el.trackHead.style.left = `${ratio * 100}%`;
  el.time.textContent = `${fmtTime(t)} / ${fmtTime(timeline.duration)}`;

  for (const d of el.trackCuts.children) {
    d.classList.toggle('is-active', (d as HTMLElement).dataset.id === span.id);
  }
  for (const li of el.cutlist.children) {
    li.classList.toggle('is-playing', (li as HTMLElement).dataset.id === span.id);
  }
}

/* ---------------------------------------------------------------- ループ */

let last = performance.now();

function loop(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (timeline && !exportHandle) {
    if (idleMode) {
      t += dt;
      stage.seek(t);
    } else {
      if (playing) {
        // 音声のクロックを正とする。音が無いときだけ経過時間で進める
        t = voice.clock() ?? t + dt;
        if (t >= timeline.duration) {
          t = timeline.duration;
          stop();
        }
      }
      stage.seek(t);
      updateOverlay();
    }
  }

  requestAnimationFrame(loop);
}

/* ------------------------------------------------------------- 書き出し */

async function runExport(): Promise<void> {
  if (!timeline || busy) return;
  busy = true;
  stop();
  t = 0;
  el.export.disabled = true;
  el.generate.disabled = true;
  el.voice.disabled = true;
  el.saved.hidden = true;

  // 音声を先に走らせ、そのクロックに映像を合わせる
  voice.start(0, timeline.spans);

  exportHandle = exportVideo(stage, timeline, {
    audioTrack: voice.dest.stream.getAudioTracks()[0] ?? null,
    clock: () => voice.clock() ?? 0,
    onProgress: (r) => {
      setBadge(`書き出し中 ${Math.round(r * 100)}%`, 'busy');
      t = r * timeline!.duration;
      updateOverlay();
    },
  });

  const blob = await exportHandle.done;
  exportHandle = null;
  voice.stop();
  fitStage();

  // 録画した WebM をサーバーへ渡し、out/ に MP4 で保存してもらう
  setBadge('MP4に変換中', 'busy');
  try {
    const res = await fetch(`/api/save?name=${encodeURIComponent(timeline.title)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: blob,
    });
    const saved = (await res.json()) as { file?: string; size?: number; mp4?: boolean; error?: string };
    if (!res.ok || saved.error) throw new Error(saved.error ?? res.statusText);

    showSaved(saved.file!, saved.size ?? 0, saved.mp4 !== false);
    setBadge('保存しました', 'ready');
  } catch (err) {
    // サーバーに保存できなくても手元には残るようにする
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${timeline.title}.webm`;
    a.click();
    URL.revokeObjectURL(url);
    setBadge(`保存に失敗: ${String(err)} — WebMをダウンロードしました`);
  }

  el.export.disabled = false;
  el.generate.disabled = false;
  el.voice.disabled = false;
  busy = false;
}

function showSaved(file: string, size: number, isMp4: boolean): void {
  el.saved.hidden = false;
  el.savedPath.textContent = `out/${file}`;
  el.savedSize.textContent = `${(size / 1e6).toFixed(1)} MB${isMp4 ? '' : '（MP4変換に失敗・WebMのまま）'}`;
  el.savedOpen.href = `/out/${encodeURIComponent(file)}`;
  el.savedOpen.download = file;
}

/* --------------------------------------------------------------- 初期化 */

function fitStage(): void {
  const r = el.stage.getBoundingClientRect();
  if (r.width > 0) stage.resize(Math.round(r.width), Math.round(r.height));
}

function bindTransport(): void {
  el.play.addEventListener('click', () => (playing ? stop() : play()));

  const scrub = (e: PointerEvent) => {
    if (!timeline) return;
    const r = el.track.getBoundingClientRect();
    seek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * timeline.duration);
  };
  el.track.addEventListener('pointerdown', (e) => {
    // 合成イベント（自動テスト）だと capture できないことがある
    try {
      el.track.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    scrub(e);
  });
  el.track.addEventListener('pointermove', (e) => {
    if (el.track.hasPointerCapture(e.pointerId)) scrub(e);
  });

  el.toggleVoice.addEventListener('change', () => voice.setMuted(!el.toggleVoice.checked));
  el.export.addEventListener('click', runExport);
  el.cinema.addEventListener('click', toggleCinema);
  el.voice.addEventListener('change', changeVoice);

  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName);
    if (typing) return;
    if (e.code === 'Space') {
      e.preventDefault();
      playing ? stop() : play();
    }
    if (e.key === 'f' || e.key === 'F') toggleCinema();
  });
}

function toggleCinema(): void {
  document.body.classList.toggle('cinema');
  requestAnimationFrame(fitStage);
}

async function main(): Promise<void> {
  el.outline.value = SAMPLE_INPUT.outline;
  el.material.value = SAMPLE_INPUT.material;
  el.format.value = SAMPLE_INPUT.format;
  el.voice.replaceChildren(...VOICES.map((v) => new Option(v.label, v.id)));
  el.voice.value = SAMPLE_SCENEGRAPH.voice.name;
  el.export.disabled = true;
  el.generate.disabled = true;
  el.play.disabled = true;
  voice.setMuted(!el.toggleVoice.checked);

  bindTransport();
  bindEditor();
  el.generate.addEventListener('click', generate);

  new ResizeObserver(fitStage).observe(el.stage);
  fitStage();
  requestAnimationFrame(loop);

  setBadge('モデル読み込み中', 'busy');
  try {
    await stage.load('./models/avatar.vrm', (r) => {
      el.loadingText.textContent = `VRMモデルを読み込み中 ${Math.round(r * 100)}%`;
    });
  } catch (err) {
    el.loadingText.textContent = `VRMの読み込みに失敗しました: ${String(err)}`;
    setBadge('読み込み失敗');
    return;
  }

  modelReady = true;
  el.loading.hidden = true;
  el.generate.disabled = false;
  setBadge('準備完了', 'ready');

  // アバターだけは待機状態で動かしておく。空のステージでも生きて見えるように
  timeline = compile({
    ...SAMPLE_SCENEGRAPH,
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
  stage.setTimeline(timeline);
  idleMode = true;
  t = 0;
}

void main();

/** 自動確認用のフック。UI からは使わない。 */
(window as unknown as Record<string, unknown>).__studio = {
  /** 再生を止めてその時刻の1フレームを描く */
  probe(to: number) {
    stop();
    t = to;
    stage.seek(t);
    updateOverlay();
    return stage.expressionValues();
  },
  get timeline() {
    return timeline;
  },
};
