import type { SceneGraph } from './scenegraph';

/**
 * 埋め込みデモのお題。
 *
 * 訪問者が選んだお題でちゃんと中身が変わらないと体験にならないので、
 * お題ごとにシーングラフを持たせてある。本番はここが LLM の出力に置き換わる。
 *
 * 注意: say と kana は句読点（、。！？）の数をそろえること。
 * 数が合っていると TTS のタイムポイントを口パクのアンカーに使える。
 * tools/check-presets.mjs で検査している。
 */

const META = { fps: 30, width: 1280, height: 720 } as const;
const VOICE = { name: 'ja-JP-Neural2-B', pitch: 2.0, rate: 1.05 } as const;

export interface Preset {
  id: string;
  /** チップに出す短いラベル */
  label: string;
  /** 入力欄に流し込む「概要」 */
  outline: string;
  graph: SceneGraph;
}

export const PRESETS: Preset[] = [
  {
    id: 'ai-rules',
    label: '社内の生成AIルール',
    outline: '社内向けに、生成AIを安全に使うための基本ルールを3つ紹介する動画。対象は非エンジニア。',
    graph: {
      version: 1,
      meta: { ...META, title: '生成AIを安全に使う3つのルール' },
      voice: { ...VOICE },
      slides: [
        { id: 'title', title: '生成AIを安全に使う\n3つのルール', bullets: ['社内向け・非エンジニア編'] },
        { id: 'r1', title: 'ルール1  入れない情報', bullets: ['顧客の個人情報', '未公開の財務情報'] },
        { id: 'r2', title: 'ルール2  出力は確認する', bullets: ['必ず事実確認する', '社外文書に転用しない'] },
        { id: 'r3', title: 'ルール3  承認済みツールだけ', bullets: ['利用ログは90日間保管'] },
      ],
      cuts: [
        {
          id: 'c1',
          say: 'こんにちは！生成AIを安全に使うルールを、3つだけ紹介します。',
          kana: 'こんにちは。せいせいエーアイをあんぜんにつかうルールを、みっつだけしょうかいします。',
          slide: 'title', camera: 'medium', emotion: 'happy', gesture: 'idle', pauseAfter: 0.4,
        },
        {
          id: 'c2',
          say: '1つめ。お客様の個人情報や、未公開の財務情報は入力しないでください。',
          kana: 'ひとつめ。おきゃくさまのこじんじょうほうや、みこうかいのざいむじょうほうはにゅうりょくしないでください。',
          slide: 'r1', camera: 'slideFocus', emotion: 'neutral', gesture: 'present', pauseAfter: 0.35,
        },
        {
          id: 'c3',
          say: '2つめ。AIの答えは、そのまま使わずに事実確認をしてください。',
          kana: 'ふたつめ。エーアイのこたえは、そのままつかわずにじじつかくにんをしてください。',
          slide: 'r2', camera: 'slideFocus', emotion: 'neutral', gesture: 'present', pauseAfter: 0.35,
        },
        {
          id: 'c4',
          say: '3つめ。使えるのは承認済みのツールだけです。困ったら情報システム部へどうぞ！',
          kana: 'みっつめ。つかえるのはしょうにんずみのツールだけです。こまったらじょうほうシステムぶへどうぞ。',
          slide: 'r3', camera: 'medium', emotion: 'happy', gesture: 'nod', pauseAfter: 0.8,
        },
      ],
    },
  },

  {
    id: 'onboarding',
    label: '新入社員への会社紹介',
    outline: '新入社員向けのウェルカム動画。会社の事業と大事にしている価値観を短く伝える。',
    graph: {
      version: 1,
      meta: { ...META, title: 'ようこそ、アオゾラ株式会社へ' },
      voice: { ...VOICE },
      slides: [
        { id: 'title', title: 'ようこそ、\nアオゾラ株式会社へ', bullets: ['新入社員のみなさんへ'] },
        { id: 's1', title: 'わたしたちの仕事', bullets: ['中小企業のDXを支援', '全国に12拠点'] },
        { id: 's2', title: '大事にしていること', bullets: ['まず試す', 'そして、すぐ直す'] },
        { id: 's3', title: '困ったときは', bullets: ['メンター制度があります'] },
      ],
      cuts: [
        {
          id: 'c1',
          say: 'ご入社おめでとうございます！アオゾラ株式会社へようこそ。',
          kana: 'ごにゅうしゃおめでとうございます。アオゾラかぶしきがいしゃへようこそ。',
          slide: 'title', camera: 'medium', emotion: 'happy', gesture: 'idle', pauseAfter: 0.4,
        },
        {
          id: 'c2',
          say: 'わたしたちは、中小企業のDXを支援する会社です。全国に12の拠点があります。',
          kana: 'わたしたちは、ちゅうしょうきぎょうのディーエックスをしえんするかいしゃです。ぜんこくにじゅうにのきょてんがあります。',
          slide: 's1', camera: 'slideFocus', emotion: 'neutral', gesture: 'present', pauseAfter: 0.35,
        },
        {
          id: 'c3',
          say: '大事にしているのは、まず試すこと。そして、すぐ直すことです。',
          kana: 'だいじにしているのは、まずためすこと。そして、すぐなおすことです。',
          slide: 's2', camera: 'slideFocus', emotion: 'relaxed', gesture: 'present', pauseAfter: 0.35,
        },
        {
          id: 'c4',
          say: '困ったときは、メンターに聞いてくださいね。一緒にがんばりましょう！',
          kana: 'こまったときは、メンターにきいてくださいね。いっしょにがんばりましょう。',
          slide: 's3', camera: 'medium', emotion: 'happy', gesture: 'nod', pauseAfter: 0.8,
        },
      ],
    },
  },

  {
    id: 'product',
    label: '新商品の紹介',
    outline: '新発売のスマート水筒を紹介するショート動画。特徴を2つに絞り、最後に発売日と価格を出す。',
    graph: {
      version: 1,
      meta: { ...META, title: 'スマート水筒「ホルン」' },
      voice: { ...VOICE },
      slides: [
        { id: 'title', title: 'スマート水筒\n「ホルン」', bullets: ['10月1日 発売'] },
        { id: 'p1', title: '24時間、冷たいまま', bullets: ['真空二重構造'] },
        { id: 'p2', title: '飲んだ量がわかる', bullets: ['アプリに自動で記録'] },
        { id: 'p3', title: '10月1日 発売', bullets: ['税込 4,980円'] },
      ],
      cuts: [
        {
          id: 'c1',
          say: '新商品のスマート水筒、ホルンを紹介します！',
          kana: 'しんしょうひんのスマートすいとう、ホルンをしょうかいします。',
          slide: 'title', camera: 'medium', emotion: 'happy', gesture: 'idle', pauseAfter: 0.4,
        },
        {
          id: 'c2',
          say: 'まず、真空二重構造で24時間冷たいままです。',
          kana: 'まず、しんくうにじゅうこうぞうでにじゅうよじかんつめたいままです。',
          slide: 'p1', camera: 'slideFocus', emotion: 'neutral', gesture: 'present', pauseAfter: 0.35,
        },
        {
          id: 'c3',
          say: 'そして、飲んだ量をアプリが自動で記録します。水分補給を忘れません。',
          kana: 'そして、のんだりょうをアプリがじどうできろくします。すいぶんほきゅうをわすれません。',
          slide: 'p2', camera: 'slideFocus', emotion: 'neutral', gesture: 'present', pauseAfter: 0.35,
        },
        {
          id: 'c4',
          say: '発売は10月1日、税込4,980円です。ぜひチェックしてくださいね！',
          kana: 'はつばいはじゅうがつついたち、ぜいこみよんせんきゅうひゃくはちじゅうえんです。ぜひチェックしてくださいね。',
          slide: 'p3', camera: 'medium', emotion: 'happy', gesture: 'nod', pauseAfter: 0.8,
        },
      ],
    },
  },
];

/** 体験ウィジェットで流す短い生成ログ。スタジオ版より簡潔にしてある。 */
export const EMBED_LOG: { label: string; ms: number }[] = [
  { label: 'お題を読み取っています', ms: 560 },
  { label: '構成と台本を書いています', ms: 900 },
  { label: 'スライドを組んでいます', ms: 640 },
  { label: 'カメラと表情をつけています', ms: 720 },
];
