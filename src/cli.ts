#!/usr/bin/env node
import {cp, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Command} from 'commander';
import {loadProject, validateAssets} from './project';
import {renderProject} from './render';

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
    console.log(`生成しました: ${await renderProject(project, options.assets, options.output)}`);
  });

await program.parseAsync();
