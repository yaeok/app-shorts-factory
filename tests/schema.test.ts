import {describe, expect, it} from 'vitest';
import {VideoProjectSchema, durationInFrames} from '../src/schema';
import {
  LearningSchema,
  MetricSnapshotSchema,
  PublicationRecordSchema,
  PublicationRequestSchema,
  RecipeSchema,
  ReviewSchema,
  VideoPlanSchema,
  WorkspaceSchema,
} from '../src/workflow-schema';

describe('VideoProjectSchema', () => {
  it('任意アプリの動画構成を検証する', () => {
    const project = VideoProjectSchema.parse({
      schemaVersion: 1,
      app: {name: 'App', category: 'Utility', audience: '利用者', valueProposition: '価値'},
      brand: {primaryColor: '#112233', secondaryColor: '#445566', backgroundColor: '#000000', textColor: '#FFFFFF'},
      video: {title: '紹介', scenes: [
        {type: 'hook', durationSeconds: 2, headline: 'Hook'},
        {type: 'cta', durationSeconds: 3, headline: 'CTA'},
      ]},
    });
    expect(durationInFrames(project)).toBe(150);
  });

  it('不正な色を拒否する', () => {
    const result = VideoProjectSchema.safeParse({schemaVersion: 1, app: {}, brand: {primaryColor: 'red'}, video: {}});
    expect(result.success).toBe(false);
  });

  it('反復クイズと画面録画シーンを受け付ける', () => {
    const project = VideoProjectSchema.parse({
      schemaVersion: 1,
      app: {name: 'Quiz', category: 'Education', audience: 'Learners', valueProposition: 'Practice'},
      brand: {primaryColor: '#112233', secondaryColor: '#445566', backgroundColor: '#000000', textColor: '#FFFFFF'},
      video: {title: 'Daily quiz', scenes: [
        {type: 'prompt', durationSeconds: 3, headline: '1 + 1 = ?'},
        {type: 'thinking', durationSeconds: 2, headline: '考えてみよう'},
        {type: 'answer', durationSeconds: 2, headline: '答えは2'},
        {type: 'demo', durationSeconds: 3, headline: 'アプリで練習', asset: 'demo.mp4', assetType: 'video'},
      ]},
    });
    expect(project.video.scenes[3]?.assetType).toBe('video');
  });
});

describe('workflow schemas', () => {
  it('アプリ運用ワークスペースと反復レシピを検証する', () => {
    const workspace = WorkspaceSchema.parse({
      kind: 'workspace', schemaVersion: 1, id: 'my-app',
      app: {name: 'My App', category: 'Utility', audience: 'Parents', problem: 'Problem', promise: 'Promise'},
      goals: {primaryKpi: 'first_time_downloads'},
      channels: [{platform: 'youtube'}], contentPillars: ['quiz'], cadence: {postsPerWeek: 3},
    });
    const recipe = RecipeSchema.parse({
      kind: 'recipe', schemaVersion: 1, id: 'daily-quiz', version: 1,
      mode: 'repeatable-series', generator: 'deterministic', objective: 'Daily verified quiz',
      sceneOrder: ['hook', 'prompt', 'answer', 'cta'],
    });
    expect(workspace.channels[0]?.approvalMode).toBe('manual');
    expect(recipe.status).toBe('draft');
  });

  it('pending指標をゼロとして扱わない', () => {
    expect(MetricSnapshotSchema.safeParse({
      kind: 'metric-snapshot', schemaVersion: 1, publicationId: 'post-1', checkpoint: '24h',
      observedAt: '2026-11-24T20:00:00+09:00', metrics: {downloads: {state: 'pending', value: 0, source: 'store'}},
    }).success).toBe(false);
  });

  it('承認済み学習に承認記録を要求する', () => {
    expect(LearningSchema.safeParse({
      kind: 'learning', schemaVersion: 1, id: 'hook-learning', state: 'approved', claim: 'Hook improves conversion',
      appliesWhen: ['quiz'], evidenceIds: ['exp-1', 'exp-2'], proposedRecipeId: 'daily-quiz', proposedVersion: 2,
    }).success).toBe(false);
  });

  it('ヒアリングからPDCA候補までを追跡する', () => {
    const plan = VideoPlanSchema.parse({
      kind: 'video-plan', schemaVersion: 1, id: 'plan-001', workspaceId: 'my-app',
      recipeId: 'product-introduction', recipeVersion: 1,
      hypothesis: '問題訴求でプロフィール遷移が増える', changedVariable: 'hook', fixedConditions: ['cta', 'duration'],
      project: {
        schemaVersion: 1,
        app: {name: 'My App', category: 'Utility', audience: 'Parents', valueProposition: 'Promise'},
        brand: {primaryColor: '#112233', secondaryColor: '#445566', backgroundColor: '#FFFFFF', textColor: '#111111'},
        video: {title: 'Intro', scenes: [
          {type: 'hook', durationSeconds: 3, headline: 'Problem'},
          {type: 'cta', durationSeconds: 3, headline: 'Try it'},
        ]},
      },
    });
    const request = PublicationRequestSchema.parse({
      kind: 'publication-request', schemaVersion: 1, idempotencyKey: 'my-app-plan-001-youtube',
      planId: plan.id, recipeId: plan.recipeId, recipeVersion: 1, platform: 'youtube', accountId: 'channel-1',
      renderPath: 'renders/plan-001.mp4', qaStatus: 'passed', approvalStatus: 'pending', privacyStatus: 'unlisted',
      metadata: {title: 'My App #Shorts', description: 'Try My App', madeForKids: false},
    });
    const publication = PublicationRecordSchema.parse({
      kind: 'publication-record', schemaVersion: 1, id: 'youtube-video-1', idempotencyKey: request.idempotencyKey,
      planId: plan.id, platform: 'youtube', accountId: 'channel-1', externalId: 'video-1',
      canonicalUrl: 'https://youtube.com/shorts/video-1', privacyStatus: 'unlisted', processingStatus: 'succeeded',
      publishedAt: '2026-11-24T20:00:00+09:00',
    });
    const snapshot = MetricSnapshotSchema.parse({
      kind: 'metric-snapshot', schemaVersion: 1, publicationId: publication.id, checkpoint: '24h',
      observedAt: '2026-11-25T20:00:00+09:00', metrics: {
        views: {state: 'measured', value: 500, source: 'youtube'},
        first_time_downloads: {state: 'pending', value: null, source: 'store'},
      },
    });
    const review = ReviewSchema.parse({
      kind: 'review', schemaVersion: 1, id: 'review-001', workspaceId: 'my-app', recipeId: plan.recipeId,
      planIds: [plan.id], checkpoint: '24h', primaryKpi: 'first_time_downloads', evidenceSnapshotIds: ['snapshot-001'],
      decision: 'hold', conclusion: '主要KPIがpendingのため勝敗を決めない', nextChangedVariable: null,
      reviewedAt: '2026-11-25T20:05:00+09:00',
    });
    expect(snapshot.metrics.first_time_downloads?.value).toBeNull();
    expect(review.decision).toBe('hold');
  });
});
