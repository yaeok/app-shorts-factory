import {mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {VideoProjectSchema, type VideoProject} from '../schema';
import {IdSchema, RecipeSchema, VideoPlanSchema, WorkspaceSchema, type Recipe, type Workspace} from '../workflow-schema';
import {digest, doc, fileHash, hash, immutable, isPresent, listDocs, optional, readDoc, workspace} from './store';

export const defaultBrand = {primaryColor: '#284DBC', secondaryColor: '#FDD561', backgroundColor: '#0C1730', textColor: '#FFFFFF', fontFamily: 'sans-serif'};
export const ContentSchema = z.array(z.object({
  id: IdSchema, prompt: z.string().min(1).max(80), answer: z.string().min(1).max(80),
  explanation: z.string().max(180).optional(),
})).min(1).refine((items) => new Set(items.map((item) => item.id)).size === items.length, '素材IDは重複できません');
export const ProposalSchema = z.object({
  id: IdSchema, workspaceId: IdSchema, recipeId: IdSchema, recipeVersion: z.number().int().positive(),
  baseRecipeHash: z.string(), hook: z.string().min(1).max(80), hypothesis: z.string().min(1).max(500),
  evidenceIds: z.array(IdSchema), provenance: z.record(z.string(), z.unknown()).optional(),
});
export type Plan = z.infer<typeof VideoPlanSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;

export function baseRecipe(mode: Recipe['mode']): Recipe {
  const intro = mode === 'product-introduction';
  return RecipeSchema.parse({
    kind: 'recipe', schemaVersion: 1, id: intro ? 'product-introduction' : 'repeatable-quiz', version: 1,
    mode, generator: intro ? 'template' : 'deterministic', objective: intro ? 'アプリの用途を伝える' : '出典付きの一問一答を届ける',
    sceneOrder: intro ? ['hook', 'problem', 'feature', 'proof', 'cta'] : ['hook', 'prompt', 'thinking', 'answer', 'cta'],
    status: 'draft', variableCandidates: ['hook'], fixedConditions: ['body', 'theme', 'media', 'duration', 'cta'],
  });
}

export const recipeKey = (id: string, version: number) => IdSchema.parse(id) + '-v' + version;
export async function getRecipe(root: string, id: string, version: number) {
  const result = await optional(() => readDoc(doc(root, 'recipes', recipeKey(id, version)), RecipeSchema)) ??
    await readDoc(doc(root, 'recipes', id), RecipeSchema);
  if (result.id !== id || result.version !== version || result.status === 'retired') throw new Error('使用できるレシピ版が見つかりません');
  return result;
}

export async function setup(root: string, input: Workspace, content?: z.infer<typeof ContentSchema>) {
  await immutable(path.join(root, 'workspace.json'), WorkspaceSchema.parse(input));
  for (const mode of ['product-introduction', 'repeatable-series'] as const) {
    const recipe = baseRecipe(mode);
    await immutable(doc(root, 'recipes', recipeKey(recipe.id, recipe.version)), recipe);
  }
  if (content) await immutable(path.join(root, 'content.json'), ContentSchema.parse(content));
  await mkdir(path.join(root, 'assets'), {recursive: true});
}

export const rendererFingerprint = async () => digest(await Promise.all(
  ['package-lock.json', 'src/schema.ts', 'src/render.ts', 'src/remotion/AppShort.tsx', 'src/remotion/Root.tsx', 'src/remotion/index.ts']
    .map((filename) => fileHash(fileURLToPath(new URL('../../' + filename, import.meta.url)))),
));

async function readAssets(root: string, project: VideoProject) {
  const names = new Set([project.app.logo, ...project.video.scenes.map((scene) => scene.asset)].filter((name): name is string => !!name));
  const assets = [];
  for (const name of names) {
    if (!/^[\p{L}\p{N}._ /-]+$/u.test(name) || name.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('無効な素材パスです: ' + name);
    const base = await realpath(path.join(root, 'assets'));
    const source = await realpath(path.join(base, name));
    if (!source.startsWith(base + path.sep)) throw new Error('素材はassets内を指定してください');
    const bytes = await readFile(source);
    assets.push({name, bytes, sha: hash(bytes)});
  }
  return assets;
}

async function snapshotAssets(root: string, planId: string, assets: Awaited<ReturnType<typeof readAssets>>) {
  const target = path.join(root, 'inputs', planId);
  await mkdir(target, {recursive: true});
  for (const {name, bytes, sha} of assets) {
    const destination = path.join(target, name);
    await mkdir(path.dirname(destination), {recursive: true});
    try { await writeFile(destination, bytes, {flag: 'wx'}); }
    catch (error) {
      if (!isPresent(error) || await fileHash(destination) !== sha) throw error;
    }
  }
}

const cut = (value: string, length: number) => Array.from(value).slice(0, length).join('');

export async function makePlans(root: string, recipe: Recipe, count: number, start: number, proposal?: Proposal) {
  const input = await workspace(root);
  const recipeHash = digest(recipe);
  const workspaceHash = digest(input);
  if (recipe.generator === 'manual') throw new Error('manualレシピは明示的な動画企画を作成してください');
  if (proposal && (proposal.workspaceId !== input.id || proposal.baseRecipeHash !== recipeHash || proposal.recipeId !== recipe.id ||
    proposal.recipeVersion !== recipe.version)) throw new Error('提案のワークスペースまたは元レシピ版が異なります');
  const items = recipe.mode === 'repeatable-series' ? await readDoc(path.join(root, 'content.json'), ContentSchema) : null;
  if (items && (count > items.length || !Number.isSafeInteger(start + count))) throw new Error('本数分の異なる問題をcontent.jsonへ用意してください');
  const renderer = await rendererFingerprint();
  const created: Plan[] = [];
  for (let offset = 0; offset < count; offset++) {
    const seed = start + offset;
    const item = items?.[seed % items.length];
    const proof = input.app.proof[seed % input.app.proof.length];
    const creative = input.creative;
    const project = VideoProjectSchema.parse({
      schemaVersion: 1,
      app: {name: cut(input.app.name, 40), category: cut(input.app.category, 40), audience: cut(input.app.audience, 100),
        valueProposition: cut(input.app.promise, 180), logo: creative?.logo, storeUrl: input.app.destinationUrl},
      brand: creative?.brand ?? defaultBrand,
      video: {title: cut(item ? input.app.name + '｜' + item.prompt : input.app.name + '｜' + (proof ?? input.app.promise), 100),
        scenes: recipe.sceneOrder.flatMap((type) => {
          const copy: Partial<Record<typeof type, {headline: string; body?: string; seconds: number}>> = {
            hook: {headline: recipe.hook ?? (item ? 'この1問、わかりますか？' : cut(input.app.problem, 80)), seconds: 2},
            problem: {headline: cut(input.app.problem, 80), seconds: 3},
            feature: {headline: cut(input.app.promise, 80), seconds: 4},
            proof: proof ? {headline: cut(proof, 80), seconds: 3} : undefined,
            prompt: item ? {headline: item.prompt, seconds: 4} : undefined,
            thinking: {headline: '答えを考えてみよう', seconds: 3},
            answer: item ? {headline: item.answer, body: item.explanation, seconds: 4} : undefined,
            cta: {headline: creative?.cta ?? input.app.name, seconds: 3},
          };
          const scene = copy[type];
          if (!scene && type !== 'proof') throw new Error('この生成器で素材を解決できないシーンです: ' + type);
          const media = type === 'feature' ? creative?.featureAsset : undefined;
          return scene ? [{type, headline: scene.headline, body: scene.body, durationSeconds: scene.seconds,
            ...(media ? {asset: media.path, assetType: media.type, layout: 'media-top'} : {})}] : [];
        })},
    });
    const hookIndex = project.video.scenes.findIndex((scene) => scene.type === 'hook');
    if (proposal && (hookIndex < 0 || project.video.scenes[hookIndex]?.headline === proposal.hook)) throw new Error('比較対象と異なるフックが必要です');
    const assets = await readAssets(root, project);
    const assetHashes = Object.fromEntries(assets.map(({name, sha}) => [name, sha]));
    const pairId = 'pair-' + digest([input.id, recipeHash, proposal?.id, seed, project, assetHashes]).slice(0, 20);
    for (const arm of proposal ? ['control', 'variant'] as const : ['control'] as const) {
      const video = structuredClone(project);
      if (arm === 'variant' && proposal) video.video.scenes[hookIndex]!.headline = proposal.hook;
      const id = recipe.id + '-' + digest([renderer, workspaceHash, recipeHash, seed, arm, proposal?.id, video, item, assetHashes]).slice(0, 20);
      await snapshotAssets(root, id, assets);
      const plan = VideoPlanSchema.parse({
        kind: 'video-plan', schemaVersion: 1, id, workspaceId: input.id, recipeId: recipe.id, recipeVersion: recipe.version,
        hypothesis: proposal?.hypothesis ?? recipe.objective, changedVariable: proposal ? 'hook.headline' : 'content',
        fixedConditions: recipe.fixedConditions, seed, project: video,
        reproducibility: {renderer, assetHashes, recipeHash, workspaceHash, sourceHash: item ? digest(item) : undefined},
        experiment: proposal ? {pairId, arm, proposalId: proposal.id, subjectHash: digest(item ?? proof ?? input.app.promise)} : undefined,
      });
      await immutable(doc(root, 'plans', id), plan);
      created.push(plan);
    }
  }
  return created;
}

// Older workspaces can contain standalone *.project.json files alongside their plans.
export const plans = async (root: string) => listDocs(root, 'plans', VideoPlanSchema.or(z.object({schemaVersion: z.literal(1), app: z.unknown(), video: z.unknown()})))
  .then((documents) => documents.filter((document): document is Plan => 'kind' in document));

export async function loadPlan(root: string, id: string) {
  const filename = doc(root, 'plans', id);
  const plan = await optional(() => readDoc(filename, VideoPlanSchema)) ??
    await readDoc(filename.replace(/\.json$/, '.plan.json'), VideoPlanSchema);
  if (plan.id !== id) throw new Error('ファイルの企画IDが一致しません');
  return plan;
}
