/**
 * three-vrm ステージ。
 *
 * 唯一の外部 API は seek(t)。描画結果は t だけで決まる純関数にしてある。
 * プレビューのスクラブも、将来のヘッドレス書き出しも、同じコードを通す。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import type { CameraPreset, CutSpan, Emotion, Gesture, Timeline } from './scenegraph';

interface CameraShot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

/** カメラプリセット。アバターは原点に立ち、+Z を向いている前提。 */
const SHOTS: Record<CameraPreset, CameraShot> = {
  wide: { pos: new THREE.Vector3(0.25, 1.15, 2.75), look: new THREE.Vector3(-0.62, 0.95, 0), fov: 32 },
  medium: { pos: new THREE.Vector3(0.18, 1.32, 1.85), look: new THREE.Vector3(-0.34, 1.2, 0), fov: 30 },
  closeup: { pos: new THREE.Vector3(0.1, 1.42, 1.0), look: new THREE.Vector3(-0.1, 1.38, 0), fov: 28 },
  slideFocus: { pos: new THREE.Vector3(0.35, 1.25, 2.35), look: new THREE.Vector3(-0.92, 1.05, 0), fov: 34 },
};

/** カメラを切り替えるときのイージング時間（秒） */
const CAM_BLEND = 0.75;

const EMOTION_EXPRESSION: Record<Emotion, string | null> = {
  neutral: null,
  happy: 'happy',
  relaxed: 'relaxed',
  surprised: 'surprised',
  sad: 'sad',
};

function smoothstep(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/**
 * VRM の上半身に手続きアニメーションを乗せる。すべて t の純関数。
 *
 * 座標系の前提: アバターは +Z（カメラ側）を向いている。こちらを向いているので
 * 左右は鏡像になり、キャラの左手が世界 +X = 画面右、右手が -X = 画面左。
 * スライドは画面左に置くので、指し示すのは「右腕」。
 */
interface Pose {
  /** T ポーズから腕を下ろす角度。左右独立 */
  armDownL: number;
  armDownR: number;
  /** 肘の曲げ。正で前方（+Z）に曲がる */
  elbowL: number;
  elbowR: number;
  /** 上腕を前に出す量 */
  armForwardL: number;
  armForwardR: number;
  headPitch: number;
  headYaw: number;
  spineTwist: number;
}

/** 腕を下ろしきった自然位置 */
const ARM_REST = 1.3;

function basePose(t: number): Pose {
  // 待機中の微妙な揺れ。完全静止だと人形に見えるので常時入れておく
  const sway = Math.sin(t * 0.9) * 0.025 + Math.sin(t * 1.7 + 1.2) * 0.012;
  const breath = Math.sin(t * 1.15) * 0.02;
  return {
    armDownL: ARM_REST + breath * 0.5,
    armDownR: ARM_REST + breath * 0.5,
    elbowL: 0.24 + sway * 0.4,
    elbowR: 0.24 - sway * 0.4,
    armForwardL: 0.1,
    armForwardR: 0.1,
    headPitch: breath * 0.4,
    headYaw: sway,
    spineTwist: sway * 0.5,
  };
}

/** ジェスチャを基本ポーズに重ねる。u はカット開始からの経過秒。 */
function applyGesture(pose: Pose, gesture: Gesture, u: number): Pose {
  switch (gesture) {
    case 'present': {
      // 画面左のスライドへ右手を向ける。出したまま維持し、最後に少し下ろす
      const in_ = smoothstep(u / 0.6);
      const out = 1 - smoothstep((u - 3.4) / 0.9) * 0.55;
      const k = in_ * out;
      pose.armDownR -= 0.95 * k;
      pose.armForwardR += 0.3 * k;
      pose.elbowR += 0.35 * k;
      pose.headYaw -= 0.17 * k;
      pose.spineTwist -= 0.12 * k;
      break;
    }
    case 'nod': {
      const env = Math.exp(-u * 1.1);
      pose.headPitch += Math.sin(u * 7.2) * 0.16 * env;
      break;
    }
    case 'think': {
      // あごに手を添える。スライドに被らないよう画面右側＝キャラの左腕を使う
      const k = smoothstep(u / 0.7) * (1 - smoothstep((u - 2.6) / 0.9) * 0.6);
      pose.armDownL -= 0.18 * k;
      pose.elbowL += 1.85 * k;
      pose.armForwardL += 0.62 * k;
      pose.headPitch += 0.12 * k;
      pose.headYaw += 0.1 * k;
      break;
    }
    case 'emphasize': {
      const beat = Math.sin(u * 3.4) * Math.exp(-u * 0.35);
      pose.armDownL -= 0.32 + beat * 0.14;
      pose.armDownR -= 0.32 - beat * 0.14;
      pose.elbowL += 0.62 + beat * 0.2;
      pose.elbowR += 0.62 - beat * 0.2;
      pose.armForwardL += 0.3;
      pose.armForwardR += 0.3;
      pose.headPitch += beat * 0.05;
      break;
    }
    case 'idle':
    default:
      break;
  }
  return pose;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 40);
  private vrm: VRM | null = null;
  private timeline: Timeline | null = null;
  private lastTime = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      // オフライン書き出しでスクリーンショットを撮るために必要
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(1.4, 2.2, 2.4);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x8fb6ff, 1.5);
    rim.position.set(-2.0, 1.6, -1.8);
    this.scene.add(rim);

    const fill = new THREE.DirectionalLight(0xffd9c2, 0.55);
    fill.position.set(-1.6, 0.6, 1.8);
    this.scene.add(fill);

    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2a3350, 1.15));
  }

  async load(url: string, onProgress?: (ratio: number) => void): Promise<void> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const gltf = await loader.loadAsync(url, (e) => {
      if (e.total) onProgress?.(e.loaded / e.total);
    });

    const vrm = gltf.userData.vrm as VRM;
    // VRM 0.x は -Z 向きなので +Z 向きに揃える。1.0 なら何もしない
    VRMUtils.rotateVRM0(vrm);
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);

    // 描画順が毎フレームぶれると書き出し時にちらつくので固定する
    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });

    this.scene.add(vrm.scene);
    this.vrm = vrm;
  }

  setTimeline(tl: Timeline): void {
    this.timeline = tl;
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** 時刻 t のカットを返す。spans は連続しているので線形探索で足りる。 */
  private spanAt(t: number): { span: CutSpan; index: number } | null {
    const tl = this.timeline;
    if (!tl || !tl.spans.length) return null;
    for (let i = 0; i < tl.spans.length; i++) {
      if (t < tl.spans[i].end) return { span: tl.spans[i], index: i };
    }
    const last = tl.spans.length - 1;
    return { span: tl.spans[last], index: last };
  }

  private applyCamera(t: number, index: number, span: CutSpan): void {
    const tl = this.timeline!;
    const cur = SHOTS[span.camera] ?? SHOTS.medium;
    const prev = index > 0 ? (SHOTS[tl.spans[index - 1].camera] ?? SHOTS.medium) : cur;
    const k = smoothstep((t - span.start) / CAM_BLEND);

    this.camera.position.lerpVectors(prev.pos, cur.pos, k);
    const look = new THREE.Vector3().lerpVectors(prev.look, cur.look, k);
    this.camera.lookAt(look);

    const fov = prev.fov + (cur.fov - prev.fov) * k;
    if (Math.abs(this.camera.fov - fov) > 1e-4) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private applyMouth(t: number): void {
    const tl = this.timeline!;
    const em = this.vrm!.expressionManager;
    if (!em) return;

    for (const shape of ['aa', 'ih', 'ou', 'ee', 'oh'] as const) em.setValue(shape, 0);

    // 発話中のみ。二分探索するほどの量ではないので素直に走査する
    for (const v of tl.visemes) {
      if (t < v.t) break;
      if (t >= v.t + v.dur) continue;
      const u = (t - v.t) / v.dur;
      // 開いて閉じる山。頭と尻を潰して隣のモーラと繋がるようにする
      const open = Math.sin(Math.PI * u) ** 0.65;
      em.setValue(v.shape, Math.min(1, open * 0.85));
      return;
    }
  }

  private applyBlink(t: number): void {
    const em = this.vrm!.expressionManager;
    if (!em) return;
    const DUR = 0.14;
    let v = 0;
    for (const b of this.timeline!.blinks) {
      if (t < b) break;
      if (t < b + DUR) {
        v = Math.sin(Math.PI * ((t - b) / DUR));
        break;
      }
    }
    em.setValue('blink', v);
  }

  private applyEmotion(span: CutSpan, t: number): void {
    const em = this.vrm!.expressionManager;
    if (!em) return;
    for (const name of ['happy', 'relaxed', 'surprised', 'sad', 'angry'] as const) em.setValue(name, 0);
    const expr = EMOTION_EXPRESSION[span.emotion];
    if (expr) em.setValue(expr, 0.75 * smoothstep((t - span.start) / 0.5));
  }

  private applyPose(span: CutSpan, t: number): void {
    const h = this.vrm!.humanoid;
    if (!h) return;

    const pose = applyGesture(basePose(t), span.gesture, t - span.start);
    const set = (name: Parameters<typeof h.getNormalizedBoneNode>[0], x: number, y: number, z: number) => {
      const node = h.getNormalizedBoneNode(name);
      if (node) node.rotation.set(x, y, z);
    };

    // T ポーズから腕を下ろす。左腕（画面左）は -Z 回り、右腕はその逆符号
    set('leftUpperArm', -pose.armForwardL, 0, -pose.armDownL);
    set('rightUpperArm', -pose.armForwardR, 0, pose.armDownR);
    // 肘は Y 軸まわり。左腕は -Y、右腕は +Y で前方（+Z）に曲がる
    set('leftLowerArm', 0, -pose.elbowL, 0);
    set('rightLowerArm', 0, pose.elbowR, 0);
    set('spine', pose.headPitch * 0.3, pose.spineTwist * 0.5, 0);
    set('neck', pose.headPitch * 0.6, pose.headYaw * 0.4, 0);
    set('head', pose.headPitch, pose.headYaw, 0);
  }

  /** 現在の口形と瞬きの値。自動確認用。 */
  expressionValues(): Record<string, number> {
    const em = this.vrm?.expressionManager;
    if (!em) return {};
    const out: Record<string, number> = {};
    for (const name of ['aa', 'ih', 'ou', 'ee', 'oh', 'blink', 'happy', 'sad'] as const) {
      out[name] = em.getValue(name) ?? 0;
    }
    return out;
  }

  /** 時刻 t の状態を描画する。呼び出し順に依存しない。 */
  seek(t: number): void {
    if (!this.vrm || !this.timeline) return;
    const hit = this.spanAt(t);
    if (!hit) return;

    this.applyCamera(t, hit.index, hit.span);
    this.applyPose(hit.span, t);
    this.applyEmotion(hit.span, t);
    this.applyMouth(t);
    this.applyBlink(t);

    // 揺れ物は差分時間を要求するので、巻き戻し時は 0 を渡して暴れないようにする
    const dt = t > this.lastTime && t - this.lastTime < 0.5 ? t - this.lastTime : 0;
    this.lastTime = t;
    this.vrm.update(dt);

    this.renderer.render(this.scene, this.camera);
  }
}
