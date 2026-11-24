import {mkdir, link, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {z} from 'zod';
import {durationInFrames} from '../schema';
import {validateAssets} from '../project';
import {digest, doc, fileHash, immutable, isMissing, optional, readDoc} from './store';
import {rendererFingerprint, type Plan} from './planning';

export const mediaPath = (root: string, id: string) => path.join(root, 'renders', id + '.mp4');
export const ReviewMediaSchema = z.object({
  planHash: z.string(), mediaHash: z.string(), reviewer: z.string().min(1), approvedAt: z.iso.datetime(),
});

export async function renderPlan(root: string, plan: Plan) {
  const output = mediaPath(root, plan.id);
  const existing = await optional(() => fileHash(output));
  if (existing) return output;
  const assets = path.join(root, plan.reproducibility ? 'inputs' : 'assets', ...(plan.reproducibility ? [plan.id] : []));
  if (plan.reproducibility) {
    if (plan.reproducibility.renderer !== await rendererFingerprint()) throw new Error('企画作成時とレンダラーが異なります。元の版でレンダリングしてください');
    for (const [filename, expected] of Object.entries(plan.reproducibility.assetHashes)) {
      if (await fileHash(path.join(assets, filename)) !== expected) throw new Error('企画作成時と素材が異なります: ' + filename);
    }
  }
  await validateAssets(plan.project, assets);
  await mkdir(path.dirname(output), {recursive: true});
  const temporary = output + '.' + randomUUID() + '.mp4';
  try {
    const {renderProject} = await import('../render');
    await renderProject(plan.project, assets, temporary);
    await link(temporary, output);
    return output;
  } finally {
    await unlink(temporary).catch((error) => { if (!isMissing(error)) throw error; });
  }
}

export const QASchema = z.object({
  planHash: z.string(), mediaHash: z.string(), width: z.number(), height: z.number(), fps: z.number(),
  seconds: z.number(), audio: z.string().nullable(), frames: z.array(z.string()).length(3),
});

export async function qa(root: string, plan: Plan) {
  const input = mediaPath(root, plan.id);
  const mediaHash = await fileHash(input);
  const {getVideoMetadata, RenderInternals} = await import('@remotion/renderer');
  const info = await getVideoMetadata(input);
  const {width, height, fps, durationInSeconds: seconds, audioCodec: audio} = info;
  const expected = plan.project.video;
  const frameCount = durationInFrames(plan.project);
  if (width !== expected.width || height !== expected.height || fps !== expected.fps ||
      seconds === null || Math.abs(seconds - frameCount / fps) > 1 / fps || info.codec !== 'h264') throw new Error('MP4の解像度・fps・尺・コーデックを確認してください');
  const target = path.join(root, 'qa', plan.id + '-' + mediaHash.slice(0, 16));
  await mkdir(target, {recursive: true});
  const first = Math.round(expected.scenes[0]!.durationSeconds * fps);
  const last = Math.round(expected.scenes.at(-1)!.durationSeconds * fps);
  const frames: string[] = [];
  for (const [name, frame] of [['hook', Math.floor(first / 2)], ['middle', Math.floor(frameCount / 2)], ['cta', frameCount - Math.ceil(last / 2)]] as const) {
    const output = path.join(target, name + '.png');
    // Use the renderer's bundled ffmpeg with the correct library path.
    await RenderInternals.callFf({
      bin: 'ffmpeg', args: ['-loglevel', 'error', '-ss', String(frame / fps), '-i', input, '-frames:v', '1', '-y', output],
      indent: false, logLevel: 'error', binariesDirectory: null, cancelSignal: undefined,
    });
    await fileHash(output);
    frames.push(path.relative(root, output));
  }
  if (await fileHash(input) !== mediaHash) throw new Error('QA中に動画が変わりました');
  const report = QASchema.parse({planHash: digest(plan), mediaHash, width, height, fps, seconds, audio, frames});
  await immutable(doc(root, 'qa', plan.id + '-' + mediaHash.slice(0, 16)), report);
  return report;
}

export async function approveMedia(root: string, plan: Plan, reviewer: string) {
  const mediaHash = await fileHash(mediaPath(root, plan.id));
  const key = plan.id + '-' + mediaHash.slice(0, 16);
  const report = await readDoc(doc(root, 'qa', key), QASchema);
  if (report.mediaHash !== mediaHash || report.planHash !== digest(plan)) throw new Error('現在のメディアとQA記録が一致しません');
  await Promise.all(report.frames.map((filename) => fileHash(path.join(root, filename))));
  const filename = doc(root, 'approvals', key);
  const prior = await optional(() => readDoc(filename, ReviewMediaSchema));
  if (prior) return prior;
  const record = ReviewMediaSchema.parse({planHash: report.planHash, mediaHash, reviewer: reviewer.trim(), approvedAt: new Date().toISOString()});
  await immutable(filename, record);
  return record;
}

export async function approvedHash(root: string, plan: Plan) {
  const mediaHash = await fileHash(mediaPath(root, plan.id));
  const action = await readDoc(doc(root, 'approvals', plan.id + '-' + mediaHash.slice(0, 16)), ReviewMediaSchema);
  if (action.planHash !== digest(plan) || action.mediaHash !== mediaHash) throw new Error('承認後に企画または動画が変わりました');
  return mediaHash;
}
