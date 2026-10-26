import { createElement } from 'react';

import { type CodeEditorProps } from '../code-editor';

/**
 * A textarea standing in for the Monaco-backed `CodeEditor` in jsdom tests,
 * which can't run Monaco. Use it with `vi.mock('@/ui/components/code-editor')`.
 * It keeps what tests rely on: the accessible name, `aria-invalid`, the value
 * and `onChange(value)`.
 *
 * This file is `index.ts`, not `.tsx`: Vitest finds a mock by the file name of
 * the module it replaces, the barrel.
 */
export function CodeEditor({
  value,
  onChange,
  readOnly,
  className,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: CodeEditorProps) {
  return createElement('textarea', {
    className,
    value,
    readOnly,
    'aria-label': ariaLabel,
    'aria-invalid': ariaInvalid,
    'aria-describedby': ariaDescribedBy,
    onChange: (event: { target: { value: string } }) => {
      onChange?.(event.target.value);
    },
  });
}
