import path from 'node:path';
import {z} from 'zod';
import {LearningSchema, MetricSnapshotSchema, RecipeSchema, ReviewSchema} from '../workflow-schema';
import {approvedHash} from './media';
import {getRecipe, plans, ProposalSchema, recipeKey, setup, type Plan, type Proposal} from './planning';
import {checkpointId, checkpoints, metricsDirectory, publicationRecords, type Checkpoint, type Environment, type Publication} from './publishing';
import {digest, doc, immutable, listDocs, optional, readDoc, save, workspace} from './store';

type Snapshot = z.infer<typeof MetricSnapshotSchema>;
const importFolder = (environment: Environment) => environment === 'simulation' ? 'simulation/metric-imports' : 'metric-imports';
const reviewFolder = (environment: Environment) => environment === 'simulation' ? 'simulation/reviews' : 'reviews';
const learningFolder = (environment: Environment) => environment === 'simulation' ? 'simulation/learnings' : 'learnings';
const policy = {pairs: 3, medianLift: 0.1};

function atCheckpoint(publication: Publication, checkpoint: Checkpoint, clock: string) {
  const age = (Date.parse(clock) - Date.parse(publication.publishedAt)) / 3_600_000;
  return age >= checkpoints[checkpoint] && age < checkpoints[checkpoint] + 2;
}
export async function importSnapshot(root: string, environment: Environment, value: unknown) {
  const snapshot = MetricSnapshotSchema.parse(value);
  const publication = (await publicationRecords(root, environment)).find((record) => record.id === snapshot.publicationId);
  if (!publication || publication.processingStatus !== 'succeeded') throw new Error('処理完了済みの投稿を指定してください');
  if (snapshot.environment !== environment || !atCheckpoint(publication, snapshot.checkpoint, snapshot.observedAt) ||
    (environment === 'youtube' && Date.parse(snapshot.observedAt) > Date.now())) throw new Error('計測環境または観測時刻がチェックポイントと一致しません');
  const id = checkpointId(snapshot.publicationId, snapshot.checkpoint);
  await immutable(doc(root, importFolder(environment), id), snapshot);
  return id;
}

type Pair = {control?: Plan; variant?: Plan};
function comparable(control: Plan, variant: Plan, proposal: Proposal) {
  const comparableProject = (plan: Plan) => ({...plan.project, video: {...plan.project.video,
    scenes: plan.project.video.scenes.map((scene) => scene.type === 'hook' ? {...scene, headline: ''} : scene)}});
  const oneHook = (plan: Plan) => plan.project.video.scenes.filter((scene) => scene.type === 'hook').length === 1;
  return oneHook(control) && oneHook(variant) && variant.project.video.scenes.find((scene) => scene.type === 'hook')?.headline === proposal.hook &&
    control.project.video.scenes.find((scene) => scene.type === 'hook')?.headline !== proposal.hook &&
    digest(comparableProject(control)) === digest(comparableProject(variant)) &&
    digest(control.reproducibility) === digest(variant.reproducibility) &&
    control.seed === variant.seed && control.experiment?.subjectHash === variant.experiment?.subjectHash;
}

export async function review(root: string, proposal: Proposal, checkpoint: Checkpoint, environment: Environment) {
  const input = await workspace(root);
  if (proposal.workspaceId !== input.id) throw new Error('比較対象のワークスペースが異なります');
  const kpi = input.goals.primaryKpi;
  const [allPlans, records, collected, imported] = await Promise.all([
    plans(root), publicationRecords(root, environment), listDocs(root, metricsDirectory(environment), MetricSnapshotSchema),
    listDocs(root, importFolder(environment), MetricSnapshotSchema),
  ]);
  const byPlan = new Map(records.filter((record) => record.processingStatus === 'succeeded').map((record) => [record.planId, record]));
  const pairs = new Map<string, Pair>();
  for (const plan of allPlans) {
    const experiment = plan.experiment;
    if (plan.workspaceId !== input.id || plan.recipeId !== proposal.recipeId || plan.recipeVersion !== proposal.recipeVersion ||
      plan.reproducibility?.recipeHash !== proposal.baseRecipeHash || experiment?.proposalId !== proposal.id) continue;
    const pair = pairs.get(experiment.pairId) ?? {};
    pair[experiment.arm] = plan;
    pairs.set(experiment.pairId, pair);
  }
  const observations = [];
  const subjects = new Set<string>();
  const conflicts = new Set<string>();
  const readMetric = (publication: Publication) => {
    const candidates = [...collected, ...imported].filter((snapshot) => snapshot.environment === environment &&
      snapshot.publicationId === publication.id && snapshot.checkpoint === checkpoint && atCheckpoint(publication, checkpoint, snapshot.observedAt) &&
      snapshot.metrics[kpi]?.state === 'measured');
    if (candidates.length > 1 && digest(candidates[0]?.metrics[kpi]) !== digest(candidates[1]?.metrics[kpi])) conflicts.add(publication.id);
    return candidates[0];
  };
  for (const {control, variant} of pairs.values()) {
    if (!control || !variant || !comparable(control, variant, proposal)) continue;
    const subject = control.experiment!.subjectHash;
    const left = byPlan.get(control.id);
    const right = byPlan.get(variant.id);
    if (!left || !right || left.accountId !== right.accountId || left.privacyStatus !== right.privacyStatus ||
      (environment === 'youtube' && left.privacyStatus === 'private')) continue;
    const a = readMetric(left);
    const b = readMetric(right);
    const x = a?.metrics[kpi];
    const y = b?.metrics[kpi];
    if (!a || !b || !x || !y || x.source !== y.source || x.value === null || y.value === null || conflicts.has(left.id) || conflicts.has(right.id)) continue;
    if (subjects.has(subject)) {
      conflicts.add(subject);
      continue;
    }
    subjects.add(subject);
    observations.push({subject, control: control.id, variant: variant.id, baseline: x.value, changed: y.value,
      lift: (y.value - x.value) / Math.max(1, Math.abs(x.value)),
      evidence: [a, b].map((snapshot) => ({id: checkpointId(snapshot.publicationId, checkpoint), sha256: digest(snapshot)}))});
  }
  if (!observations.length) return {decision: 'hold', reason: '同一条件・同一計測元の比較ペアがありません', kpi, checkpoint} as const;
  const lifts = observations.map((row) => row.lift).sort((a, b) => a - b);
  const lift = (lifts[Math.floor((lifts.length - 1) / 2)]! + lifts[Math.floor(lifts.length / 2)]!) / 2;
  const wins = lifts.filter((value) => value > 0).length;
  const losses = lifts.filter((value) => value < 0).length;
  const decision = conflicts.size > 0 ? 'hold'
    : observations.length >= policy.pairs && wins === observations.length && lift >= policy.medianLift ? 'replicate'
    : observations.length >= policy.pairs && losses === observations.length ? 'reject' : 'iterate';
  const id = 'review-' + digest([proposal.id, checkpoint, environment, kpi, policy, observations, [...conflicts]]).slice(0, 24);
  const filename = doc(root, reviewFolder(environment), id);
  const existing = await optional(() => readDoc(filename, ReviewSchema.passthrough()));
  const details = {proposalId: proposal.id, environment, observations, policy, medianLift: lift, wins, losses, conflicts: [...conflicts]};
  const record = existing ?? {...ReviewSchema.parse({kind: 'review', schemaVersion: 1, id, workspaceId: input.id, recipeId: proposal.recipeId,
    planIds: observations.flatMap((row) => [row.control, row.variant]), checkpoint, primaryKpi: kpi,
    evidenceSnapshotIds: observations.flatMap((row) => row.evidence.map((evidence) => evidence.id)), decision,
    conclusion: '同一時点の比較 ' + observations.length + ' 組。改善 ' + wins + ' 組、悪化 ' + losses + ' 組。効果の因果関係は未確定。',
    nextChangedVariable: decision === 'replicate' || decision === 'hold' ? null : 'hook.headline', reviewedAt: new Date().toISOString()}), ...details};
  await immutable(filename, record);
  const learningId = 'learning-' + id.slice('review-'.length);
  if (decision === 'replicate' || (decision === 'iterate' && wins > 0)) {
    const learning = LearningSchema.parse({kind: 'learning', schemaVersion: 1, id: learningId,
      state: decision === 'replicate' ? 'replicated' : 'candidate', claim: proposal.hypothesis, hook: proposal.hook,
      appliesWhen: [input.id, proposal.recipeId, kpi, checkpoint], evidenceIds: [id],
      counterexampleIds: observations.filter((row) => row.lift < 0).map((row) => row.variant), proposedRecipeId: proposal.recipeId,
      proposedVersion: proposal.recipeVersion + 1, simulation: environment === 'simulation'});
    const target = doc(root, learningFolder(environment), learningId);
    if (!await optional(() => readDoc(target, LearningSchema))) await immutable(target, learning);
    return {...record, learningId};
  }
  return record;
}

export async function makeProposal(root: string, recipeId: string, version: number, hook: string, hypothesis: string,
  evidenceIds: string[] = [], provenance?: Proposal['provenance']) {
  const input = await workspace(root);
  const recipe = await getRecipe(root, recipeId, version);
  hook = hook.trim();
  hypothesis = hypothesis.trim();
  if (input.app.prohibitedClaims.some((phrase) => hook.includes(phrase))) throw new Error('フックに禁止表現が含まれています');
  const baseRecipeHash = digest(recipe);
  const proposal = ProposalSchema.parse({id: 'proposal-' + digest([input.id, baseRecipeHash, hook, hypothesis, evidenceIds]).slice(0, 24),
    workspaceId: input.id, recipeId, recipeVersion: version, baseRecipeHash, hook, hypothesis, evidenceIds, provenance});
  const filename = doc(root, 'proposals', proposal.id);
  const previous = await optional(() => readDoc(filename, ProposalSchema));
  if (previous) return previous;
  await immutable(filename, proposal);
  return proposal;
}

export async function promote(root: string, environment: Environment, learningId: string, approver: string, previewId: string) {
  const filename = doc(root, learningFolder(environment), learningId);
  const learning = await readDoc(filename, LearningSchema);
  if (!['replicated', 'approved', 'adopted'].includes(learning.state) || !learning.hook) throw new Error('再現確認済みの学習が必要です');
  const evidence = await readDoc(doc(root, reviewFolder(environment), learning.evidenceIds[0]!), ReviewSchema.extend({proposalId: z.string()}));
  const proposal = await readDoc(doc(root, 'proposals', evidence.proposalId), ProposalSchema);
  const current = await review(root, proposal, evidence.checkpoint, environment);
  if (current.decision !== 'replicate' || !('learningId' in current) || current.learningId !== learningId)
    throw new Error('最新の比較結果を再評価してください');
  const preview = (await plans(root)).find((plan) => plan.id === previewId);
  if (!preview || preview.experiment?.arm !== 'variant' || !evidence.planIds.includes(previewId)) throw new Error('比較に使用した改善版をプレビューに指定してください');
  await approvedHash(root, preview);
  const recipe = await getRecipe(root, proposal.recipeId, proposal.recipeVersion);
  if (digest(recipe) !== proposal.baseRecipeHash) throw new Error('比較の基準レシピが変更されました');
  const next = RecipeSchema.parse({...recipe, version: learning.proposedVersion, hook: proposal.hook, status: 'approved',
    lineage: {workspaceId: evidence.workspaceId, learningId, recipeVersion: recipe.version,
      hypothesis: proposal.hypothesis, sourceHook: proposal.hook}});
  const approval = learning.approval ?? {approvedBy: z.string().trim().min(1).parse(approver), approvedAt: new Date().toISOString()};
  await immutable(doc(root, environment === 'simulation' ? 'simulation/recipes' : 'recipes', recipeKey(next.id, next.version)), next);
  const adopted = LearningSchema.parse({...learning, state: 'adopted', approval});
  await save(filename, adopted, true);
  return {recipe: next, learning: adopted};
}

export async function replicate(root: string, target: string, learningId: string, draftFile: string) {
  const source = await workspace(root);
  const learning = await readDoc(doc(root, 'learnings', learningId), LearningSchema);
  if (learning.state !== 'adopted' || learning.simulation) throw new Error('実運用で採用済みの学習が必要です');
  const recipe = await getRecipe(root, learning.proposedRecipeId, learning.proposedVersion);
  if (recipe.lineage?.learningId !== learningId) throw new Error('採用レシピと学習IDが一致しません');
  const {WorkspaceSchema} = await import('../workflow-schema');
  const draft = await readDoc(draftFile, WorkspaceSchema);
  if (path.resolve(root) === path.resolve(target) || draft.id === source.id) throw new Error('別アプリのワークスペースを指定してください');
  await setup(target, {...draft, channels: draft.channels.map((entry) => ({platform: entry.platform, enabled: false, approvalMode: 'manual'}))});
  const transferred = RecipeSchema.parse({...recipe, id: recipe.id + '-transfer', version: 1, hook: undefined, status: 'draft',
    lineage: {workspaceId: source.id, learningId, recipeVersion: recipe.version,
      hypothesis: recipe.lineage.hypothesis, sourceHook: recipe.lineage.sourceHook}});
  await immutable(doc(target, 'recipes', recipeKey(transferred.id, 1)), transferred);
  return transferred;
}
