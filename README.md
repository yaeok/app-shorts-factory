# App Shorts Factory

任意のアプリ情報、ブランド、動画シーン、画像素材から、1080×1920のショート動画を生成するRemotion CLIです。

## 設計方針

- アプリ固有情報は`project.json`へ分離
- `hook`、`problem`、`feature`、`demo`、`proof`、`cta`を自由に構成
- ロゴ、スクリーンショット、画像は外部の`assets/`から読み込む
- 数学問題など個別ドメインの生成ロジックをコアへ組み込まない
- 企画相談の結果を設定ファイルとして保存し、同じ入力から再現可能にする

## セットアップ

```bash
npm install
npm run build
npm test
```

## 使い方

```bash
npx app-shorts init my-video
cd my-video
npx app-shorts validate project.json --assets assets
npx app-shorts render project.json --assets assets --output output/app-short.mp4
```

サンプルは`examples/basic/project.json`にあります。素材を指定しない構成は、そのままレンダリングできます。

## 現在の範囲

初期版は設定駆動の動画生成基盤です。対話内容から`project.json`を自動提案するプランナー、ナレーション、BGM、画面録画の自動編集、複数テンプレートは次の段階で追加します。
