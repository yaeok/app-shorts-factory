import {access} from 'node:fs/promises';
import {stdin, stdout} from 'node:process';
import {createInterface} from 'node:readline/promises';
import path from 'node:path';
import {Command, InvalidArgumentError} from 'commander';
import {z} from 'zod';
import {WorkspaceSchema} from '../workflow-schema';
import {ContentSchema, defaultBrand, getRecipe, loadPlan as getPlan, makePlans, plans, ProposalSchema, setup} from './planning';
import {approveMedia, qa, renderPlan} from './media';
import {approvePublication, checkpoints, publicationErrors, publicationRecords, publicationRequests, schedule, tick, type Checkpoint} from './publishing';
import {importSnapshot, makeProposal, promote, replicate, review} from './learning';
import {doc, listDocs, readDoc, readJson} from './store';

const json = (result: unknown) => console.log(JSON.stringify(result, null, 2));
const integer = (value: string) => {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number)) throw new InvalidArgumentError('0以上の整数を指定してください');
  return number;
};
const environment = (options: {simulate?: boolean}) => options.simulate ? 'simulation' as const : 'youtube' as const;
const clock = (value?: string) => value ? new Date(z.iso.datetime({offset: true}).parse(value)) : new Date();
const getProposal = (root: string, id: string) => readDoc(doc(root, 'proposals', id), ProposalSchema);
const safeClock = (options: {simulate?: boolean; now?: string}) => {
  if (options.now && !options.simulate) throw new Error('--nowはシミュレーション専用です');
  return clock(options.now);
};
const adapter = async (root: string, simulate: boolean | undefined, now: Date) => simulate
  ? (await import('./simulation')).simulationAdapter(root, now)
  : (await import('./youtube')).youtubeFromEnvironment();
const checkpoint = (input: string) => z.enum(['24h', '72h', '7d']).parse(input);

export function operations(program: Command) {
  program.command('doctor').description('実行環境を診断')
    .action(async () => {
      const node = Number(process.versions.node.split('.')[0]);
      const configured = process.env.REMOTION_BROWSER_EXECUTABLE;
      if (configured) await access(configured);
      json({node: process.version, supported: node >= 22, browser: configured ?? 'Remotion default',
        youtubeCredentialsConfigured: Boolean(process.env.SHORTS_YOUTUBE_CREDENTIALS ||
          (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN))});
      if (node < 22) process.exitCode = 1;
    });

  program.command('interview <workspace>').description('対話またはJSONからアプリの運用設定を作成')
    .option('--brief <json>', '入力済みのワークスペースJSON').option('--content <json>', '繰り返し動画用の素材JSON')
    .action(async (root: string, options) => {
      if (!options.brief && !stdin.isTTY) throw new Error('端末で起動するか --brief を指定してください');
      const settings = options.brief ? await readDoc(options.brief, WorkspaceSchema) : await interview(root);
      await setup(root, settings, options.content ? await readDoc(options.content, ContentSchema) : undefined);
      json({workspace: path.resolve(root), id: settings.id, recipes: ['product-introduction', 'repeatable-quiz']});
    });

  program.command('plan <workspace>').description('同じ条件から再生成できる動画企画を保存')
    .requiredOption('--recipe <id>').option('--version <n>', 'レシピの版', integer, 1)
    .option('--count <n>', '本数または比較ペア数', integer, 1).option('--seed <n>', '最初の素材番号', integer, 0)
    .option('--proposal <id>', 'フック比較を生成する提案ID')
    .action(async (root: string, options) => {
      if (options.count < 1 || options.count > 100 || !Number.isSafeInteger(options.seed + options.count)) throw new Error('本数は1〜100、seedは安全な整数を指定してください');
      const recipe = await getRecipe(root, options.recipe, options.version);
      const created = await makePlans(root, recipe, options.count, options.seed, options.proposal ? await getProposal(root, options.proposal) : undefined);
      json(created.map((plan) => ({id: plan.id, title: plan.project.video.title, experiment: plan.experiment})));
    });

  program.command('render-batch <workspace> [planIds...]').description('企画をMP4に変換')
    .action(async (root: string, ids: string[]) => {
      const selected = ids.length ? await Promise.all(ids.map((id) => getPlan(root, id))) : await plans(root);
      if (!selected.length) throw new Error('レンダリング対象の企画がありません');
      for (const plan of selected) console.log(await renderPlan(path.resolve(root), plan));
    });

  program.command('qa <workspace> <planIds...>').description('MP4を検査してフック・中間・CTAの画像を出力')
    .action(async (root: string, ids: string[]) => {
      for (const id of ids) json({id, ...await qa(path.resolve(root), await getPlan(root, id))});
    });

  program.command('approve <workspace> <planId>').description('動画の内容・素材・目視QAを承認')
    .requiredOption('--by <name>')
    .action(async (root, id, options) => json(await approveMedia(root, await getPlan(root, id), options.by)));

  const youtube = program.command('youtube').description('YouTubeのOAuth接続');
  youtube.command('connect').requiredOption('--client <json>').requiredOption('--out <json>').action(async (options) => {
    const {connect} = await import('./youtube');
    json(await connect(options.client, options.out, (url) => console.log('このURLをブラウザで開いてください\n' + url)));
  });
  youtube.command('status').action(async () => json(await (await (await import('./youtube')).youtubeFromEnvironment()).channel()));

  program.command('schedule <workspace> <planId>').description('承認済み動画の投稿時刻と公開設定を登録')
    .requiredOption('--at <datetime>', 'タイムゾーン付きISO時刻')
    .requiredOption('--made-for-kids <true|false>').option('--privacy <mode>', '公開設定', 'private')
    .option('--title <text>').option('--description <text>').option('--simulate')
    .action(async (root, id, options) => json(await schedule(root, id, environment(options), options.at, {
      privacyStatus: z.enum(['private', 'unlisted', 'public']).parse(options.privacy),
      madeForKids: z.enum(['true', 'false']).parse(options.madeForKids) === 'true',
      title: options.title, description: options.description,
    })));

  program.command('publish-approve <workspace> <requestId>').description('日時・公開範囲・投稿先を確認して送信を許可')
    .requiredOption('--channel <id>').requiredOption('--by <name>').option('--simulate')
    .action(async (root, id, options) => json(await approvePublication(root, environment(options), id, options.by, options.channel)));

  program.command('publish-status <workspace>').description('ローカル台帳で予約・投稿・失敗を確認').option('--simulate')
    .action(async (root, options) => {
      const env = environment(options);
      const [queued, publications, errors] = await Promise.all([publicationRequests(root, env), publicationRecords(root, env), publicationErrors(root, env)]);
      json({environment: env, queued, publications, errors: errors.filter((error) => !publications.some((row) =>
        row.id === error.id && row.verifiedAt && Date.parse(row.verifiedAt) > Date.parse(error.failedAt)))});
    });

  program.command('tick <workspace>').description('予約済み投稿の実行・処理確認・定点観測とレビュー')
    .option('--simulate').option('--now <datetime>', 'シミュレーション用時計').option('--ai-model <model>', '改善レビューをAIに送るモデル')
    .action(async (root, options) => {
      const now = safeClock(options);
      const env = environment(options);
      if (options.simulate && options.aiModel) throw new Error('シミュレーションの証拠を外部AIに送信できません');
      const requests = await publicationRequests(root, env);
      const result = requests.length ? await tick(root, await adapter(root, options.simulate, now), now) : [];
      json({environment: env, publications: result});
      for (const proposal of await listDocs(root, 'proposals', ProposalSchema)) {
        for (const point of Object.keys(checkpoints) as Checkpoint[]) {
          const record = await review(root, proposal, point, env);
          if (!('id' in record)) continue;
          json({reviewId: record.id, decision: record.decision, checkpoint: point});
          // Evaluate completed weekly windows before requesting another paid AI proposal.
          if (options.aiModel && point === '7d' && record.planIds.length >= 6 &&
            (record.decision === 'iterate' || record.decision === 'reject')) {
            const {aiProposal} = await import('./ai');
            json(await aiProposal(root, proposal.recipeId, proposal.recipeVersion, options.aiModel, record.id));
          }
        }
      }
      if (result.some((item) => item.status === 'error' || item.status === 'failed')) process.exitCode = 1;
    });

  program.command('reconcile <workspace> <requestId> <videoId>').description('送信結果が不明な投稿に実在する動画IDを紐付け')
    .action(async (root, id, video) => {
      const now = new Date();
      const results = await tick(root, await adapter(root, false, now), now, {id, video});
      if (!results.length) throw new Error('照合可能な承認済み投稿がありません');
      json(results);
      if (results.some((item) => item.status === 'error' || item.status === 'failed')) process.exitCode = 1;
    });

  program.command('metrics-import <workspace> <snapshot>').description('時刻と出典が確認できる指標を取り込む')
    .option('--simulate').action(async (root, filename, options) => json(await importSnapshot(root, environment(options), await readJson(filename))));

  program.command('propose <workspace>').description('次の単一変更を保存')
    .requiredOption('--recipe <id>').option('--version <n>', 'レシピの版', integer, 1)
    .option('--hook <text>').option('--hypothesis <text>').option('--ai-model <model>').option('--review <id>')
    .action(async (root, options) => {
      if (options.aiModel) {
        if (options.hook || options.hypothesis) throw new Error('AI提案か手動提案を選んでください');
        json(await (await import('./ai')).aiProposal(root, options.recipe, options.version, options.aiModel, options.review));
      } else {
        if (!options.hook || !options.hypothesis || options.review) throw new Error('手動提案には --hook と --hypothesis が必要です');
        json(await makeProposal(root, options.recipe, options.version, options.hook, options.hypothesis));
      }
    });

  program.command('review <workspace> <proposalId>').description('同一条件のペアを評価し学習候補を記録')
    .requiredOption('--checkpoint <24h|72h|7d>').option('--simulate')
    .action(async (root, id, options) => json(await review(root, await getProposal(root, id), checkpoint(options.checkpoint), environment(options))));
  program.command('promote <workspace> <learningId>').description('再現した学習を新しいレシピ版として採用')
    .requiredOption('--by <name>').requiredOption('--preview <planId>').option('--simulate')
    .action(async (root, id, options) => json(await promote(root, environment(options), id, options.by, options.preview)));
  program.command('replicate <source> <learningId> <target>').description('別アプリ向けに採用済みレシピの下書きを作成')
    .requiredOption('--brief <json>').action(async (source, id, target, options) => json(await replicate(source, target, id, options.brief)));
}

async function interview(root: string) {
  const reader = createInterface({input: stdin, output: stdout});
  const ask = async (prompt: string, fallback?: string) => (await reader.question(prompt + (fallback ? ' [' + fallback + ']' : '') + ' > ')).trim() || fallback || '';
  try {
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
  } finally { reader.close(); }
}
