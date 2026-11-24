# App Shorts Factory

アプリの特徴や使い方を伝える縦型ショート動画を、JSONと画像素材から作るCLIです。アプリ名、ブランドカラー、シーンの文章や順番を変えるだけで、同じ構成を別のアプリにも使えます。出力は1080×1920（9:16）、30 fpsのMP4です。

## セットアップ

必要な環境はGit、Node.js 22以上（npm付き）です。動画生成にはChromeまたはChromiumを使います。

```bash
git clone https://github.com/yaeok/app-shorts-factory.git
cd app-shorts-factory
npm run setup
```

依存関係が未導入なら `npm ci` を実行し、サンプルで試すか自分のアプリを設定するかを尋ねます。回答後に、用意する素材と次に実行するコマンドを表示します。

- すぐ試すなら `npm run setup -- --demo`。サンプル素材を使うため、アカウント登録や認証は不要です。
- 自分のアプリで始めるなら `npm run setup -- campaigns/my-app`。アプリ名、対象ユーザー、確認済みの機能、動画を見た人に促したい行動を用意します。ロゴやスクリーンショットは任意です。
- 一問一答シリーズを始めるなら `npm run setup -- campaigns/my-app --series`。`content.json` に出題と回答を用意します。
- 続きから確認するなら `npm run setup -- campaigns/my-app --status`。サンプルの場合は `campaigns/demo` を指定します。

## 動画だけ作る

サンプルの生成に素材の追加やアカウント登録は不要です。

```bash
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

## Shorts運用を始める

[運用ガイド](docs/operations.md)の「ローカルで翌日の投稿を試す」では、架空アプリの初期設定からMP4生成、目視QA、翌日の模擬投稿、台帳確認までを試せます。

| やりたいこと | コマンド |
| --- | --- |
| 環境を確認し、アプリの方向性・評価指標を決める | `npm run setup` |
| アプリ紹介や一問一答のシリーズを作る | `plan`、`render-batch`、`qa` |
| 承認済みの動画を予約し、投稿結果を確認する | `approve`、`schedule`、`publish-approve`、`tick`、`publish-status` |
| 計測結果を比較して、次に試すフックを提案する | `metrics-import`、`review`、`propose` |
| 再現した改善を新しい版として採用し、別アプリで試す | `promote`、`replicate` |

```bash
npm run setup -- campaigns/my-app
npm run cli -- plan campaigns/my-app --recipe product-introduction
npm run cli -- render-batch campaigns/my-app
```

企画にはレシピ版、シード、素材のハッシュを残します。定期実行する `tick` は、承認済みの投稿を処理し、投稿後24時間・72時間・7日の計測と比較を行います。AI提案を利用する場合はOpenAI APIの設定が必要です。

利用者が担当するのは、アプリ情報と素材の準備、動画の目視確認、YouTubeのOAuth認証、投稿ごとの承認、定期実行環境の設定です。模擬投稿フローはローカルで検証済みです。実チャンネルとOpenAI APIでの接続確認は別途必要です。

Codex向けの運用スキルは [.codex/skills](.codex/skills/) にあります。データ構成と開発状況は[アーキテクチャ](docs/architecture.md)と[ロードマップ](docs/roadmap.md)を参照してください。
