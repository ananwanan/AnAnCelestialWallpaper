import { describe, expect, it } from 'vitest';
import { optionNavigationIndex } from '../src/settings/DesktopSelectControls';

describe('HTML listbox keyboard navigation', () => {
  it('skips disabled entries and wraps both directions', () => {
    const disabled = [false, true, false, true];
    expect(optionNavigationIndex(disabled, 0, 'ArrowDown')).toBe(2);
    expect(optionNavigationIndex(disabled, 2, 'ArrowDown')).toBe(0);
    expect(optionNavigationIndex(disabled, 0, 'ArrowUp')).toBe(2);
    expect(optionNavigationIndex(disabled, 2, 'ArrowUp')).toBe(0);
  });
  it('Home/End select the first/last enabled option, including disabled boundary options', () => {
    const disabled = [true, false, false, true];
    expect(optionNavigationIndex(disabled, 2, 'Home')).toBe(1);
    expect(optionNavigationIndex(disabled, 1, 'End')).toBe(2);
  });
  it('recovers a removed/disabled active option after a dynamic option replacement', () => {
    expect(optionNavigationIndex([true, false, false], 0, 'ArrowDown')).toBe(1);
    expect(optionNavigationIndex([true, false, false], 9, 'ArrowUp')).toBe(2);
  });
  it('keeps a single enabled entry selected and refuses empty/fully disabled lists', () => {
    expect(optionNavigationIndex([true, false, true], 1, 'ArrowDown')).toBe(1);
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End'] as const) {
      expect(optionNavigationIndex([], -1, key)).toBe(-1);
      expect(optionNavigationIndex([true, true], 0, key)).toBe(-1);
    }
  });
});
