import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import definitions from '../scripts/wallpaper-properties.json';
import { DEFAULT_SETTINGS, normalizeSettingChanges, USER_PROPERTY_KEYS } from '../src/settings/Settings';

describe('existing Wallpaper Engine editor-project migration', () => {
  it('publishes every supported property with a runtime-valid default and no unimplemented group', () => {
    expect(Object.keys(definitions).sort()).toEqual([...USER_PROPERTY_KEYS].sort());
    const wrappedDefaults = Object.fromEntries(Object.entries(definitions).map(([key, definition]) => [key, definition.value]));
    const normalized = normalizeSettingChanges(wrappedDefaults);
    for (const key of USER_PROPERTY_KEYS) expect(normalized[key]).toEqual(DEFAULT_SETTINGS[key]);
    expect(definitions.satelliteGroup.options.map(option => option.value)).toEqual(['stations', 'gps']);
  });

  it('backs up an existing project and keeps editor metadata, unknown properties and prior valid choices', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'anan-wallpaper-project-'));
    const projectFile = path.join(directory, 'project.json');
    const original = {
      title: 'Editor title', file: 'index.html', preview: 'preview.png', customEditorMetadata: { keep: 1 },
      general: { arbitraryEditorField: true, properties: {
        schemecolor: { type: 'color', value: '0 0 0', order: 0 },
        quality: { type: 'combo', value: 'high' }, showDesktopSettings: { type: 'bool', value: true },
      } },
    };
    await mkdir(directory, { recursive: true });
    await writeFile(projectFile, JSON.stringify(original));
    await writeFile(path.join(directory, 'index.html'), '<html>editor-generated import</html>');
    const output = execFileSync(process.execPath, ['scripts/update-wallpaper-project.mjs', '--project', projectFile], { encoding: 'utf8' });
    const migrated = JSON.parse(await readFile(projectFile, 'utf8'));
    expect(migrated.title).toBe(original.title);
    expect(migrated.preview).toBe(original.preview);
    expect(migrated.customEditorMetadata).toEqual(original.customEditorMetadata);
    expect(migrated.general.arbitraryEditorField).toBe(true);
    expect(migrated.general.properties.schemecolor).toEqual(original.general.properties.schemecolor);
    expect(migrated.general.properties.quality.value).toBe('high');
    expect(migrated.general.properties.showDesktopSettings.value).toBe(true);
    expect(migrated.general.properties.showSatellites.value).toBe(false);
    expect(JSON.parse(await readFile(path.join(JSON.parse(output).backupDirectory, 'project.json'), 'utf8'))).toEqual(original);
  });

  it('does not create a substitute project when no editor project exists', () => {
    expect(() => execFileSync(process.execPath, ['scripts/update-wallpaper-project.mjs', '--project', path.join(os.tmpdir(), 'missing-anan-wallpaper-project', 'project.json')], { stdio: 'pipe' })).toThrow();
  });
});
