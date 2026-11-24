# クローンからShorts運用を始める

Node.js 22以上とChromeまたはChromiumが必要です。自動実行する場合は、同じ運用フォルダを継続して参照できる端末を用意します。

```bash
git clone https://github.com/yaeok/app-shorts-factory.git
cd app-shorts-factory
npm ci
npm run build
npm test
npx app-shorts doctor
```

## ローカルで翌日の投稿を試す

架空のアプリ「そとノート」を使います。下の日時はシミュレーション用です。

```bash
npx app-shorts interview campaigns/demo \
  --brief examples/field-notes/workspace.json \
  --content examples/field-notes/content.json
npx app-shorts plan campaigns/demo --recipe repeatable-quiz --count 1 --seed 0
npx app-shorts render-batch campaigns/demo
```

`plan` が表示した動画IDを `<plan-id>` に入れます。MP4とQAの画像3枚を見て、内容の正しさ、文字切れ、素材の使用権、CTAを確認してください。QAは実際のMP4を検査します。

```bash
npx app-shorts qa campaigns/demo <plan-id>
npx app-shorts approve campaigns/demo <plan-id> --by operator
npx app-shorts schedule campaigns/demo <plan-id> \
  --at 2026-11-25T19:00:00+09:00 --made-for-kids false --simulate
```

`schedule` が表示した `idempotencyKey` を指定します。

```bash
npx app-shorts publish-approve campaigns/demo <request-id> \
  --channel simulation-channel --by operator --simulate
npx app-shorts tick campaigns/demo --simulate --now 2026-11-24T19:00:00+09:00
npx app-shorts tick campaigns/demo --simulate --now 2026-11-25T19:00:00+09:00
npx app-shorts publish-status campaigns/demo --simulate
```

最初の `tick` では送信件数0、翌日の実行では `processingStatus: succeeded` を確認できます。シミュレーションの投稿・計測・レシピ版は `simulation/` 下へ保存されます。

## 自分のアプリで始める

1. `npx app-shorts interview campaigns/my-app` でストアURL、対象者、提供価値、評価指標を入力します。既に整理した情報は `--brief` で渡せます。
2. アイコンや実画面を `assets/` に置き、`workspace.json` の `creative.logo` や `creative.featureAsset` に相対パスを設定します。後者は `{"path":"demo.mp4","type":"video"}` の形式です。
3. まず `product-introduction` で紹介動画を試します。定期シリーズは `content.json` に `id`、`prompt`、`answer`、任意の `explanation` を持つ素材を並べ、`repeatable-quiz` を選びます。一問一答、計算、数列、使い方の小ネタを同じ入力形式で扱えます。
4. 素材と品質を確認し、`approve` します。現行テンプレートは無音です。

`plan` は同じ設定・素材・レシピ版・シードから同じ企画IDを作ります。企画に素材のコピー、ハッシュ、レンダラーの指紋を残します。別環境でのバイナリ一致にはOS、ブラウザ、フォントなどの環境統一も必要です。独自に作った動画構成には従来の `init`、`validate`、`render` も使えます。

## 本番の翌日投稿

1. チャンネルの管理者がGoogle CloudでYouTube Data API v3を有効にし、デスクトップ用のOAuthクライアントを作ります。[GoogleのデスクトップOAuth手順](https://developers.google.com/identity/protocols/oauth2/native-app)
2. `npx app-shorts youtube connect --client /secure/client.json --out /secure/shorts-youtube.json` を実行し、表示されたURLを同じ端末のブラウザで開いて権限を許可します。
3. 実行環境に `SHORTS_YOUTUBE_CREDENTIALS=/secure/shorts-youtube.json` を設定し、`npx app-shorts youtube status` でチャンネルIDを確認します。運用フォルダの `channels` にそのIDを `accountId` として設定し、`enabled` を `true` にします。認証ファイルはGit管理外に置きます。
4. 上記と同じ `schedule` と `publish-approve` を、実際の日時とチャンネルIDで実行します。初回は既定の `private` を使います。ここで日時、対象チャンネル、公開範囲、タイトル、説明文、子ども向け設定を確認します。
5. 常時起動する端末で15分ごとに `tick` を起動し、翌日 `publish-status` で動画ID、処理状態、公開範囲を確認します。

Linux上のcron設定例です。実際の絶対パスとNode.jsのパスに置き換えます。

```cron
*/15 * * * * cd /srv/app-shorts-factory && SHORTS_YOUTUBE_CREDENTIALS=/secure/shorts-youtube.json /usr/bin/flock -n /srv/shorts-tick.lock /usr/bin/node bin/app-shorts.mjs tick /srv/shorts-data/my-app >> /srv/shorts-tick.log 2>&1
```

予約時刻はアップロードの開始予定です。実際の開始時刻はランナーの実行間隔、表示可否はYouTube上での処理に依存します。承認内容と違う場合は台帳でエラーを確認できます。送信結果が不明な場合は、YouTube Studioに実在する動画を確認し、`reconcile <workspace> <request-id> <video-id>` で照合します。[YouTubeのアップロードと処理仕様](https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol)

## 実測から次の版を作る

```bash
npx app-shorts propose campaigns/my-app --recipe repeatable-quiz \
  --hook '通勤中に解ける1問' --hypothesis '利用場面を冒頭に出すと平均視聴率が上がる'
npx app-shorts plan campaigns/my-app --recipe repeatable-quiz \
  --count 3 --seed 0 --proposal <proposal-id>
```

この例では同じ3題について、冒頭の見出しだけが違う比較用の6本を作ります。比較する動画は近い投稿条件で配信し、公開順をペア間で交互にすると、順番による偏りを抑えられます。計測時点は投稿から24時間、72時間、7日後で、カウンターは各時点から2時間以内の観測を使います。

`tick` がYouTube Data APIから再生・高評価・コメント数を取得し、同じ条件の比較をレビューに保存します。平均視聴率やストアの指標などは、時刻・出典付きの `metric-snapshot` JSONを `metrics-import` で取り込みます。集計しかできないダウンロード数を個別動画の成果として入力しないでください。[YouTubeのカウンターとAnalyticsの違い](https://developers.google.com/youtube/analytics/data_model)

```json
{
  "kind": "metric-snapshot",
  "schemaVersion": 1,
  "publicationId": "<request-id>",
  "checkpoint": "72h",
  "observedAt": "2026-11-28T19:15:00+09:00",
  "environment": "youtube",
  "metrics": {
    "average_view_percentage": {"state": "measured", "value": 66, "source": "studio-export"}
  }
}
```

`workspace.json` の `goals.primaryKpi` を基準にします。比較には同一チャンネル・公開範囲・観測区間・計測元が必要です。異なる題材で3組以上がすべて改善し、相対改善の中央値が10%以上になると採用候補になります。これは運用上の判定基準であり、統計的な因果推定は別途行います。

```bash
npx app-shorts review campaigns/my-app <proposal-id> --checkpoint 72h
npx app-shorts promote campaigns/my-app <learning-id> --by operator --preview <variant-plan-id>
npx app-shorts plan campaigns/my-app --recipe repeatable-quiz --version 2 --seed 3
npx app-shorts replicate campaigns/my-app <learning-id> campaigns/another-app \
  --brief /path/to/another-app-brief.json
```

採用には、比較に使った改善版の目視承認が必要です。旧版は `--version 1` で再利用できます。横展開は別アプリの事実と素材でレシピの下書きを作成します。移植先で改めて内容を検証してください。

### AIに次の実験を提案してもらう

実行環境に `OPENAI_API_KEY` を設定し、利用可能なStructured Outputs対応モデルのIDを指定します。明示した場合だけ、アプリの短い説明とレビュー集計をOpenAI APIへ送ります。リクエスト・モデル・応答をワークスペースに保存し、同じリクエストの結果を再利用します。[OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)

```bash
npx app-shorts propose campaigns/my-app --recipe repeatable-quiz \
  --ai-model <model-id> --review <review-id>
```

`tick --ai-model <model-id>` を使うと、7日レビューで改善が必要と判定した際にフックと検証仮説を出します。人が内容を確認し、採用した提案IDを `plan` に渡します。
