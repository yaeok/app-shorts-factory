import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import type {VideoProject} from './schema';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const renderProject = async (project: VideoProject, assetsDirectory: string, output: string) => {
  await mkdir(path.dirname(output), {recursive: true});
  const serveUrl = await bundle({entryPoint: path.join(root, 'src/remotion/index.ts'), publicDir: path.resolve(assetsDirectory)});
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE ?? (existsSync(systemChrome) ? systemChrome : undefined);
  const inputProps = {project};
  const composition = await selectComposition({serveUrl, id: 'AppShort', inputProps, timeoutInMilliseconds: 300_000, browserExecutable});
  await renderMedia({composition, serveUrl, codec: 'h264', audioCodec: 'aac', outputLocation: path.resolve(output), inputProps, timeoutInMilliseconds: 300_000, browserExecutable});
  return path.resolve(output);
};
