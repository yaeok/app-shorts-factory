# App Shorts Factory

アプリの特徴や使い方を伝える縦型ショート動画を、JSONと画像素材から作るCLIです。アプリ名、ブランドカラー、シーンの文章や順番を変えるだけで、同じ構成を別のアプリにも使えます。出力は1080×1920（9:16）、30 fpsのMP4です。

## まずサンプルを作る

必要な環境はGit、Node.js 22以上（npm付き）、ChromeまたはChromiumです。サンプルの生成に素材の追加やアカウント登録は不要です。

```bash
git clone https://github.com/yaeok/app-shorts-factory.git
cd app-shorts-factory
npm ci
npm run build
npm test

npm run cli -- validate examples/basic/project.json --assets examples/basic
npm run cli -- render examples/basic/project.json --assets examples/basic --output output/sample.mp4
```

生成した動画は `output/sample.mp4` に保存されます。ブラウザの実行ファイルを指定する場合は、環境変数 `REMOTION_BROWSER_EXECUTABLE` にその絶対パスを設定します。

## 自分のアプリで作る

リポジトリのルートから実行します。

```bash
npm run cli -- init my-video
```

1. `my-video/project.json` の `app` にアプリ名・対象ユーザー・提供価値、`brand` に色とフォント、`video.scenes` にシーンごとの見出しと尺を設定します。
2. ロゴやスクリーンショットを `my-video/assets/` に置き、`app.logo` やシーンの `asset` に `assets/` からの相対パスを記入します。
3. 設定と素材を検証し、MP4を生成します。

```bash
npm run cli -- validate my-video/project.json --assets my-video/assets
npm run cli -- render my-video/project.json --assets my-video/assets --output output/my-app-short.mp4
```

紹介動画の構成例は、`hook`（冒頭）→ `problem`（悩み）→ `feature` / `demo`（機能や使い方）→ `proof`（根拠）→ `cta`（次の行動）です。初回の設定は[サンプルJSON](examples/basic/project.json)を参考にできます。

## 公開版でできること

現在の `main` で使えるのは、動画プロジェクトの初期化、設定・素材の検証、ローカルMP4生成です。今後はヒアリングと繰り返し動画の企画生成、YouTube Shortsの予約投稿・計測、測定結果に基づくレシピ改善と別アプリへの横展開までを、同じ手順で使えるようにします。
