#!/usr/bin/env node
import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Command} from 'commander';
import {loadProject, validateAssets} from './project';
import {WorkflowDocumentSchema} from './workflow-schema';
import {operations} from './operations/commands';

const program = new Command().name('app-shorts').description('任意のアプリ向け縦型ショート動画を生成します');

program.command('init')
  .argument('[directory]', 'プロジェクト作成先', 'short-project')
  .action(async (directory) => {
    const target = path.resolve(directory);
    await mkdir(path.join(target, 'assets'), {recursive: true});
    const example = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../examples/basic/project.json');
    await cp(example, path.join(target, 'project.json'));
    await writeFile(path.join(target, 'README.md'), '# Short project\n\n`project.json`を編集し、素材を`assets/`へ置いてください。\n');
    console.log(`作成しました: ${target}`);
  });

program.command('workflow-init')
  .description('アプリ単位のShorts運用ワークスペースを初期化します')
  .argument('[directory]', 'ワークスペース作成先', 'shorts-workspace')
  .action(async (directory) => {
    const target = path.resolve(directory);
    const example = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../examples/workspace');
    await mkdir(target, {recursive: true});
    await cp(example, target, {recursive: true, errorOnExist: true});
    for (const child of ['assets', 'plans', 'renders', 'publish-queue', 'ledger', 'metrics', 'reviews', 'learnings']) {
      await mkdir(path.join(target, child), {recursive: true});
    }
    console.log(`運用ワークスペースを作成しました: ${target}`);
  });

program.command('workflow-validate')
  .description('workspace・recipe・投稿要求・指標・学習ドキュメントを検証します')
  .argument('<document>')
  .action(async (filename) => {
    const parsed = WorkflowDocumentSchema.parse(JSON.parse(await readFile(path.resolve(filename), 'utf8')));
    console.log(`${parsed.kind} を検証しました: ${path.resolve(filename)}`);
  });

program.command('validate')
  .argument('<project>')
  .option('-a, --assets <directory>', '素材ディレクトリ', 'assets')
  .action(async (filename, options) => {
    const project = await loadProject(path.resolve(filename));
    await validateAssets(project, path.resolve(options.assets));
    console.log(`${project.app.name}: ${project.video.scenes.length}シーンを検証しました`);
  });

program.command('render')
  .argument('<project>')
  .option('-a, --assets <directory>', '素材ディレクトリ', 'assets')
  .option('-o, --output <filename>', '出力MP4', 'output/app-short.mp4')
  .action(async (filename, options) => {
    const project = await loadProject(path.resolve(filename));
    await validateAssets(project, path.resolve(options.assets));
    const {renderProject} = await import('./render');
    console.log(`生成しました: ${await renderProject(project, options.assets, options.output)}`);
  });

program.command('still')
  .description('目視QA用の静止画を生成します')
  .argument('<project>')
  .option('-a, --assets <directory>', '素材ディレクトリ', 'assets')
  .option('-o, --output <filename>', '出力PNG', 'output/app-short.png')
  .option('-f, --frame <number>', '書き出すフレーム', '180')
  .action(async (filename, options) => {
    const project = await loadProject(path.resolve(filename));
    await validateAssets(project, path.resolve(options.assets));
    const frame = Number.parseInt(options.frame, 10);
    if (!Number.isInteger(frame) || frame < 0 || frame >= project.video.scenes.reduce((sum, scene) => sum + Math.round(scene.durationSeconds * project.video.fps), 0)) {
      throw new Error('frameは動画内の0以上の整数を指定してください');
    }
    const {renderProjectStill} = await import('./render');
    console.log(`静止画を生成しました: ${await renderProjectStill(project, options.assets, options.output, frame)}`);
  });

operations(program);
try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
