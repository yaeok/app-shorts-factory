import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, expect, test, vi} from 'vitest';
import {review, makeProposal, importSnapshot, promote, replicate} from '../src/operations/learning';
import {approvedHash, mediaPath} from '../src/operations/media';
import {getRecipe, makePlans, setup, type Plan} from '../src/operations/planning';
import {approvePublication, publicationRecords, schedule, tick, type Request} from '../src/operations/publishing';
import {simulationAdapter} from '../src/operations/simulation';
import {YouTube, uploadTag} from '../src/operations/youtube';
import {aiProposal} from '../src/operations/ai';
import {onboard} from '../src/operations/onboarding';
import {digest, doc, fileHash, save, workspace} from '../src/operations/store';
import {WorkspaceSchema} from '../src/workflow-schema';
import brief from '../examples/field-notes/workspace.json';
import content from '../examples/field-notes/content.json';

const roots: string[] = [];
async function testDirectory() {
  const root = await mkdtemp(path.join(tmpdir(), 'app-shorts-test-'));
  roots.push(root);
  return root;
}
async function fixture() {
  const root = await testDirectory();
  await setup(root, WorkspaceSchema.parse(brief), content);
  return root;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});
});

// A test double for the separately tested render and human review boundary.
async function approvedFixture(root: string, plan: Plan) {
  const {mkdir} = await import('node:fs/promises');
  await mkdir(path.join(root, 'renders'), {recursive: true});
  const filename = mediaPath(root, plan.id);
  await writeFile(filename, plan.id);
  const mediaHash = await fileHash(filename);
  await save(doc(root, 'approvals', plan.id + '-' + mediaHash.slice(0, 16)), {
    mediaHash, planHash: digest(plan), reviewer: 'fixture', approvedAt: '2026-11-24T00:00:00Z',
  });
}

test('replays planning, waits for approval and time, learns from three comparable samples and isolates simulation', async () => {
  const root = await fixture();
  const recipe = await getRecipe(root, 'repeatable-quiz', 1);
  const proposal = await makeProposal(root, recipe.id, 1, '散歩の観察クイズ！', '利用場面を冒頭に出すと初見の視聴数が増える');
  const items = await makePlans(root, recipe, 3, 0, proposal);
  expect(items).toEqual(await makePlans(root, recipe, 3, 0, proposal));
  const scheduled = '2026-11-25T10:00:00Z';
  const before = new Date('2026-11-24T10:00:00Z');
  const now = new Date(scheduled);
  const due = simulationAdapter(root, now);
  const upload = vi.spyOn(due, 'upload');
  const requests = [];
  for (const plan of items) {
    await approvedFixture(root, plan);
    requests.push(await schedule(root, plan.id, 'simulation', scheduled, {privacyStatus: 'private', madeForKids: false}));
  }
  expect(await tick(root, due, now)).toHaveLength(0);
  for (const request of requests) await approvePublication(root, 'simulation', request.idempotencyKey, 'reviewer', 'simulation-channel');
  expect(await tick(root, due, before)).toHaveLength(0);
  const posted = await tick(root, due, now);
  expect(posted.every((row) => row.status === 'succeeded')).toBe(true);
  expect(posted).toHaveLength(6);
  await tick(root, due, now);
  expect(upload).toHaveBeenCalledTimes(6);
  expect(await publicationRecords(root, 'youtube')).toHaveLength(0);
  expect((await review(root, proposal, '72h', 'simulation')).decision).toBe('hold');
  const byPlan = new Map(items.map((plan) => [plan.id, plan]));
  for (const record of await publicationRecords(root, 'simulation')) {
    const value = byPlan.get(record.planId)?.experiment?.arm === 'variant' ? 130 : 100;
    await importSnapshot(root, 'simulation', {kind: 'metric-snapshot', schemaVersion: 1, publicationId: record.id,
      environment: 'simulation', observedAt: '2026-11-28T10:15:00Z', checkpoint: '72h',
      metrics: {views: {state: 'measured', value, source: 'simulation-fixture'}}});
  }
  const evaluation = await review(root, proposal, '72h', 'simulation');
  expect(evaluation.decision).toBe('replicate');
  if (!('learningId' in evaluation) || typeof evaluation.learningId !== 'string') throw new Error('learning missing');
  const preview = items.find((plan) => plan.experiment?.arm === 'variant')!;
  const next = await promote(root, 'simulation', evaluation.learningId, 'reviewer', preview.id);
  expect(next.recipe.version).toBe(2);
  expect(next.recipe.hook).toBe(proposal.hook);
  await expect(getRecipe(root, recipe.id, 2)).rejects.toThrow();
  await expect(replicate(root, path.join(root, 'other'), evaluation.learningId, 'unused')).rejects.toThrow();
});

test('an ambiguous transfer is not retried and changed bytes invalidate review', async () => {
  const root = await fixture();
  const [plan] = await makePlans(root, await getRecipe(root, 'product-introduction', 1), 1, 0);
  if (!plan) throw new Error('fixture missing');
  await approvedFixture(root, plan);
  const scheduled = '2026-11-25T10:00:00Z';
  const now = new Date(scheduled);
  const request = await schedule(root, plan.id, 'simulation', scheduled, {privacyStatus: 'private', madeForKids: false});
  await approvePublication(root, 'simulation', request.idempotencyKey, 'reviewer', 'simulation-channel');
  const due = simulationAdapter(root, now);
  const accepted = due.upload;
  let external = '';
  const upload = vi.spyOn(due, 'upload').mockImplementation(async (...args) => {
    external = await accepted(...args);
    throw new Error('response timed out');
  });
  expect((await tick(root, due, now))[0]?.status).toBe('error');
  expect((await tick(root, due, now))[0]?.status).toBe('error');
  expect(upload).toHaveBeenCalledTimes(1);
  expect((await tick(root, due, now, {id: request.idempotencyKey, video: external}))[0]?.status).toBe('succeeded');
  await writeFile(mediaPath(root, plan.id), 'different bytes');
  await expect(approvedHash(root, plan)).rejects.toThrow();
});

test('YouTube adapter sends approved settings and verifies channel and marker', async () => {
  const root = await fixture();
  const [plan] = await makePlans(root, await getRecipe(root, 'product-introduction', 1), 1, 0);
  if (!plan) throw new Error('fixture missing');
  await approvedFixture(root, plan);
  const request: Request = {...await schedule(root, plan.id, 'simulation', '2026-11-25T10:00:00Z', {privacyStatus: 'private', madeForKids: false}),
    accountId: 'channel-1'};
  const mock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, {headers: {location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test'}}))
    .mockResolvedValueOnce(Response.json({id: 'test123'}))
    .mockResolvedValueOnce(Response.json({items: [{id: 'test123', snippet: {channelId: 'channel-1',
      tags: [uploadTag(request)], publishedAt: '2026-11-25T10:00:00Z'}, status: {privacyStatus: 'private', selfDeclaredMadeForKids: false},
      processingDetails: {processingStatus: 'succeeded'}, statistics: {viewCount: '30'}}]}));
  vi.stubGlobal('fetch', mock);
  const youtube = new YouTube('test-token');
  expect(await youtube.upload(request, mediaPath(root, plan.id))).toBe('test123');
  expect(JSON.parse(String(mock.mock.calls[0]?.[1]?.body)).status).toEqual({privacyStatus: 'private', selfDeclaredMadeForKids: false});
  expect((await youtube.verify('test123', request)).counters).toEqual({views: 30});
});

test('AI proposal caches the validated response and returns the same plan inputs', async () => {
  const root = await fixture();
  vi.stubEnv('OPENAI_API_KEY', 'local-test-key');
  const mock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({id: 'response_test', model: 'model-test',
    status: 'completed', output: [{content: [{type: 'output_text',
      text: JSON.stringify({hook: '散歩をしながら1問', hypothesis: '視聴者が用途を早く理解し、再生が増える'})}]}]}));
  vi.stubGlobal('fetch', mock);
  const proposal = await aiProposal(root, 'repeatable-quiz', 1, 'model-test');
  expect(await aiProposal(root, 'repeatable-quiz', 1, 'model-test')).toEqual(proposal);
  expect(proposal.provenance?.responseId).toBe('response_test');
  expect(mock).toHaveBeenCalledTimes(1);
  const sent = JSON.parse(String(mock.mock.calls[0]?.[1]?.body));
  expect(sent.store).toBe(false);
  expect(sent.text.format.type).toBe('json_schema');
});

test('setup installs sample inputs once and reports the next action from recorded artifacts', async () => {
  const root = await testDirectory();
  const lines: string[] = [];
  const print = (message: string) => lines.push(message);
  await onboard(root, {demo: true}, print);
  expect(lines.join('\n')).toContain(' --recipe repeatable-quiz');
  const filename = path.join(root, 'workspace.json');
  const original = await fileHash(filename);
  await onboard(root, {demo: true}, print);
  expect(await fileHash(filename)).toBe(original);
  const [plan] = await makePlans(root, await getRecipe(root, 'repeatable-quiz', 1), 1, 0);
  if (!plan) throw new Error('fixture missing');
  lines.length = 0;
  await onboard(root, {status: true}, print);
  expect(lines.find((line) => line.startsWith('次に実行'))).toContain('render-batch');
  await approvedFixture(root, plan);
  lines.length = 0;
  await onboard(root, {status: true}, print);
  expect(lines.find((line) => line.startsWith('次に実行'))).toContain(' qa ');
  expect(await publicationRecords(root, 'youtube')).toEqual([]);
});

test('setup takes app inputs once and tells series creators which content file is missing', async () => {
  const root = await testDirectory();
  const lines: string[] = [];
  const answers = ['my-app', 'おでかけノート', '', '週末に外出する人', '予定を忘れる', '予定を一覧で確認', '', '', 'views', '', '', '3'];
  const ask = vi.fn(async (_prompt: string, fallback?: string) => answers.shift() || fallback || '');
  await onboard(root, {series: true}, (line) => lines.push(line), ask);
  expect((await workspace(root)).app.name).toBe('おでかけノート');
  expect(lines.find((line) => line.startsWith('次に準備'))).toContain('content.json');
  expect(lines.some((line) => line.startsWith('次に実行'))).toBe(false);
  await onboard(root, {status: true, series: true}, () => {}, async () => { throw new Error('既存の設定を再入力させない'); });
});
