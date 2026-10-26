import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isThemePreference, useTheme } from './use-theme';

type MockSystem = {
  /** Changes the OS theme and fires the `change` listeners. */
  setDark: (dark: boolean) => void;
};

function mockSystemTheme(initialDark: boolean): MockSystem {
  const listeners = new Set<() => void>();
  const query = {
    matches: initialDark,
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
  };
  vi.stubGlobal('matchMedia', () => query);

  return {
    setDark: (dark) => {
      query.matches = dark;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

describe('isThemePreference', () => {
  it('accepts the three preferences', () => {
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isThemePreference('auto')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('defaults to the system preference', () => {
    mockSystemTheme(false);

    const { result } = renderHook(() => useTheme());

    expect(result.current.preference).toBe('system');
  });

  it('reads a stored preference', () => {
    mockSystemTheme(false);
    localStorage.setItem('theme', 'dark');

    const { result } = renderHook(() => useTheme());

    expect(result.current.preference).toBe('dark');
  });

  it('ignores an invalid stored value', () => {
    mockSystemTheme(false);
    localStorage.setItem('theme', 'purple');

    const { result } = renderHook(() => useTheme());

    expect(result.current.preference).toBe('system');
  });

  describe('setPreference', () => {
    it('applies and stores a fixed theme', () => {
      mockSystemTheme(false);
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setPreference('dark');
      });

      expect(result.current.preference).toBe('dark');
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(localStorage.getItem('theme')).toBe('dark');
    });

    it('ignores the OS theme once a theme is fixed', () => {
      const system = mockSystemTheme(false);
      const { result } = renderHook(() => useTheme());
      act(() => {
        result.current.setPreference('light');
      });

      act(() => {
        system.setDark(true);
      });

      expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('resolves system to the OS theme and clears the stored value', () => {
      mockSystemTheme(true);
      localStorage.setItem('theme', 'light');
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setPreference('system');
      });

      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(localStorage.getItem('theme')).toBeNull();
    });

    it('still applies the theme when storage throws', () => {
      mockSystemTheme(false);
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setPreference('dark');
      });

      expect(result.current.preference).toBe('system');
      expect(document.documentElement.dataset.theme).toBe('dark');
    });
  });

  describe('system changes', () => {
    it('follows the OS theme while the preference is system', () => {
      const system = mockSystemTheme(false);
      renderHook(() => useTheme());

      act(() => {
        system.setDark(true);
      });

      expect(document.documentElement.dataset.theme).toBe('dark');
    });
  });
});
