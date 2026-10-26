import { type JSONPath } from 'jsonc-parser';
import { type ComponentProps, lazy, Suspense } from 'react';
import { twMerge } from 'tailwind-merge';

/**
 * What the text is: it picks the colors and the completions.
 *
 * - `json-schema`: a JSON Schema; suggests its keywords.
 * - `json-e`: a json-e template of a `CallToolResult`; colors the operators
 *   and `${…}`, suggests operators and result fields.
 * - `json`: plain JSON.
 * - `text`: anything else, uncolored.
 */
export type CodeEditorMode = 'json-schema' | 'json-e' | 'json' | 'text';

/** A semantic error to underline in the text. */
export type CodeEditorIssue = {
  /** What is wrong; shown on hover. */
  message: string;
  /** Where: property names and array indexes leading to the node. */
  path: JSONPath;
};

/** Props of `CodeEditor` that Monaco itself needs. */
export type CodeEditorViewProps = {
  /** The text. */
  value: string;
  /** Called with the whole text after each edit. */
  onChange?: (value: string) => void;
  /** The text can be selected and copied, not edited. */
  readOnly?: boolean;
  /** What the text is. Changing it re-creates the editor. */
  mode: CodeEditorMode;
  /** A semantic error to underline. JSON syntax errors need no help. */
  issue?: CodeEditorIssue;
  /**
   * Grow with the content, up to 60% of the viewport height, then scroll
   * inside. Otherwise the editor fills its parent.
   */
  autoHeight?: boolean;
  /** Accessible name of the editor. */
  'aria-label'?: string;
  /** Whether the text is invalid. */
  'aria-invalid'?: boolean;
  /** Id of the element that describes the editor. */
  'aria-describedby'?: string;
};

/** Props of `CodeEditor`. */
export type CodeEditorProps = Omit<ComponentProps<'div'>, 'onChange'> &
  CodeEditorViewProps;

const MonacoView = lazy(() => import('./monaco-view'));

/**
 * A code editor, or a code viewer when `readOnly`, built on Monaco. Monaco is
 * several MB, so it loads only when the first editor is shown; until then an
 * empty box of the same size stands in, and the layout doesn't jump.
 *
 * `className` is merged over the box styles and `ref` is the box. The box has
 * no border or background of its own: the editor takes the theme's.
 *
 * @example
 * <CodeEditor
 *   mode="json-schema"
 *   aria-label="Input schema"
 *   value={text}
 *   onChange={setText}
 *   className="rounded-lg border border-paper-300"
 * />
 */
export function CodeEditor({
  className,
  value,
  onChange,
  readOnly,
  mode,
  issue,
  autoHeight,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  ...props
}: CodeEditorProps) {
  const box = twMerge(
    'relative overflow-hidden bg-(--code-bg)',
    autoHeight === true && 'min-h-24',
    className,
  );
  return (
    <div {...props} className={box}>
      <Suspense fallback={null}>
        <MonacoView
          key={mode}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          mode={mode}
          issue={issue}
          autoHeight={autoHeight}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
        />
      </Suspense>
    </div>
  );
}
