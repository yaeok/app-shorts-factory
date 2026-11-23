import {describe, expect, it} from 'vitest';
import {VideoProjectSchema, durationInFrames} from '../src/schema';

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
});
