import { copyFile, mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Extend an existing editor-created Web project. This never creates project.json.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const projectFlag = args.indexOf('--project');
if (projectFlag < 0 || !args[projectFlag + 1] || args.some((arg, index) => index !== projectFlag + 1 && !['--project', '--check', '--copy-dist'].includes(arg))) {
  throw new Error('Usage: node scripts/update-wallpaper-project.mjs --project <existing project.json> [--check] [--copy-dist]');
}
const projectFile = path.resolve(args[projectFlag + 1]);
if (path.basename(projectFile) !== 'project.json') throw new Error('Choose the editor-created project.json.');
if ((await lstat(projectFile)).isSymbolicLink()) throw new Error('Choose the real editor project file, not a symbolic link.');
const projectDirectory = path.dirname(projectFile);
const original = await readFile(projectFile, 'utf8');
const project = JSON.parse(original.replace(/^\uFEFF/, ''));
if (project.file !== 'index.html' || typeof project.title !== 'string') throw new Error('Expected an existing editor-created Web project with file=index.html and a title.');
await lstat(path.join(projectDirectory, 'index.html'));
const properties = JSON.parse(await readFile(path.join(repository, 'scripts', 'wallpaper-properties.json'), 'utf8'));
project.general ??= {};
project.general.properties ??= {};
if (typeof project.general !== 'object' || Array.isArray(project.general) || typeof project.general.properties !== 'object' || Array.isArray(project.general.properties)) throw new Error('Existing project property structure is invalid.');

function validValue(definition, value) {
  if (definition.type === 'combo') return definition.options.some(option => option.value === value);
  if (definition.type === 'bool') return typeof value === 'boolean';
  if (definition.type === 'slider') return typeof value === 'number' && Number.isFinite(value) && value >= definition.min && value <= definition.max;
  return typeof value === 'string';
}
for (const [key, definition] of Object.entries(properties)) {
  const previous = project.general.properties[key];
  project.general.properties[key] = { ...previous, ...definition, value: validValue(definition, previous?.value) ? previous.value : definition.value };
}

const dist = path.join(repository, 'dist');
async function filesIn(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(directory, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Refusing a symbolic link or unusual file: ${relative}`);
  }
  return files;
}
const files = args.includes('--copy-dist') ? await filesIn(dist) : [];
if (args.includes('--copy-dist') && (!files.includes('index.html') || files.includes('project.json'))) throw new Error('Build dist first; it must contain index.html and no project.json.');
const summary = { project: projectFile, title: project.title, propertyKeys: Object.keys(properties), copyFiles: files.length, checkOnly: args.includes('--check') };
if (summary.checkOnly) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDirectory = path.join(repository, 'artifacts', `WallpaperEngine-project-backup-${stamp}`);
  await mkdir(backupDirectory, { recursive: true });
  await writeFile(path.join(backupDirectory, 'project.json'), original, 'utf8');
  for (const relative of files) {
    const destination = path.join(projectDirectory, relative);
    // Check every existing destination ancestor; a linked folder must not redirect writes.
    for (let target = destination; target !== path.dirname(projectDirectory); target = path.dirname(target)) {
      try { if ((await lstat(target)).isSymbolicLink()) throw new Error(`Refusing linked destination ${target}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (target === projectDirectory) break;
    }
    try {
      await mkdir(path.dirname(path.join(backupDirectory, relative)), { recursive: true });
      await copyFile(destination, path.join(backupDirectory, relative));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(dist, relative), destination);
  }
  await writeFile(projectFile, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...summary, backupDirectory }, null, 2));
}
