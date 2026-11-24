import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {link, mkdir, readFile, readdir, rename, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {z} from 'zod';
import {IdSchema, WorkspaceSchema} from '../workflow-schema';

export const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const digest = (value: unknown) => hash(JSON.stringify(value));
export const fileHash = async (filename: string) => {
  const sha = createHash('sha256');
  for await (const chunk of createReadStream(filename)) sha.update(chunk);
  return sha.digest('hex');
};
export const readJson = async (filename: string): Promise<unknown> => JSON.parse(await readFile(filename, 'utf8'));
export const readDoc = async <T>(filename: string, schema: z.ZodType<T>) => schema.parse(await readJson(filename));
export const doc = (root: string, kind: string, id: string) => path.join(root, kind, IdSchema.parse(id) + '.json');
export const workspace = (root: string) => readDoc(path.join(root, 'workspace.json'), WorkspaceSchema);
export const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
export const isPresent = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'EEXIST';
export const optional = async <T>(load: () => Promise<T>) => {
  try { return await load(); } catch (error) { if (!isMissing(error)) throw error; }
};

export async function save(filename: string, value: unknown, replace = false) {
  await mkdir(path.dirname(filename), {recursive: true});
  const tmp = filename + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600, flush: true});
    if (replace) await rename(tmp, filename);
    else await link(tmp, filename);
  } finally {
    await unlink(tmp).catch((error) => { if (!isMissing(error)) throw error; });
  }
}

export async function immutable(filename: string, value: unknown) {
  try { await save(filename, value); }
  catch (error) {
    if (!isPresent(error)) throw error;
    if (digest(await readJson(filename)) !== digest(value)) throw new Error('既存の記録と内容が異なります: ' + filename);
  }
}

export async function listDocs<T>(root: string, kind: string, schema: z.ZodType<T>) {
  const directory = path.join(root, kind);
  const names = (await optional(() => readdir(directory))) ?? [];
  return Promise.all(names.filter((name) => name.endsWith('.json')).sort().map((name) => readDoc(path.join(directory, name), schema)));
}
