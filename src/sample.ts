import type { SceneGraph } from './scenegraph';

/** デモの入力欄に最初から入っている内容。 */
export const SAMPLE_INPUT = {
  outline:
    '社内向けに「生成AIを業務で安全に使うための基本ルール」を説明するショート動画。' +
    '対象は非エンジニアの一般社員。堅くなりすぎず、要点を3つに絞って伝える。',
  material: `# 生成AI利用ガイドライン(抜粋)

## 1. 入力してはいけない情報
- 顧客の個人情報、未公開の財務情報
- ソースコードのうち機密指定のもの

## 2. 出力の扱い
- 事実確認を必ず行う(ハルシネーション対策)
- そのまま社外文書に転用しない

## 3. 利用ログ
- 業務利用は承認済みツールのみ
- ログは90日間保管される`,
  format: '解説・スライド型 / 40秒 / 縦横比 16:9',
};

/** 「AIで生成」の結果として出てくるシーングラフ。 */
export const SAMPLE_SCENEGRAPH: SceneGraph = {
  version: 1,
  meta: { title: '生成AIを業務で安全に使う3つのルール', fps: 30, width: 1280, height: 720 },
  voice: { name: 'ja-JP-Neural2-B', pitch: 2.0, rate: 1.05 },
  slides: [
    {
      id: 'title',
      title: '生成AIを業務で安全に使う\n3つのルール',
      bullets: ['社内向け・非エンジニア編'],
    },
    {
      id: 'rule1',
      title: 'ルール1  入れてはいけない情報',
      bullets: ['顧客の個人情報', '未公開の財務情報', '機密指定のソースコード'],
    },
    {
      id: 'rule2',
      title: 'ルール2  出力はそのまま使わない',
      bullets: ['必ず事実確認する', '社外文書への転用はNG'],
    },
    {
      id: 'rule3',
      title: 'ルール3  承認済みツールだけ',
      bullets: ['利用ログは90日間保管', '未承認ツールの業務利用は禁止'],
    },
    {
      id: 'outro',
      title: '迷ったら情報システム部へ',
      bullets: ['#ai-help でいつでも相談できます'],
    },
  ],
  cuts: [
    {
      id: 'c1',
      say: 'こんにちは！今日は、生成AIを仕事で安全に使うためのルールを、3つだけ紹介します。',
      kana: 'こんにちは。きょうは、せいせいエーアイをしごとであんぜんにつかうためのルールを、みっつだけしょうかいします。',
      slide: 'title',
      camera: 'medium',
      emotion: 'happy',
      gesture: 'idle',
      pauseAfter: 0.45,
    },
    {
      id: 'c2',
      say: '1つめ。入れてはいけない情報です。お客様の個人情報や、まだ公開していない財務データは入力しないでください。',
      kana: 'ひとつめ。いれてはいけないじょうほうです。おきゃくさまのこじんじょうほうや、まだこうかいしていないざいむデータはにゅうりょくしないでください。',
      slide: 'rule1',
      camera: 'slideFocus',
      emotion: 'neutral',
      gesture: 'present',
      pauseAfter: 0.4,
    },
    {
      id: 'c3',
      say: '機密指定のソースコードも同じです。ここは特に事故が多いので気をつけてください。',
      kana: 'きみつしていのソースコードもおなじです。ここはとくにじこがおおいのできをつけてくださいね。',
      slide: 'rule1',
      camera: 'closeup',
      emotion: 'sad',
      gesture: 'nod',
      pauseAfter: 0.5,
    },
    {
      id: 'c4',
      say: '2つめ。AIの出力は、そのまま使わないこと。事実確認をしてから使ってください。',
      kana: 'ふたつめ。エーアイのしゅつりょくは、そのままつかわないこと。じじつかくにんをしてからつかってくださいね。',
      slide: 'rule2',
      camera: 'slideFocus',
      emotion: 'neutral',
      gesture: 'present',
      pauseAfter: 0.4,
    },
    {
      id: 'c5',
      say: '3つめ。使っていいのは、承認済みのツールだけです。利用ログは90日間保管されています。',
      kana: 'みっつめ。つかっていいのは、しょうにんずみのツールだけです。りようログはきゅうじゅうにちかんほかんされています。',
      slide: 'rule3',
      camera: 'slideFocus',
      emotion: 'neutral',
      gesture: 'present',
      pauseAfter: 0.4,
    },
    {
      id: 'c6',
      say: '以上の3つです。迷ったら、情報システム部に聞いてくださいね。それでは、また！',
      kana: 'いじょうのみっつです。まよったら、じょうほうシステムぶにきいてくださいね。それでは、またー！',
      slide: 'outro',
      camera: 'medium',
      emotion: 'happy',
      gesture: 'emphasize',
      pauseAfter: 0.8,
    },
  ],
};

/** 生成中に流すログ。実装が本物の LLM に変わってもこの見た目は保つ。 */
export const GENERATION_LOG: { label: string; ms: number }[] = [
  { label: '資料を解析中 — Markdown 3セクションを検出', ms: 620 },
  { label: '構成を設計中 — 導入 / 本論3点 / まとめ', ms: 780 },
  { label: '台本を執筆中 — 40秒に収まる文字数へ調整', ms: 900 },
  { label: '読みを付与中 — TTS用のかなを生成', ms: 560 },
  { label: 'スライドを生成中 — 5枚', ms: 640 },
  { label: '演出を付与中 — カメラ / 表情 / モーション', ms: 820 },
  { label: 'シーングラフを検証中 — 6カット / 38.4秒', ms: 480 },
];
