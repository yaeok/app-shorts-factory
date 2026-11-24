import {z} from 'zod';
import {VideoProjectSchema} from './schema';

export const IdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, '小文字英数字とハイフンで指定してください');
const IsoDateTimeSchema = z.iso.datetime({offset: true});

export const WorkspaceSchema = z.object({
  kind: z.literal('workspace'),
  schemaVersion: z.literal(1),
  id: IdSchema,
  app: z.object({
    name: z.string().min(1),
    category: z.string().min(1),
    audience: z.string().min(1),
    problem: z.string().min(1),
    promise: z.string().min(1),
    proof: z.array(z.string().min(1)).default([]),
    prohibitedClaims: z.array(z.string().min(1)).default([]),
    destinationUrl: z.url().optional(),
  }),
  goals: z.object({
    primaryKpi: z.string().min(1),
    secondaryKpis: z.array(z.string().min(1)).default([]),
  }),
  channels: z.array(z.object({
    platform: z.enum(['youtube', 'instagram', 'tiktok']),
    accountId: z.string().min(1).optional(),
    enabled: z.boolean().default(false),
    approvalMode: z.enum(['manual', 'standing']).default('manual'),
  })).default([]),
  contentPillars: z.array(z.string().min(1)).min(1),
  cadence: z.object({postsPerWeek: z.number().int().min(1).max(21)}),
  creative: z.object({
    brand: VideoProjectSchema.shape.brand,
    logo: z.string().optional(),
    featureAsset: z.object({path: z.string().min(1), type: z.enum(['image', 'video'])}).optional(),
    cta: z.string().min(1).max(80),
    tone: z.string().min(1),
  }).optional(),
});

export const RecipeSchema = z.object({
  kind: z.literal('recipe'),
  schemaVersion: z.literal(1),
  id: IdSchema,
  version: z.number().int().min(1),
  mode: z.enum(['product-introduction', 'repeatable-series']),
  generator: z.enum(['manual', 'template', 'deterministic']),
  objective: z.string().min(1),
  sceneOrder: z.array(z.enum(['hook', 'problem', 'feature', 'demo', 'prompt', 'thinking', 'answer', 'proof', 'cta'])).min(2),
  variableCandidates: z.array(z.string().min(1)).default([]),
  fixedConditions: z.array(z.string().min(1)).default([]),
  status: z.enum(['draft', 'approved', 'retired']).default('draft'),
  hook: z.string().min(1).max(80).optional(),
  lineage: z.object({workspaceId: IdSchema, learningId: IdSchema, recipeVersion: z.number().int().positive(),
    hypothesis: z.string().optional(), sourceHook: z.string().optional()}).optional(),
});

export const VideoPlanSchema = z.object({
  kind: z.literal('video-plan'),
  schemaVersion: z.literal(1),
  id: IdSchema,
  workspaceId: IdSchema,
  recipeId: IdSchema,
  recipeVersion: z.number().int().min(1),
  hypothesis: z.string().min(1),
  changedVariable: z.string().min(1),
  fixedConditions: z.array(z.string().min(1)),
  seed: z.number().int().optional(),
  project: VideoProjectSchema,
  reproducibility: z.object({
    renderer: z.string(),
    assetHashes: z.record(z.string(), z.string()),
    recipeHash: z.string(),
    workspaceHash: z.string(),
    sourceHash: z.string().optional(),
  }).optional(),
  experiment: z.object({
    pairId: IdSchema,
    arm: z.enum(['control', 'variant']),
    proposalId: IdSchema,
    subjectHash: z.string(),
  }).optional(),
});

export const PublicationRequestSchema = z.object({
  kind: z.literal('publication-request'),
  schemaVersion: z.literal(1),
  idempotencyKey: z.string().min(8),
  planId: IdSchema,
  recipeId: IdSchema,
  recipeVersion: z.number().int().min(1),
  platform: z.literal('youtube'),
  accountId: z.string().min(1),
  renderPath: z.string().min(1),
  qaStatus: z.literal('passed'),
  approvalStatus: z.enum(['pending', 'approved']),
  privacyStatus: z.enum(['private', 'unlisted', 'public']).default('private'),
  metadata: z.object({title: z.string().min(1).max(100), description: z.string().max(5000), madeForKids: z.boolean()}),
  scheduledAt: IsoDateTimeSchema.optional(),
  mediaHash: z.string().optional(),
  planHash: z.string().optional(),
});

export const PublicationRecordSchema = z.object({
  kind: z.literal('publication-record'),
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  idempotencyKey: z.string().min(8),
  planId: IdSchema,
  platform: z.literal('youtube'),
  accountId: z.string().min(1),
  externalId: z.string().min(1),
  canonicalUrl: z.url(),
  privacyStatus: z.enum(['private', 'unlisted', 'public']),
  processingStatus: z.enum(['processing', 'succeeded', 'failed']),
  publishedAt: IsoDateTimeSchema,
  verifiedAt: IsoDateTimeSchema.optional(),
});

export const MetricValueSchema = z.object({
  state: z.enum(['measured', 'calculated', 'estimated', 'unavailable', 'pending']),
  value: z.number().nullable(),
  source: z.string().min(1),
}).superRefine((metric, context) => {
  if (['measured', 'calculated', 'estimated'].includes(metric.state) && metric.value === null) {
    context.addIssue({code: 'custom', message: `${metric.state}には数値が必要です`});
  }
  if (['unavailable', 'pending'].includes(metric.state) && metric.value !== null) {
    context.addIssue({code: 'custom', message: `${metric.state}の値はnullにしてください`});
  }
});

export const MetricSnapshotSchema = z.object({
  kind: z.literal('metric-snapshot'),
  schemaVersion: z.literal(1),
  publicationId: z.string().min(1),
  checkpoint: z.enum(['24h', '72h', '7d']),
  observedAt: IsoDateTimeSchema,
  metrics: z.record(z.string(), MetricValueSchema),
  environment: z.enum(['youtube', 'simulation']).optional(),
});

export const ReviewSchema = z.object({
  kind: z.literal('review'),
  schemaVersion: z.literal(1),
  id: IdSchema,
  workspaceId: IdSchema,
  recipeId: IdSchema,
  planIds: z.array(IdSchema).min(1),
  checkpoint: z.enum(['24h', '72h', '7d']),
  primaryKpi: z.string().min(1),
  evidenceSnapshotIds: z.array(z.string().min(1)).min(1),
  decision: z.enum(['hold', 'iterate', 'replicate', 'reject']),
  conclusion: z.string().min(1),
  nextChangedVariable: z.string().min(1).nullable(),
  reviewedAt: IsoDateTimeSchema,
});

export const LearningSchema = z.object({
  kind: z.literal('learning'),
  schemaVersion: z.literal(1),
  id: IdSchema,
  state: z.enum(['candidate', 'replicated', 'approved', 'adopted', 'retired']),
  claim: z.string().min(1),
  appliesWhen: z.array(z.string().min(1)).min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
  counterexampleIds: z.array(z.string().min(1)).default([]),
  proposedRecipeId: IdSchema,
  proposedVersion: z.number().int().min(1),
  approval: z.object({approvedBy: z.string().min(1), approvedAt: IsoDateTimeSchema}).optional(),
  hook: z.string().min(1).max(80).optional(),
  simulation: z.boolean().optional(),
}).superRefine((learning, context) => {
  if (['approved', 'adopted'].includes(learning.state) && !learning.approval) {
    context.addIssue({code: 'custom', message: 'approved/adoptedには承認記録が必要です'});
  }
});

export const WorkflowDocumentSchema = z.discriminatedUnion('kind', [
  WorkspaceSchema,
  RecipeSchema,
  VideoPlanSchema,
  PublicationRequestSchema,
  PublicationRecordSchema,
  MetricSnapshotSchema,
  ReviewSchema,
  LearningSchema,
]);

export type Workspace = z.infer<typeof WorkspaceSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
