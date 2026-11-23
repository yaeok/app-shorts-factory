import {access, readFile} from 'node:fs/promises';
import path from 'node:path';
import {VideoProjectSchema, type VideoProject} from './schema';

export const loadProject = async (filename: string): Promise<VideoProject> =>
  VideoProjectSchema.parse(JSON.parse(await readFile(filename, 'utf8')));

export const validateAssets = async (project: VideoProject, assetsDirectory: string) => {
  const assets = [project.app.logo, ...project.video.scenes.map((scene) => scene.asset)].filter((value): value is string => Boolean(value));
  await Promise.all(assets.map(async (asset) => {
    const resolved = path.resolve(assetsDirectory, asset);
    const relative = path.relative(path.resolve(assetsDirectory), resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`素材はassetsディレクトリ内を指定してください: ${asset}`);
    await access(resolved);
  }));
};
