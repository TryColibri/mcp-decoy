import { useSyncExternalStore } from 'react';

/** What the user picked: a fixed theme, or `system` to follow the OS. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** The theme actually applied to the page. */
export type Theme = 'light' | 'dark';

/** Result of `useTheme`. */
export type UseThemeResult = {
  /** The stored choice. `system` until the user picks a theme. */
  preference: ThemePreference;
  /** Stores a choice and applies it to the page right away. */
  setPreference: (preference: ThemePreference) => void;
};

// Keep the key and values in sync with the inline script in index.html.
const storageKey = 'theme';
const darkQuery = '(prefers-color-scheme: dark)';

const listeners = new Set<() => void>();

/**
 * Whether a value is a valid theme preference.
 *
 * @param value - Anything, typically a string read from storage.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(storageKey);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function resolveTheme(preference: ThemePreference): Theme {
  const dark =
    preference === 'dark' ||
    (preference === 'system' && matchMedia(darkQuery).matches);
  return dark ? 'dark' : 'light';
}

function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset.theme = resolveTheme(preference);
}

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function setPreference(preference: ThemePreference) {
  try {
    if (preference === 'system') {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, preference);
    }
  } catch {
    // Storage is blocked: the choice applies to this page load only.
  }
  applyTheme(preference);
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  const query = matchMedia(darkQuery);
  const syncWithSystem = () => {
    applyTheme(readPreference());
  };
  const syncWithStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) {
      syncWithSystem();
      listener();
    }
  };
  query.addEventListener('change', syncWithSystem);
  window.addEventListener('storage', syncWithStorage);

  return () => {
    listeners.delete(listener);
    query.removeEventListener('change', syncWithSystem);
    window.removeEventListener('storage', syncWithStorage);
  };
}

/**
 * The user's theme preference. The theme itself lives in `data-theme` on
 * `<html>`, which `index.html` sets before first paint and this hook keeps
 * current, including when the OS theme changes while the preference is `system`.
 *
 * @example
 * const { preference, setPreference } = useTheme();
 * setPreference('dark');
 */
export function useTheme(): UseThemeResult {
  const preference = useSyncExternalStore(
    subscribe,
    readPreference,
    (): ThemePreference => 'system',
  );
  return { preference, setPreference };
}
