import { WallpaperSettings } from './Settings';

type HostProperty = { value: unknown };
type HostProperties = Record<string, HostProperty | undefined>;
type HostListener = {
  applyUserProperties?: (props: HostProperties) => void;
  applyGeneralProperties?: (props: HostProperties) => void;
  setPaused?: (paused: boolean) => void;
};

declare global {
  interface Window { wallpaperPropertyListener?: HostListener; }
}

/** Register at application entry before scene creation to receive initial host settings. */
export function registerWallpaperBridge(onChange: (changes: Partial<WallpaperSettings>) => void): void {
  window.wallpaperPropertyListener = {
    applyUserProperties(props) {
      const changed: Record<string, unknown> = {};
      for (const key of ['viewMode', 'showSatellites', 'satelliteGroup', 'syncInterval', 'timeScale', 'showOrbits', 'showLabels', 'enableMouse', 'quality']) {
        if (props[key] !== undefined) changed[key] = props[key]?.value;
      }
      onChange(changed as Partial<WallpaperSettings>);
    },
    applyGeneralProperties(props) {
      if (props.fps !== undefined) onChange({ fps: Number(props.fps.value) });
    },
    setPaused(paused) { onChange({ paused }); },
  };
}
