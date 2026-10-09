/**
 * 音声合成（Google Cloud TTS）とその再生。
 *
 * 合成はサーバー経由。API キーをブラウザに置かないためで、
 * サーバー側で結果をキャッシュしているので2回目以降は即返ってくる。
 *
 * 再生時刻は AudioContext のクロックを正とする。映像側はそれを読んで
 * seek するので、音と口パクがずれない。
 */

import { splitPhrases, type Cut, type SceneGraph, type VoiceTake } from './scenegraph';

export interface VoiceOption {
  id: string;
  label: string;
  pitch: number;
  rate: number;
}

/** kit-chatbot と同じ Neural2 / Wavenet の並び。VTuber 向けにピッチを上げてある。 */
export const VOICES: VoiceOption[] = [
  { id: 'ja-JP-Neural2-B', label: '女性・自然（Neural2-B）', pitch: 2.0, rate: 1.05 },
  { id: 'ja-JP-Wavenet-B', label: '女性・明るい（Wavenet-B）', pitch: 4.0, rate: 1.1 },
  { id: 'ja-JP-Wavenet-A', label: '女性・柔らか（Wavenet-A）', pitch: 1.0, rate: 1.0 },
  { id: 'ja-JP-Neural2-C', label: '男性・落ち着き（Neural2-C）', pitch: 0.0, rate: 1.0 },
  { id: 'ja-JP-Neural2-D', label: '男性・明瞭（Neural2-D）', pitch: 0.0, rate: 1.05 },
];

interface TtsResponse {
  audio: string;
  marks: number[];
}

export class Voice {
  readonly ctx: AudioContext;
  private gain: GainNode;
  /** 書き出し用。ここから MediaStream の音声トラックを取る */
  readonly dest: MediaStreamAudioDestinationNode;

  private takes = new Map<string, VoiceTake>();
  private playing: AudioBufferSourceNode[] = [];
  /** 再生開始時の (タイムライン時刻, AudioContext 時刻) */
  private anchor: { t: number; ctxTime: number } | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.dest = this.ctx.createMediaStreamDestination();
    this.gain.connect(this.ctx.destination);
    this.gain.connect(this.dest);
  }

  get results(): Map<string, VoiceTake> {
    return this.takes;
  }

  setMuted(muted: boolean): void {
    this.gain.gain.value = muted ? 0 : 1;
  }

  /** ブラウザの自動再生制限を外す。ユーザー操作の中から呼ぶこと。 */
  async unlock(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  private async synthesizeCut(cut: Cut, sg: SceneGraph): Promise<VoiceTake> {
    const segments = splitPhrases(cut.say);
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        segments,
        voice: sg.voice.name,
        pitch: sg.voice.pitch,
        rate: sg.voice.rate,
      }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(error);
    }

    const data = (await res.json()) as TtsResponse;
    const bytes = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
    const buffer = await this.ctx.decodeAudioData(bytes.buffer as ArrayBuffer);
    return { buffer, marks: data.marks };
  }

  /**
   * 全カットを合成する。1カットずつ進めるのは、生成中の進捗を
   * 画面に出したいのと、レート制限に当たりにくくするため。
   */
  async synthesizeAll(
    sg: SceneGraph,
    onProgress?: (done: number, total: number, cut: Cut) => void,
  ): Promise<Map<string, VoiceTake>> {
    this.takes = new Map();
    for (const [i, cut] of sg.cuts.entries()) {
      onProgress?.(i, sg.cuts.length, cut);
      this.takes.set(cut.id, await this.synthesizeCut(cut, sg));
    }
    onProgress?.(sg.cuts.length, sg.cuts.length, sg.cuts[sg.cuts.length - 1]);
    return this.takes;
  }

  /** 1カットだけ差し替える（台詞や声を編集したとき用）。 */
  async resynthesizeCut(cut: Cut, sg: SceneGraph): Promise<void> {
    this.takes.set(cut.id, await this.synthesizeCut(cut, sg));
  }

  stop(): void {
    for (const s of this.playing) {
      try {
        s.stop();
      } catch {
        /* 既に止まっている */
      }
    }
    this.playing = [];
    this.anchor = null;
  }

  /** タイムライン時刻 t0 から再生を始める。 */
  start(t0: number, spans: { id: string; start: number }[]): void {
    this.stop();
    const base = this.ctx.currentTime + 0.06;

    for (const span of spans) {
      const take = this.takes.get(span.id);
      if (!take) continue;
      const offset = t0 - span.start;

      let when: number;
      let bufferOffset: number;
      if (offset <= 0) {
        when = base - offset;
        bufferOffset = 0;
      } else if (offset < take.buffer.duration) {
        when = base;
        bufferOffset = offset;
      } else {
        continue; // 再生位置より前に終わっているカット
      }

      const src = this.ctx.createBufferSource();
      src.buffer = take.buffer;
      src.connect(this.gain);
      src.start(when, bufferOffset);
      this.playing.push(src);
    }

    this.anchor = { t: t0, ctxTime: base };
  }

  /** 再生中の現在時刻。開始前の助走中は t0 のまま返す。 */
  clock(): number | null {
    if (!this.anchor) return null;
    return this.anchor.t + Math.max(0, this.ctx.currentTime - this.anchor.ctxTime);
  }
}
