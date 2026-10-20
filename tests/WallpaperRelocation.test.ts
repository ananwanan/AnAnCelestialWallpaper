import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repository = path.resolve('.'), script = path.join(repository, 'scripts/relocate-wallpaper-project.mjs');
const { relocateWallpaperProject } = await import(pathToFileURL(script).href);
const temporary: string[] = [], backups: string[] = [];

afterEach(async () => {
  for (const directory of temporary.splice(0)) {
    const resolved = path.resolve(directory), parent = path.resolve(os.tmpdir());
    if (!resolved.startsWith(`${parent}${path.sep}anan-wallpaper-relocation-`)) throw new Error('Refusing cleanup outside the named temporary test directories.');
    await rm(resolved, { recursive: true, force: true });
  }
  for (const directory of backups.splice(0)) {
    const resolved = path.resolve(directory), parent = path.join(repository, 'artifacts');
    if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('WallpaperEngine-relocation-backup-')) throw new Error('Refusing cleanup outside the test-created backup.');
    await rm(resolved, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'anan-wallpaper-relocation-')); temporary.push(directory);
  const parent = path.join(directory, 'myprojects'), source = path.join(parent, 'chronorbit_—_rea'), target = path.join(parent, 'anan-celestial-wallpaper');
  await mkdir(path.join(source, 'assets'), { recursive: true }); await mkdir(path.join(source, 'empty'), { recursive: true });
  const project = path.join(source, 'project.json'), config = path.join(directory, 'config.json');
  const metadata = '\uFEFF{\n\t"title":"Editor title — 保留", "type":"web", "version":0, "file":"index.html",\n\t"preview":"preview.png", "general":{"properties":{"showSatellites":{"value":false},"unknown":{"value":"preserve"}}}\n}\n';
  await writeFile(project, metadata); await writeFile(path.join(source, 'index.html'), '<html>TEST ONLY editor-project migration fixture</html>');
  const binary = Buffer.from([0, 1, 17, 128, 255]); await writeFile(path.join(source, 'assets', 'local.bin'), binary);
  await writeFile(path.join(source, 'preview.png'), binary);
  const forward = source.replaceAll('\\', '/'), previousIndex = `${forward}/index.html`;
  const preferences = { quality: 'high', satelliteGroup: 'gps', showSatellites: true, syncInterval: '1', futureProperty: 42 };
  const value = { user: { general: { editor: { recentfiles: [`${forward}/project.json`] },
    wallpaperconfig: { selectedwallpapers: { Monitor0: { file: previousIndex } } },
    wallpaperconfigrecent: [{ title: '保留标题', config: { selectedwallpapers: { Monitor0: { file: path.join(source, 'index.html') } } } }],
    unrelated: `${forward}-other/index.html`, escaped: '\\u4e2d' }, wproperties: { [previousIndex]: { Monitor0: preferences } } }, untouched: [null, true, 7] };
  const original = `\uFEFF${JSON.stringify(value, null, '\t')}\n`;
  await writeFile(config, original);
  return { directory, parent, source, target, project, config, original, metadata, binary, preferences, previousIndex, options: { project, directory: target, config } };
}

describe('safe relocation of a real editor-created project shape', () => {
  it('offers a read-only CLI check with the four exact reference categories', async () => {
    const relocationBackups = async () => (await readdir(path.join(repository, 'artifacts')).catch(() => [])).filter(name => name.startsWith('WallpaperEngine-relocation-backup-'));
    const data = await fixture(), before = await relocationBackups();
    const output = JSON.parse(execFileSync(process.execPath, [script, '--project', data.project, '--directory', data.target, '--config', data.config, '--check'], { encoding: 'utf8' }));
    expect(output).toMatchObject({ checkOnly: true, files: 4, references: { editorRecentProjects: 1, selectedWallpapers: 1, recentWallpaperConfigs: 1, wallpaperProperties: 1, other: 0 } });
    expect(await readFile(data.project, 'utf8')).toBe(data.metadata); expect(await readFile(data.config, 'utf8')).toBe(data.original);
    expect(await readdir(data.parent)).toEqual([path.basename(data.source)]);
    expect(await relocationBackups()).toEqual(before);
  });

  it('backs up every byte and empty directory, moves the project, and preserves user preferences and unrelated text', async () => {
    const data = await fixture();
    const result = await relocateWallpaperProject(data.options); backups.push(result.backupDirectory);
    expect(result.relocated).toBe(true); expect(await readdir(data.parent)).toEqual([path.basename(data.target)]);
    expect(await readFile(path.join(data.target, 'project.json'), 'utf8')).toBe(data.metadata);
    expect(await readFile(path.join(data.target, 'assets', 'local.bin'))).toEqual(data.binary); expect(await readdir(path.join(data.target, 'empty'))).toEqual([]);
    expect(await readFile(path.join(result.backupDirectory, 'config.json'), 'utf8')).toBe(data.original);
    expect(await readFile(path.join(result.backupDirectory, 'project', 'project.json'), 'utf8')).toBe(data.metadata);
    expect(await readFile(path.join(result.backupDirectory, 'project', 'preview.png'))).toEqual(data.binary);
    expect(await readdir(path.join(result.backupDirectory, 'project', 'empty'))).toEqual([]);
    const changed = await readFile(data.config, 'utf8'), parsed = JSON.parse(changed.replace(/^\uFEFF/, ''));
    const nextIndex = `${data.target.replaceAll('\\', '/')}/index.html`;
    expect(parsed.user.wproperties[nextIndex].Monitor0).toEqual(data.preferences); expect(parsed.user.wproperties[data.previousIndex]).toBeUndefined();
    expect(parsed.user.general.wallpaperconfig.selectedwallpapers.Monitor0.file).toBe(nextIndex);
    expect(parsed.user.general.wallpaperconfigrecent[0].config.selectedwallpapers.Monitor0.file).toBe(path.join(data.target, 'index.html'));
    expect(parsed.user.general.unrelated).toBe(`${data.source.replaceAll('\\', '/')}-other/index.html`);
    expect(parsed.user.general.escaped).toBe('\\u4e2d'); expect(changed.startsWith('\uFEFF{\n\t')).toBe(true);
  });

  it.each(['different-parent', 'relative', 'unicode', 'exists', 'not-myprojects', 'bad-metadata', 'bad-config'])(
    'rejects %s before changing the project or configuration', async kind => {
      const data = await fixture(), options = { ...data.options };
      if (kind === 'different-parent') options.directory = path.join(data.directory, 'elsewhere');
      if (kind === 'relative') options.directory = 'relative-target';
      if (kind === 'unicode') options.directory = path.join(data.parent, 'new_—_project');
      if (kind === 'exists') await mkdir(data.target);
      if (kind === 'not-myprojects') options.project = data.config;
      if (kind === 'bad-metadata') await writeFile(data.project, '{"file":"index.html","type":"scene"}');
      if (kind === 'bad-config') await writeFile(data.config, '{invalid');
      const projectBefore = await readFile(data.project), configBefore = await readFile(data.config);
      await expect(relocateWallpaperProject(options)).rejects.toThrow();
      expect(await readFile(data.project)).toEqual(projectBefore); expect(await readFile(data.config)).toEqual(configBefore);
    });

  it('refuses junctions inside a project without following them into another directory', async () => {
    const data = await fixture(), outside = path.join(data.directory, 'outside'); await mkdir(outside);
    await writeFile(path.join(outside, 'must-not-copy.txt'), 'TEST ONLY outside project');
    await symlink(outside, path.join(data.source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(relocateWallpaperProject(data.options)).rejects.toThrow(/symbolic link or junction/);
    expect(await readFile(data.config, 'utf8')).toBe(data.original); expect(await readdir(data.parent)).toEqual([path.basename(data.source)]);
  });

  it('refuses a config reached through a junction ancestor', async () => {
    const data = await fixture(), linked = path.join(data.directory, 'linked-config-directory');
    await symlink(data.directory, linked, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(relocateWallpaperProject({ ...data.options, config: path.join(linked, 'config.json') })).rejects.toThrow(/symbolic link or junction/);
    expect(await readFile(data.config, 'utf8')).toBe(data.original); expect(await readFile(data.project, 'utf8')).toBe(data.metadata);
  });

  it('rejects a destination preference-key collision instead of overwriting saved user choices', async () => {
    const data = await fixture(), value = JSON.parse(data.original.replace(/^\uFEFF/, ''));
    value.user.wproperties[`${data.target.replaceAll('\\', '/')}/index.html`] = { Monitor0: { unrelatedSavedChoice: true } };
    await writeFile(data.config, JSON.stringify(value)); const before = await readFile(data.config);
    await expect(relocateWallpaperProject(data.options)).rejects.toThrow(/merge distinct configuration keys/);
    expect(await readFile(data.config)).toEqual(before); expect(await readFile(data.project, 'utf8')).toBe(data.metadata);
  });

  it.each([true, false])('rolls back the directory and a partially written config after write failure (throws=%s)', async throws => {
    const data = await fixture();
    try {
      await relocateWallpaperProject(data.options, { writeConfiguration: async (file: string) => {
        await writeFile(file, '{TEST ONLY partial write');
        if (throws) throw new Error('TEST ONLY interrupted configuration write');
      } });
      throw new Error('Expected the injected failure.');
    } catch (error) {
      const failure = error as Error & { backupDirectory: string; rollback: { projectRestored: boolean; configRestored: boolean; errors: string[] } };
      if (failure.backupDirectory) backups.push(failure.backupDirectory);
      expect(failure.rollback).toEqual({ projectRestored: true, configRestored: true, errors: [] });
      expect(failure.message).toContain('rolled back');
      expect(await readFile(path.join(failure.backupDirectory, 'config.json'), 'utf8')).toBe(data.original);
    }
    expect(await readFile(data.config, 'utf8')).toBe(data.original); expect(await readFile(data.project, 'utf8')).toBe(data.metadata);
    expect(await readdir(data.parent)).toEqual([path.basename(data.source)]);
  });
});
