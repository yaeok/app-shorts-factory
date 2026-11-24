import {constants} from 'node:fs';
import {access, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WorkspaceSchema, type Workspace} from '../workflow-schema';
import {approvedHash, mediaPath, QASchema} from './media';
import {ContentSchema, defaultBrand, getRecipe, plans, setup} from './planning';
import {publicationRecords, publicationRequests} from './publishing';
import {digest, doc, fileHash, optional, readDoc, readJson, workspace} from './store';

type Ask = (prompt: string, fallback?: string) => Promise<string>;
type Options = {demo?: boolean; brief?: string; content?: string; series?: boolean; status?: boolean};
const demoRoot = 'campaigns/demo';
const example = (file: string) => fileURLToPath(new URL('../../examples/field-notes/' + file, import.meta.url));
const shell = (value: string) => /^[\w.\-/]+$/.test(value) ? value
  : process.platform === 'win32' ? "'" + value.replaceAll("'", "''") + "'" : "'" + value.replaceAll("'", "'\\''") + "'";

async function browserMessage() {
  const configured = process.env.REMOTION_BROWSER_EXECUTABLE;
  if (configured) {
    try {
      if (!(await stat(configured)).isFile()) throw new Error();
      await access(configured, constants.X_OK);
      return '指定済み（REMOTION_BROWSER_EXECUTABLE）';
    } catch {
      return '要設定。REMOTION_BROWSER_EXECUTABLE を実行可能なChrome / Chromiumのファイルに変更してください。';
    }
  }
  if (process.platform === 'darwin' && await optional(() =>
    stat('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'))) return 'システムのGoogle Chrome';
  return 'Remotionの既定ブラウザ。初回の動画生成時にダウンロードが必要になることがあります。';
}

export async function onboard(root: string | undefined, options: Options, print: (message: string) => void, ask?: Ask) {
  if (options.demo && (options.brief || options.content)) throw new Error('--demo と --brief / --content は同時に指定できません。');
  if (options.status && (options.brief || options.content)) throw new Error('--status は既存の状態だけを確認します。');
  let demo = options.demo;
  print('App Shorts Factory セットアップ');
  print('Node.js ' + process.version);
  print('ブラウザ  ' + await browserMessage());
  if (!root && !demo && !options.brief && !options.status) {
    if (!ask) {
      print('サンプルで試す     npm run setup -- --demo');
      print('自分のアプリ       npm run setup -- campaigns/my-app（対話端末）');
      print('入力済み設定を使う npm run setup -- campaigns/my-app --brief path/to/brief.json');
      return;
    }
    let answer = '';
    while (!['1', '2'].includes(answer)) answer = await ask('1. サンプルで試す（認証不要）  2. 自分のアプリを設定する', '1');
    demo = answer === '1';
    if (!demo) root = await ask('運用フォルダ', 'campaigns/my-app');
  }
  root ??= demo || options.status ? demoRoot : 'campaigns/my-app';
  const fullPath = path.resolve(root);
  const command = (name: string) => 'npx app-shorts ' + name + ' ' + shell(root);
  const resume = 'npm run setup -- ' + shell(root) + ' --status' + (options.series ? ' --series' : '');
  let input = await optional(() => workspace(fullPath));
  const sample = demo ? await readDoc(example('workspace.json'), WorkspaceSchema) : undefined;
  if (input && sample && input.id !== sample.id) throw new Error('指定先には別のアプリの設定があります。サンプル用の別フォルダを指定してください。');
  if (!input && options.status) {
    print('未設定  ' + fullPath);
    print('次に実行  npm run setup -- ' + shell(root) + (demo ? ' --demo' : ''));
    return;
  }
  if (!input) {
    if (!sample && !options.brief && !ask) {
      print('次に実行  対話端末で npm run setup -- ' + shell(root) + ' を開くか、--brief <json> を付けてください。');
      print('用意するもの  アプリ名、対象ユーザー、利用場面、確認済みの機能、動画で促したい行動。');
      return;
    }
    if (!sample && !options.brief) print('先に用意  アプリ名、対象ユーザー、確認済みの機能、動画を見た人に促したい行動。');
    input = sample ?? (options.brief ? await readDoc(options.brief, WorkspaceSchema) : await interview(fullPath, ask!));
    const contentFile = sample ? example('content.json') : options.content;
    await setup(fullPath, input, contentFile ? await readDoc(contentFile, ContentSchema) : undefined);
    print('作成済み  ' + path.join(fullPath, 'workspace.json'));
  } else {
    if (options.brief || options.content) throw new Error('既存の設定は保持しました。追加素材は運用フォルダに配置し、' + resume + ' で再確認してください。');
    print('設定済み  ' + fullPath);
  }
  const isDemo = demo || input.id === 'field-notes-example';
  const missingAssets: string[] = [];
  print('対象  ' + input.app.name + '  /  評価指標 ' + input.goals.primaryKpi);
  if (isDemo) {
    print('用意するもの  サンプルのアプリ情報と問題データは同梱済み。YouTube認証なしで試せます。');
  } else {
    print('用意するもの  ロゴ・スクリーンショット・画面収録（任意、利用権のある素材を assets/ に配置）。');
    print('素材を使うときは workspace.json の creative.logo または creative.featureAsset に相対パスを設定してください。');
    for (const asset of [input.creative?.logo, input.creative?.featureAsset?.path]) {
      if (asset && !(await optional(() => stat(path.resolve(fullPath, 'assets', asset))))?.isFile()) missingAssets.push(asset);
    }
    if (missingAssets.length) print('不足している登録素材  ' + missingAssets.join('、'));
  }
  const contentFile = path.join(fullPath, 'content.json');
  const contentPresent = !!(await optional(() => stat(contentFile)))?.isFile();
  const series = options.series || isDemo || contentPresent;
  const recipe = series ? 'repeatable-quiz' : 'product-introduction';
  print('次の確認コマンド  ' + resume);
  print('本番投稿で用意  YouTubeチャンネル、Google CloudのデスクトップOAuth、定期実行する端末。手順は docs/operations.md。');

  const allPlans = await plans(fullPath);
  const target = allPlans.find((item) => item.recipeId === recipe) ?? (series ? undefined : allPlans[0]);
  if (!target) {
    if (missingAssets.length) {
      print('次に準備  登録済みの素材を assets/ に配置するか、workspace.json で素材の指定を修正してください。');
      return;
    }
    if (series && !contentPresent) {
      print('次に準備  ' + contentFile + ' に id、prompt、answer を持つ項目を用意してください（例は examples/field-notes/content.json）。');
      return;
    }
    if (series) {
      const content = await readJson(contentFile).then((data) => ContentSchema.safeParse(data)).catch((error: unknown) => {
        if (error instanceof SyntaxError) return undefined;
        throw error;
      });
      if (!content?.success) {
        print('次に修正  ' + contentFile + ' を確認してください。id、prompt、answer を持つ配列が必要です。');
        return;
      }
    }
    await getRecipe(fullPath, recipe, 1);
    print('次に実行  ' + command('plan') + ' --recipe ' + recipe);
    print('その後    ' + command('render-batch'));
    return;
  }
  const video = mediaPath(fullPath, target.id);
  const mediaHash = await optional(() => fileHash(video));
  if (!mediaHash) {
    print('次に実行  ' + command('render-batch') + ' ' + target.id);
    return;
  }
  const report = await optional(() => readDoc(doc(fullPath, 'qa', target.id + '-' + mediaHash.slice(0, 16)), QASchema));
  if (!report || report.planHash !== digest(target) || report.mediaHash !== mediaHash) {
    print('次に実行  ' + command('qa') + ' ' + target.id);
    return;
  }
  if (!await optional(() => approvedHash(fullPath, target))) {
    print('次に確認  ' + video + ' と qa/ の画像を見て、文章・素材・文字切れを確認。');
    print('確認後    ' + command('approve') + ' ' + target.id + ' --by operator');
    return;
  }
  if (!isDemo) {
    print('次に進む  docs/operations.md「本番の翌日投稿」または「ローカルで翌日の投稿を試す」。');
    return;
  }
  const request = (await publicationRequests(fullPath, 'simulation')).find((item) => item.planId === target.id);
  if (!request) {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    print('次に実行  ' + command('schedule') + ' ' + target.id + ' --at ' + tomorrow + ' --made-for-kids false --simulate');
  } else if (request.approvalStatus === 'pending') {
    print('次に実行  ' + command('publish-approve') + ' ' + request.idempotencyKey + ' --channel simulation-channel --by operator --simulate');
  } else if (!(await publicationRecords(fullPath, 'simulation')).some((item) => item.id === request.idempotencyKey && item.processingStatus === 'succeeded')) {
    print('次に実行  ' + command('tick') + ' --simulate --now ' + request.scheduledAt);
  } else {
    print('模擬投稿済み。確認  ' + command('publish-status') + ' --simulate');
  }
}

export async function interview(root: string, ask: Ask) {
  const id = await ask('アプリ識別子（小文字英数字・ハイフン）', path.basename(path.resolve(root)).toLowerCase().replace(/[^a-z0-9-]/g, '-'));
  const name = await ask('アプリ名');
  const destinationUrl = await ask('ストアURL（任意）');
  const audience = await ask('最初に届けたい人と利用場面');
  const problem = await ask('その人が困っていること');
  const promise = await ask('確認済みの機能で伝えたい価値');
  const proof = (await ask('根拠のある機能・実績（任意、| 区切り）')).split('|').map((item) => item.trim()).filter(Boolean);
  const prohibitedClaims = (await ask('避けたい表現（任意、| 区切り）')).split('|').map((item) => item.trim()).filter(Boolean);
  const primaryKpi = await ask('評価指標', 'first_time_downloads');
  const tone = await ask('動画の雰囲気', '親しみやすい');
  const cta = await ask('動画の最後に促す行動', name);
  const postsPerWeek = Number(await ask('週あたりの目標投稿数', '3'));
  return WorkspaceSchema.parse({kind: 'workspace', schemaVersion: 1, id,
    app: {name, destinationUrl: destinationUrl || undefined, audience, problem, promise, proof, prohibitedClaims, category: 'App'},
    goals: {primaryKpi, secondaryKpis: ['views', 'likes', 'comments']},
    creative: {brand: defaultBrand, tone, cta}, contentPillars: ['product-introduction', 'repeatable-series'],
    channels: [{platform: 'youtube', enabled: false, approvalMode: 'manual'}], cadence: {postsPerWeek}});
}
