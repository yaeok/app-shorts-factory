import {readdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('.codex/skills');
const names = (await readdir(root)).sort();
const errors = [];

for (const name of names) {
  const directory = path.join(root, name);
  if (!(await stat(directory)).isDirectory()) continue;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) errors.push(`${name}: invalid directory name`);

  const skill = await readFile(path.join(directory, 'SKILL.md'), 'utf8');
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) {
    errors.push(`${name}: missing YAML frontmatter`);
    continue;
  }
  const declaredName = frontmatter[1]?.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter[1]?.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (declaredName !== name) errors.push(`${name}: frontmatter name does not match directory`);
  if (!description || description.length < 20) errors.push(`${name}: description is missing or too short`);
  if (/\[TODO|TODO:/.test(skill)) errors.push(`${name}: unfinished TODO remains`);

  const ui = await readFile(path.join(directory, 'agents/openai.yaml'), 'utf8');
  if (!/display_name:\s*".+"/.test(ui)) errors.push(`${name}: display_name is missing`);
  if (!/short_description:\s*".{10,}"/.test(ui)) errors.push(`${name}: short_description is missing`);
  if (!new RegExp(`default_prompt:.*\\$${name}`).test(ui)) errors.push(`${name}: default_prompt must mention $${name}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`${names.length} skills validated.`);
}
