/**
 * シーングラフ — AI が生成し、人間が編集する中間表現。
 *
 * ここには「絶対時刻」を持たせない。尺は読み（kana）から導出するので、
 * 台詞を書き換えるだけでタイムラインが自動で組み直される。
 * 絶対時刻を持つのは compile() が吐く Timeline のほう。
 */

export type CameraPreset = 'wide' | 'medium' | 'closeup' | 'slideFocus';
export type Emotion = 'neutral' | 'happy' | 'relaxed' | 'surprised' | 'sad';
export type Gesture = 'idle' | 'present' | 'nod' | 'think' | 'emphasize';

export interface Slide {
  id: string;
  title: string;
  bullets: string[];
}

export interface Cut {
  id: string;
  /** 画面字幕にも使う表示用テキスト（漢字かな交じり） */
  say: string;
  /** 読み。TTS とリップシンクはこちらを使う */
  kana: string;
  slide: string | null;
  camera: CameraPreset;
  emotion: Emotion;
  gesture: Gesture;
  /** 発話後の間（秒） */
  pauseAfter: number;
}

export interface SceneGraph {
  version: 1;
  meta: { title: string; fps: number; width: number; height: number };
  /** Google Cloud TTS の声。name は ja-JP-Neural2-B など */
  voice: { name: string; pitch: number; rate: number };
  slides: Slide[];
  cuts: Cut[];
}

/** 合成済みの1カット分の音声。尺と口パクはこの実測値から作る。 */
export interface VoiceTake {
  buffer: AudioBuffer;
  /** buildSsml が挿した mark の実測時刻。セグメント数 + 1 個ある */
  marks: number[];
}

/* ------------------------------------------------------------------ */
/* コンパイル済みタイムライン（絶対時刻つき・描画側が読む）            */
/* ------------------------------------------------------------------ */

export interface Viseme {
  t: number;
  dur: number;
  shape: 'aa' | 'ih' | 'ou' | 'ee' | 'oh' | 'sil';
}

export interface CutSpan extends Cut {
  start: number;
  end: number;
  /** 発話が終わる時刻（end は pauseAfter を含む） */
  speechEnd: number;
}

export interface Timeline {
  fps: number;
  width: number;
  height: number;
  duration: number;
  spans: CutSpan[];
  visemes: Viseme[];
  blinks: number[];
  slides: Slide[];
  title: string;
}

/* ------------------------------------------------------------------ */
/* かな → モーラ分解                                                   */
/* ------------------------------------------------------------------ */

const SMALL_YOUON = new Set(['ゃ', 'ゅ', 'ょ', 'ャ', 'ュ', 'ョ', 'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ']);

/** かな1文字 → 母音。拗音は直前の子音に吸収済みである前提。 */
function vowelOf(kana: string): Viseme['shape'] {
  const c = kana.normalize('NFKC');
  if ('あかさたなはまやらわがざだばぱぁゃァャ'.includes(c)) return 'aa';
  if ('いきしちにひみりぎじぢびぴぃィ'.includes(c)) return 'ih';
  if ('うくすつぬふむゆるぐずづぶぷぅゅゥュ'.includes(c)) return 'ou';
  if ('えけせてねへめれげぜでべぺぇェ'.includes(c)) return 'ee';
  if ('おこそとのほもよろをごぞどぼぽぉょォョ'.includes(c)) return 'oh';
  if ('んン'.includes(c)) return 'sil';
  return 'aa';
}

interface Mora {
  /** 母音（口形） */
  shape: Viseme['shape'];
  /** 相対的な長さの重み。長音や促音で変わる */
  weight: number;
}

/** かな文字列をモーラ列に分解する。ひらがな・カタカナ・長音・促音に対応。 */
export function toMoras(kana: string): Mora[] {
  const chars = [...kana];
  const moras: Mora[] = [];

  for (const ch of chars) {
    // 句読点・空白は間として扱う
    if ('、。，．・ 　\n'.includes(ch)) {
      moras.push({ shape: 'sil', weight: ch === '、' || ch === '，' ? 1.2 : 1.8 });
      continue;
    }
    // 長音符は直前のモーラを伸ばす
    if (ch === 'ー' || ch === '−' || ch === '—') {
      if (moras.length) moras[moras.length - 1].weight += 1;
      continue;
    }
    // 促音は無音の詰まり
    if (ch === 'っ' || ch === 'ッ') {
      moras.push({ shape: 'sil', weight: 0.7 });
      continue;
    }
    // 拗音は直前の子音と合わせて1モーラ。口形だけ上書きする
    if (SMALL_YOUON.has(ch) && moras.length) {
      moras[moras.length - 1].shape = vowelOf(ch);
      continue;
    }
    moras.push({ shape: vowelOf(ch), weight: 1 });
  }
  return moras;
}

/**
 * 1モーラあたりの基準秒数。音声がまだ合成されていないときの暫定値で、
 * 合成が終われば実測に置き換わる。
 */
const SEC_PER_MORA = 0.135;

export function estimateDuration(kana: string, rate: number): number {
  const moras = toMoras(kana);
  const w = moras.reduce((s, m) => s + m.weight, 0);
  return (w * SEC_PER_MORA) / rate;
}

/**
 * 句読点で区切る。区切り文字は前のセグメントに残す。
 * say と kana を同じ規則で割り、セグメント数が一致したときだけ
 * mark のタイムポイントを口パクのアンカーに使う。
 */
export function splitPhrases(text: string): string[] {
  return (text.match(/[^、。！？]*[、。！？]|[^、。！？]+/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* compile: SceneGraph → Timeline                                      */
/* ------------------------------------------------------------------ */

/** 瞬きの間隔。t の関数として決定的に決めたいので固定シーケンスから生成する。 */
function makeBlinks(duration: number): number[] {
  const out: number[] = [];
  const gaps = [2.4, 3.9, 1.7, 4.6, 2.9, 3.3, 5.1, 2.1];
  let t = 1.2;
  let i = 0;
  while (t < duration) {
    out.push(t);
    t += gaps[i % gaps.length];
    i++;
  }
  return out;
}

/** モーラ列を [from, to] に重み比で敷き詰める。 */
function layMoras(moras: Mora[], from: number, to: number, out: Viseme[]): void {
  const total = moras.reduce((s, m) => s + m.weight, 0);
  if (total <= 0) return;
  const scale = (to - from) / total;
  let mt = from;
  for (const m of moras) {
    const dur = m.weight * scale;
    if (m.shape !== 'sil') out.push({ t: mt, dur, shape: m.shape });
    mt += dur;
  }
}

/**
 * SceneGraph をタイムラインに落とす。
 *
 * takes を渡すと、尺は合成済み音声の実測長になり、口パクは mark の
 * タイムポイントを区切りにして敷かれる。渡さなければモーラ数からの推定で組む
 * （音声の合成が終わる前のプレビュー用）。
 */
export function compile(sg: SceneGraph, takes?: Map<string, VoiceTake>): Timeline {
  const spans: CutSpan[] = [];
  const visemes: Viseme[] = [];
  let t = 0;

  for (const cut of sg.cuts) {
    const take = takes?.get(cut.id);
    const kanaSegs = splitPhrases(cut.kana);
    const speechDur = take
      ? take.buffer.duration
      : estimateDuration(cut.kana, sg.voice.rate) || 0.1;

    // mark はセグメント数 + 1 個。数が合わないときは全体に均等に敷く
    if (take && take.marks.length === kanaSegs.length + 1) {
      for (let i = 0; i < kanaSegs.length; i++) {
        layMoras(toMoras(kanaSegs[i]), t + take.marks[i], t + take.marks[i + 1], visemes);
      }
    } else {
      layMoras(toMoras(cut.kana), t, t + speechDur, visemes);
    }

    const speechEnd = t + speechDur;
    const end = speechEnd + cut.pauseAfter;
    spans.push({ ...cut, start: t, speechEnd, end });
    t = end;
  }

  const duration = Math.max(t, 0.1);
  return {
    fps: sg.meta.fps,
    width: sg.meta.width,
    height: sg.meta.height,
    duration,
    spans,
    visemes,
    blinks: makeBlinks(duration),
    slides: sg.slides,
    title: sg.meta.title,
  };
}
