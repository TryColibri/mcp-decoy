import { editor } from 'monaco-editor/editor/editor.api';

/** Name of the Monaco theme built by `defineTheme`. */
export const THEME_NAME = 'decoy';

/**
 * Colors of the theme as CSS custom properties of `:root` (see
 * `src/ui/styles.css`). Nothing is hard-coded here: the dark theme overrides the
 * variables under `data-theme="dark"`.
 */
const COLORS = {
  background: '--code-bg',
  foreground: '--code-fg',
  key: '--code-key',
  string: '--code-string',
  number: '--code-number',
  literal: '--code-literal',
  punctuation: '--code-punctuation',
  lineNumber: '--code-line-number',
  lineNumberActive: '--code-line-number-active',
  lineHighlight: '--code-line-highlight',
  cursor: '--code-cursor',
  selection: '--code-selection',
  selectionInactive: '--code-selection-inactive',
  guide: '--code-guide',
  guideActive: '--code-guide-active',
  bracketMatch: '--code-bracket-match',
  error: '--code-error',
  widgetBackground: '--code-widget-bg',
  widgetBorder: '--code-widget-border',
  widgetSelected: '--code-widget-selected',
  focus: '--code-focus',
} as const;

type ColorName = keyof typeof COLORS;

/**
 * Defines the `decoy` theme from the current values of the CSS variables, on
 * top of Monaco's dark base when the page is dark. Call it again after the
 * page theme changes, then `editor.setTheme(THEME_NAME)` applies it.
 */
export function defineTheme(): void {
  const styles = getComputedStyle(document.documentElement);
  const colorOf = (name: ColorName) =>
    toHex(styles.getPropertyValue(COLORS[name]));
  const color = {
    background: colorOf('background'),
    foreground: colorOf('foreground'),
    lineNumber: colorOf('lineNumber'),
    lineNumberActive: colorOf('lineNumberActive'),
    lineHighlight: colorOf('lineHighlight'),
    cursor: colorOf('cursor'),
    selection: colorOf('selection'),
    selectionInactive: colorOf('selectionInactive'),
    guide: colorOf('guide'),
    guideActive: colorOf('guideActive'),
    bracketMatch: colorOf('bracketMatch'),
    error: colorOf('error'),
    widgetBackground: colorOf('widgetBackground'),
    widgetBorder: colorOf('widgetBorder'),
    widgetSelected: colorOf('widgetSelected'),
    focus: colorOf('focus'),
  };
  /** Token rules take `RRGGBB`, without the alpha channel. */
  const token = (name: ColorName) => colorOf(name).slice(1, 7);
  editor.defineTheme(THEME_NAME, {
    base: document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: token('foreground') },
      { token: 'string.key.json', foreground: token('key') },
      { token: 'string.value.json', foreground: token('string') },
      { token: 'number.json', foreground: token('number') },
      { token: 'keyword.json', foreground: token('literal') },
      { token: 'delimiter', foreground: token('punctuation') },
      { token: 'comment', foreground: token('punctuation') },
    ],
    colors: {
      'editor.background': color.background,
      'editor.foreground': color.foreground,
      'editorLineNumber.foreground': color.lineNumber,
      'editorLineNumber.activeForeground': color.lineNumberActive,
      'editor.lineHighlightBackground': color.lineHighlight,
      'editorCursor.foreground': color.cursor,
      'editor.selectionBackground': color.selection,
      'editor.inactiveSelectionBackground': color.selectionInactive,
      'editorIndentGuide.background1': color.guide,
      'editorIndentGuide.activeBackground1': color.guideActive,
      'editorBracketMatch.background': color.bracketMatch,
      'editorBracketMatch.border': color.bracketMatch,
      'editorError.foreground': color.error,
      'editorWidget.background': color.widgetBackground,
      'editorWidget.border': color.widgetBorder,
      'editorWidget.foreground': color.foreground,
      'editorSuggestWidget.background': color.widgetBackground,
      'editorSuggestWidget.border': color.widgetBorder,
      'editorSuggestWidget.foreground': color.foreground,
      'editorSuggestWidget.selectedBackground': color.widgetSelected,
      'editorHoverWidget.background': color.widgetBackground,
      'editorHoverWidget.border': color.widgetBorder,
      'editorHoverWidget.foreground': color.foreground,
      'list.hoverBackground': color.widgetSelected,
      focusBorder: color.focus,
    },
  });
}

let canvas: CanvasRenderingContext2D | null | undefined;

/**
 * Monaco accepts only hex colors, while Tailwind v4's are `oklch`: paint the
 * color on one pixel and read it back as sRGB.
 */
const toHex = (css: string): string => {
  canvas ??= document
    .createElement('canvas')
    .getContext('2d', { willReadFrequently: true });
  if (canvas === null) {
    return '#000000';
  }
  canvas.clearRect(0, 0, 1, 1);
  canvas.fillStyle = '#000000';
  canvas.fillStyle = css.trim();
  canvas.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = canvas.getImageData(0, 0, 1, 1).data;
  return `#${[red, green, blue, alpha].map(hex).join('')}`;
};

const hex = (channel: number | undefined): string =>
  (channel ?? 0).toString(16).padStart(2, '0');
