import { useEffect, useState } from 'react';

/**
 * Follows `value`, but only after it has stopped changing for `delayMs`.
 * `useDeferredValue` doesn't wait, so it would still fire on every keystroke.
 *
 * @param value - The value to follow.
 * @param delayMs - How long `value` must hold still.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}
