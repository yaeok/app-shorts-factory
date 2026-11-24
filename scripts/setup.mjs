import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) {
  console.error('Node.js 22以上が必要です。現在は ' + process.version + ' です。更新後に npm run setup を再実行してください。');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const packages = Object.keys({...manifest.dependencies, ...manifest.devDependencies});
const needsInstall = packages.some((name) => !existsSync(path.join(root, 'node_modules', name, 'package.json')));
if (needsInstall && args.some((arg) => arg === '--help' || arg === '-h')) {
  console.log('npm run setup [-- [workspace] [--demo | --brief <json>] [--content <json>] [--series] [--status]]');
  console.log('引数なしで対話セットアップを開始します。--demo はサンプル、--status は現在地の確認です。');
  process.exit(0);
}
if (needsInstall) {
  console.log('依存関係をインストールしています（npm ci）。');
  const npmEntry = process.env.npm_execpath;
  const install = npmEntry
    ? spawnSync(process.execPath, [npmEntry, 'ci'], {cwd: root, stdio: 'inherit'})
    : spawnSync('npm', ['ci'], {cwd: root, stdio: 'inherit'});
  if (install.status !== 0) {
    console.error('依存関係のインストールに失敗しました。上のエラーを解消してから npm run setup を再実行してください。');
    process.exit(install.status ?? 1);
  }
}

const result = spawnSync(process.execPath, [path.join(root, 'bin', 'app-shorts.mjs'), 'setup', ...args], {cwd: root, stdio: 'inherit'});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
