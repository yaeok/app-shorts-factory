import {z} from 'zod';

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, '6桁のHEXカラーを指定してください');

export const SceneTypeSchema = z.enum(['hook', 'problem', 'feature', 'demo', 'prompt', 'thinking', 'answer', 'proof', 'cta']);

export const SceneSchema = z.object({
  type: SceneTypeSchema,
  durationSeconds: z.number().min(0.5).max(15),
  headline: z.string().min(1).max(80),
  body: z.string().max(180).optional(),
  eyebrow: z.string().max(30).optional(),
  asset: z.string().min(1).optional(),
  assetType: z.enum(['image', 'video']).default('image'),
  layout: z.enum(['center', 'media-top', 'media-bottom']).default('center'),
  backgroundColor: HexColorSchema.optional(),
});

export const VideoProjectSchema = z.object({
  schemaVersion: z.literal(1),
  app: z.object({
    name: z.string().min(1).max(40),
    category: z.string().min(1).max(40),
    audience: z.string().min(1).max(100),
    valueProposition: z.string().min(1).max(180),
    logo: z.string().min(1).optional(),
    storeUrl: z.url().optional(),
  }),
  brand: z.object({
    primaryColor: HexColorSchema,
    secondaryColor: HexColorSchema,
    backgroundColor: HexColorSchema,
    textColor: HexColorSchema,
    fontFamily: z.string().min(1).default('sans-serif'),
  }),
  video: z.object({
    title: z.string().min(1).max(100),
    fps: z.literal(30).default(30),
    width: z.literal(1080).default(1080),
    height: z.literal(1920).default(1920),
    scenes: z.array(SceneSchema).min(2).max(12),
  }),
});

export type VideoProject = z.infer<typeof VideoProjectSchema>;
export type Scene = z.infer<typeof SceneSchema>;

export const durationInFrames = (project: VideoProject) =>
  project.video.scenes.reduce((sum, scene) => sum + Math.round(scene.durationSeconds * project.video.fps), 0);
