import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const parseJson = text => JSON.parse(text.replace(/^\uFEFF/, ''));
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const inside = (parent, child) => { const relative = path.relative(parent, child); return relative === '' || !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); };

async function exists(file) {
  try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

/** Check each ancestor too: junctions must not redirect either the move or config writes. */
async function noLinks(file) {
  for (let current = file; ; current = path.dirname(current)) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Refusing a symbolic link or junction: ${current}`);
    if (current === path.dirname(current)) return;
  }
}

async function inventory(directory) {
  const directories = [''], files = [];
  async function visit(prefix) {
    for (const entry of (await readdir(path.join(directory, prefix))).sort()) {
      const relative = path.join(prefix, entry), file = path.join(directory, relative), stat = await lstat(file);
      if (stat.isSymbolicLink()) throw new Error(`Refusing a symbolic link or junction: ${file}`);
      if (stat.isDirectory()) { directories.push(relative); await visit(relative); }
      else if (stat.isFile()) files.push({ relative, bytes: stat.size, sha256: digest(await readFile(file)) });
      else throw new Error(`Refusing an unusual project file: ${file}`);
    }
  }
  await visit('');
  return { directories, files };
}

/** Only a complete directory prefix matches; similarly named projects remain untouched. */
function replaceDirectory(value, source, target) {
  const normalized = value.replaceAll('\\', '/'), old = source.replaceAll('\\', '/');
  const prefix = normalized.slice(0, old.length);
  if (!samePath(prefix, old) || normalized.length > old.length && normalized[old.length] !== '/') return value;
  const replacement = value.includes('\\') ? target : target.replaceAll('\\', '/');
  return replacement + value.slice(old.length);
}

function prepareConfiguration(original, source, target) {
  const parsed = parseJson(original);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected an existing Wallpaper Engine configuration object.');
  const references = { editorRecentProjects: 0, selectedWallpapers: 0, recentWallpaperConfigs: 0, wallpaperProperties: 0, other: 0 };
  function note(parts, key = false) {
    if (key && parts.at(-1) === 'wproperties') references.wallpaperProperties++;
    else if (parts.includes('editor') && parts.includes('recentfiles')) references.editorRecentProjects++;
    else if (parts.includes('wallpaperconfigrecent')) references.recentWallpaperConfigs++;
    else if (parts.includes('wallpaperconfig') && parts.includes('selectedwallpapers')) references.selectedWallpapers++;
    else references.other++;
  }
  function transform(value, parts = []) {
    if (typeof value === 'string') {
      const changed = replaceDirectory(value, source, target);
      if (changed !== value) note(parts);
      return changed;
    }
    if (Array.isArray(value)) return value.map((item, index) => transform(item, [...parts, String(index)]));
    if (!value || typeof value !== 'object') return value;
    const keys = new Set();
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      const changed = replaceDirectory(key, source, target);
      if (keys.has(changed)) throw new Error(`Relocation would merge distinct configuration keys: ${changed}`);
      keys.add(changed);
      if (changed !== key) note(parts, true);
      return [changed, transform(item, [...parts, key])];
    }));
  }
  const expected = transform(parsed);
  // Preserve whitespace and every untouched token, including unrelated escaped strings.
  const updated = original.replace(/"(?:\\.|[^"\\])*"/g, token => {
    const value = JSON.parse(token), changed = replaceDirectory(value, source, target);
    return changed === value ? token : JSON.stringify(changed);
  });
  if (!isDeepStrictEqual(parseJson(updated), expected)) throw new Error('Configuration text replacement failed its semantic verification.');
  return { updated, references };
}

/** The caller must close Wallpaper Engine and its editor before executing the move. */
export async function relocateWallpaperProject(options, dependencies = {}) {
  if (!options.project || !options.directory || !options.config) throw new Error('Project, directory and config are required.');
  if (!path.isAbsolute(options.directory) || !/^[\x20-\x7e]+$/.test(options.directory)) throw new Error('The new directory must be an absolute ASCII path.');
  const projectFile = path.resolve(options.project), source = path.dirname(projectFile), target = path.resolve(options.directory), configFile = path.resolve(options.config);
  const parent = path.dirname(source);
  if (path.basename(projectFile) !== 'project.json' || path.basename(parent).toLowerCase() !== 'myprojects'
    || !samePath(parent, path.dirname(target)) || samePath(source, target)) throw new Error('Source and new directory must be distinct siblings inside the same myprojects directory.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(path.basename(target)) || /[. ]$/.test(target)) throw new Error('Choose a plain ASCII project directory name without trailing dots or spaces.');
  if (inside(source, configFile) || inside(target, configFile)) throw new Error('The existing Wallpaper Engine config must be outside the project directory.');
  await noLinks(projectFile); await noLinks(configFile); await noLinks(parent);
  if (!(await lstat(configFile)).isFile() || !(await lstat(projectFile)).isFile()) throw new Error('Project and config must be existing regular files.');
  if (await exists(target)) throw new Error('The new directory already exists; nothing will be overwritten.');
  const metadata = parseJson(await readFile(projectFile, 'utf8'));
  if (!metadata || metadata.file !== 'index.html' || metadata.type !== 'web') throw new Error('Expected an existing editor-created Web project with file=index.html and type=web.');
  const indexFile = path.join(source, 'index.html');
  if (!(await lstat(indexFile)).isFile()) throw new Error('The editor project must contain index.html.');
  const original = await readFile(configFile), configuration = prepareConfiguration(original.toString('utf8'), source, target);
  const contents = await inventory(source);
  const summary = { project: projectFile, sourceDirectory: source, targetDirectory: target, config: configFile,
    title: metadata.title ?? null, files: contents.files.length, directories: contents.directories.length,
    references: configuration.references, checkOnly: options.check === true };
  if (summary.checkOnly) return summary;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDirectory = path.join(repository, 'artifacts', `WallpaperEngine-relocation-backup-${stamp}-${randomUUID()}`);
  await noLinks(repository);
  if (await exists(path.join(repository, 'artifacts'))) await noLinks(path.join(repository, 'artifacts'));
  await mkdir(path.join(backupDirectory, 'project'), { recursive: true });
  await noLinks(backupDirectory);
  // Complete, verified backups precede every change to the live project and configuration.
  for (const relative of contents.directories.slice(1)) await mkdir(path.join(backupDirectory, 'project', relative), { recursive: true });
  for (const file of contents.files) await copyFile(path.join(source, file.relative), path.join(backupDirectory, 'project', file.relative), constants.COPYFILE_EXCL);
  await writeFile(path.join(backupDirectory, 'config.json'), original, { flag: 'wx' });
  if (!isDeepStrictEqual(await inventory(path.join(backupDirectory, 'project')), contents)) throw new Error(`Project backup verification failed: ${backupDirectory}`);
  if (!(await readFile(path.join(backupDirectory, 'config.json'))).equals(original)) throw new Error(`Configuration backup verification failed: ${backupDirectory}`);
  await writeFile(path.join(backupDirectory, 'relocation.json'), `${JSON.stringify({ ...summary, configSha256: digest(original), ...contents }, null, 2)}\n`, { flag: 'wx' });
  await noLinks(projectFile); await noLinks(configFile); await noLinks(parent);
  if (await exists(target) || !(await readFile(configFile)).equals(original)
    || !isDeepStrictEqual(await inventory(source), contents)) throw new Error(`Project/config changed during backup; no live changes were made. Backup: ${backupDirectory}`);

  let moved = false, configWriteStarted = false;
  try {
    await rename(source, target); moved = true;
    if (!(await readFile(configFile)).equals(original)) throw new Error('Configuration changed before its write; refusing to overwrite another writer.');
    if (configuration.updated !== original.toString('utf8')) {
      configWriteStarted = true;
      await (dependencies.writeConfiguration ?? writeFile)(configFile, configuration.updated, 'utf8');
      if ((await readFile(configFile, 'utf8')) !== configuration.updated) throw new Error('Configuration write verification failed.');
    }
    if (!isDeepStrictEqual(await inventory(target), contents)) throw new Error('Relocated project verification failed.');
    return { ...summary, backupDirectory, relocated: true };
  } catch (cause) {
    const rollback = { projectRestored: !moved, configRestored: !configWriteStarted, errors: [] };
    if (moved) {
      try {
        await noLinks(target); await noLinks(parent);
        if (await exists(source)) throw new Error('The original project directory was recreated by another process.');
        await rename(target, source);
        rollback.projectRestored = isDeepStrictEqual(await inventory(source), contents);
        if (!rollback.projectRestored) throw new Error('Restored project verification failed.');
      } catch (error) { rollback.errors.push(`Project: ${error.message}`); }
    }
    if (configWriteStarted) {
      try {
        await noLinks(configFile);
        if (!(await readFile(configFile)).equals(original)) await writeFile(configFile, original);
        rollback.configRestored = (await readFile(configFile)).equals(original);
        if (!rollback.configRestored) throw new Error('Restored configuration verification failed.');
      } catch (error) { rollback.errors.push(`Config: ${error.message}`); }
    }
    const error = new Error(`Relocation failed: ${cause.message}. ${rollback.projectRestored && rollback.configRestored ? 'Project and configuration were rolled back.' : 'Rollback is incomplete; recover from the retained backup.'}`);
    error.backupDirectory = backupDirectory; error.rollback = rollback;
    throw error;
  }
}

function commandLine(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--check' && options.check === undefined) { options.check = true; continue; }
    const key = { '--project': 'project', '--directory': 'directory', '--config': 'config' }[flag];
    if (!key || options[key] !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Usage: node scripts/relocate-wallpaper-project.mjs --project <existing project.json> --directory <new absolute ASCII directory> --config <existing config.json> [--check]');
    options[key] = args[++index];
  }
  return options;
}

if (process.argv[1] && samePath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  try { console.log(JSON.stringify(await relocateWallpaperProject(commandLine(process.argv.slice(2))), null, 2)); }
  catch (error) { console.error(JSON.stringify({ error: error.message, backupDirectory: error.backupDirectory ?? null, rollback: error.rollback ?? null }, null, 2)); process.exitCode = 1; }
}
