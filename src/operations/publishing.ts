import path from 'node:path';
import {z} from 'zod';
import {MetricSnapshotSchema, MetricValueSchema, PublicationRecordSchema, PublicationRequestSchema} from '../workflow-schema';
import {approvedHash, mediaPath} from './media';
import {loadPlan} from './planning';
import {digest, doc, immutable, listDocs, optional, readDoc, save, workspace} from './store';

export type Request = z.infer<typeof PublicationRequestSchema>;
export type Publication = z.infer<typeof PublicationRecordSchema>;
export type Environment = 'youtube' | 'simulation';
export type VerifiedVideo = Pick<Publication, 'externalId' | 'privacyStatus' | 'processingStatus' | 'publishedAt'> & {
  counters: Record<string, number>; madeForKids?: boolean;
};
export interface UploadAdapter {
  environment: Environment;
  channel(): Promise<{id: string; title: string}>;
  upload(request: Request, filename: string): Promise<string>;
  verify(externalId: string, request: Request): Promise<VerifiedVideo>;
}
const Approval = z.object({requestHash: z.string(), approver: z.string().min(1), approvedAt: z.iso.datetime()});
const Attempt = z.object({requestHash: z.string(), attemptedAt: z.iso.datetime()});
const Handle = z.object({requestHash: z.string(), externalId: z.string().min(1)});
const folder = (environment: Environment, name: string) => environment === 'youtube' ? name : 'simulation/' + name;
export const publicationRecords = (root: string, environment: Environment) => listDocs(root, folder(environment, 'ledger'), PublicationRecordSchema);
export const checkpoints = {'24h': 24, '72h': 72, '7d': 168} as const;
export type Checkpoint = keyof typeof checkpoints;
export const metricsDirectory = (environment: Environment) => folder(environment, 'metrics');
export const checkpointId = (publicationId: string, checkpoint: Checkpoint) => publicationId + '-' + checkpoint;
const requestFile = (root: string, environment: Environment, id: string) => doc(root, folder(environment, 'publish-queue'), id);

export async function schedule(root: string, planId: string, environment: Environment, when: string,
  settings: {privacyStatus: Request['privacyStatus']; madeForKids: boolean; title?: string; description?: string}) {
  const input = await workspace(root);
  const plan = await loadPlan(root, planId);
  if (plan.workspaceId !== input.id) throw new Error('企画のワークスペースが異なります');
  const scheduledAt = z.iso.datetime({offset: true}).parse(when);
  const channel = await targetChannel(root, environment);
  const idempotencyKey = 'post-' + digest([environment, input.id, channel, plan.project, plan.reproducibility?.assetHashes]).slice(0, 32);
  const request = PublicationRequestSchema.parse({
    kind: 'publication-request', schemaVersion: 1, idempotencyKey, planId, recipeId: plan.recipeId, recipeVersion: plan.recipeVersion,
    platform: 'youtube', accountId: channel, renderPath: path.relative(root, mediaPath(root, planId)), qaStatus: 'passed',
    approvalStatus: 'pending', scheduledAt: new Date(scheduledAt).toISOString(), planHash: digest(plan),
    mediaHash: await approvedHash(root, plan), privacyStatus: settings.privacyStatus,
    metadata: {title: settings.title ?? plan.project.video.title, description: settings.description ?? input.app.destinationUrl ?? '', madeForKids: settings.madeForKids},
  });
  await immutable(requestFile(root, environment, idempotencyKey), request);
  return request;
}

export async function approvePublication(root: string, environment: Environment, id: string, approver: string, confirmedChannel: string) {
  const request = await readDoc(requestFile(root, environment, id), PublicationRequestSchema);
  if (confirmedChannel !== request.accountId) throw new Error('承認したチャンネルが投稿先と一致しません');
  const filename = doc(root, folder(environment, 'publication-approvals'), id);
  const prior = await optional(() => readDoc(filename, Approval));
  const requestHash = digest(request);
  if (prior?.requestHash === requestHash) return prior;
  const approval = Approval.parse({requestHash, approver: approver.trim(), approvedAt: new Date().toISOString()});
  await immutable(filename, approval);
  return approval;
}

async function targetChannel(root: string, environment: Environment) {
  if (environment === 'simulation') return 'simulation-channel';
  const channel = (await workspace(root)).channels.find((entry) => entry.platform === 'youtube' && entry.enabled);
  if (!channel?.accountId) throw new Error('workspace.jsonでYouTubeチャンネルIDとenabledを設定してください');
  return channel.accountId;
}

export async function tick(root: string, adapter: UploadAdapter, now = new Date(), reconcile?: {id: string; video: string}) {
  const environment = adapter.environment;
  const result = [];
  const requests = await listDocs(root, folder(environment, 'publish-queue'), PublicationRequestSchema);
  if (reconcile && !requests.some((item) => item.idempotencyKey === reconcile.id)) throw new Error('対象の投稿予定がありません');
  if (!requests.length) return [];
  const channel = await targetChannel(root, environment);
  if ((await adapter.channel()).id !== channel) throw new Error('OAuthのチャンネルとworkspace.jsonの投稿先が異なります');
  for (const request of requests) {
    const id = request.idempotencyKey;
    if (reconcile && reconcile.id !== id) continue;
    if (request.accountId !== channel || !request.scheduledAt || Date.parse(request.scheduledAt) > now.getTime()) continue;
    const approval = await optional(() => readDoc(doc(root, folder(environment, 'publication-approvals'), id), Approval));
    if (approval?.requestHash !== digest(request)) continue;
    const attemptFile = doc(root, folder(environment, 'attempts'), id);
    const handleFile = doc(root, folder(environment, 'handles'), id);
    const ledgerFile = doc(root, folder(environment, 'ledger'), id);
    const requestHash = digest(request);
    try {
      const previous = await optional(() => readDoc(ledgerFile, PublicationRecordSchema));
      if (!reconcile && previous?.processingStatus === 'succeeded' &&
        now.getTime() - Date.parse(previous.publishedAt) >= (checkpoints['7d'] + 2) * 3_600_000) continue;
      let handle = await optional(() => readDoc(handleFile, Handle));
      const attempt = await optional(() => readDoc(attemptFile, Attempt));
      if (handle && handle.requestHash !== requestHash) throw new Error('投稿台帳と承認済みリクエストが一致しません');
      if (reconcile) {
        if (attempt?.requestHash !== requestHash) throw new Error('照合可能なアップロード試行がありません');
        if (handle && handle.externalId !== reconcile.video) throw new Error('既存の動画IDとは別の動画です');
        await adapter.verify(reconcile.video, request);
        handle = {requestHash, externalId: reconcile.video};
        await immutable(handleFile, handle);
      }
      if (!handle) {
        if (attempt) throw new Error('送信結果が未確認です。YouTube Studioで確認し、reconcileで照合してください');
        if (environment === 'youtube' && request.privacyStatus !== 'private') {
          const history = await publicationRecords(root, environment);
          if (!history.some((record) => record.accountId === channel && record.privacyStatus === 'private' && record.processingStatus === 'succeeded')) {
            throw new Error('このチャンネルに検証済みの非公開アップロードが必要です');
          }
        }
        const plan = await loadPlan(root, request.planId);
        if (request.planHash !== digest(plan) || request.mediaHash !== await approvedHash(root, plan)) throw new Error('承認後に入力が変わりました');
        // Exclusive claim before the network call. Ambiguous failures never trigger a new upload.
        await save(attemptFile, {requestHash, attemptedAt: now.toISOString()});
        const externalId = await adapter.upload(request, mediaPath(root, plan.id));
        handle = {requestHash, externalId};
        await immutable(handleFile, handle);
      }
      const verified = await adapter.verify(handle.externalId, request);
      if (verified.privacyStatus !== request.privacyStatus) throw new Error('YouTube側の公開範囲が承認内容と一致しません');
      if (verified.madeForKids !== request.metadata.madeForKids) throw new Error('YouTube側の子ども向け設定を確認してください');
      const publication = PublicationRecordSchema.parse({
        kind: 'publication-record', schemaVersion: 1, id, idempotencyKey: id, planId: request.planId, platform: 'youtube',
        accountId: channel, externalId: handle.externalId, canonicalUrl: environment === 'youtube'
          ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(handle.externalId) : 'https://example.invalid/video/' + encodeURIComponent(handle.externalId),
        privacyStatus: verified.privacyStatus, processingStatus: verified.processingStatus, publishedAt: previous?.publishedAt ?? verified.publishedAt,
        verifiedAt: now.toISOString(),
      });
      await save(ledgerFile, publication, true);
      if (verified.processingStatus === 'succeeded') await collectCounters(root, environment, publication, verified.counters, now);
      result.push({id, status: verified.processingStatus, publication});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await save(doc(root, folder(environment, 'publication-errors'), id), {id, message, failedAt: now.toISOString()}, true);
      result.push({id, status: 'error', message});
    }
  }
  return result;
}

async function collectCounters(root: string, environment: Environment, publication: Publication, counters: Record<string, number>, now: Date) {
  if (environment === 'simulation') return;
  const primary = (await workspace(root)).goals.primaryKpi;
  const age = (now.getTime() - Date.parse(publication.publishedAt)) / 3_600_000;
  // Counters are lifetime values. Capture only near the requested checkpoint.
  for (const [checkpoint, hours] of Object.entries(checkpoints) as [Checkpoint, number][]) {
    if (age < hours || age >= hours + 2) continue;
    const filename = doc(root, metricsDirectory(environment), checkpointId(publication.id, checkpoint));
    if (await optional(() => readDoc(filename, MetricSnapshotSchema))) continue;
    const metrics: Record<string, z.infer<typeof MetricValueSchema>> = Object.fromEntries(
      Object.entries(counters).map(([key, value]) => [key, {state: 'measured', value, source: 'youtube-data-api:videos.list'}]));
    if (!Object.hasOwn(metrics, primary)) metrics[primary] = {state: 'unavailable', value: null, source: 'requires-attributed-data'};
    await immutable(filename, MetricSnapshotSchema.parse({kind: 'metric-snapshot', schemaVersion: 1, publicationId: publication.id,
      checkpoint, environment, observedAt: now.toISOString(), metrics}));
  }
}

export async function publicationRequests(root: string, environment: Environment) {
  const requests = await listDocs(root, folder(environment, 'publish-queue'), PublicationRequestSchema);
  return Promise.all(requests.map(async (request) => {
    const approval = await optional(() => readDoc(doc(root, folder(environment, 'publication-approvals'), request.idempotencyKey), Approval));
    return {...request, approvalStatus: approval?.requestHash === digest(request) ? 'approved' as const : 'pending' as const};
  }));
}
export const publicationErrors = (root: string, environment: Environment) => listDocs(root, folder(environment, 'publication-errors'),
  z.object({id: z.string(), message: z.string(), failedAt: z.iso.datetime()}));
