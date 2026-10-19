import { normalizeSettingChanges, ownProperty, USER_PROPERTY_KEYS, type WallpaperSettings } from './Settings';

export interface WallpaperHostListener {
  applyUserProperties?: (props: unknown) => void;
  applyGeneralProperties?: (props: unknown) => void;
  setPaused?: (paused: unknown) => void;
}

export interface WallpaperHost {
  wallpaperPropertyListener?: WallpaperHostListener;
};

declare global {
  interface Window extends WallpaperHost {}
}

/**
 * Register synchronously at entry, before scene/UI creation, so initial host delivery is received.
 * User properties wrap values; applyGeneralProperties.fps is a plain number.
 * https://docs.wallpaperengine.io/en/web/api/propertylistener.html
 * https://docs.wallpaperengine.io/en/web/performance/fps.html
 */
export function registerWallpaperBridge(
  onChange: (changes: Partial<WallpaperSettings>) => void,
  host: WallpaperHost = window,
): () => void {
  const previous = host.wallpaperPropertyListener;
  const hadOwnListener = Object.hasOwn(host, 'wallpaperPropertyListener');
  let disposed = false;
  const emit = (changes: unknown): void => {
    if (disposed) return;
    const patch = normalizeSettingChanges(changes);
    if (Object.keys(patch).length > 0) onChange(patch);
  };
  const listener: WallpaperHostListener = {
    ...previous,
    applyUserProperties(props) {
      const changed: Record<string, unknown> = {};
      for (const key of USER_PROPERTY_KEYS) {
        const value = ownProperty(ownProperty(props, key), 'value');
        if (value !== undefined) changed[key] = value;
      }
      emit(changed);
    },
    applyGeneralProperties(props) {
      emit({ fps: ownProperty(props, 'fps') });
    },
    setPaused(paused) { emit({ paused }); },
  };
  host.wallpaperPropertyListener = listener;
  return () => {
    if (disposed) return;
    disposed = true;
    if (host.wallpaperPropertyListener !== listener) return;
    if (hadOwnListener) host.wallpaperPropertyListener = previous;
    else delete host.wallpaperPropertyListener;
  };
}
