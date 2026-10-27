import {
  editor,
  MarkerSeverity,
  Range,
  Uri,
} from 'monaco-editor/editor/editor.api';
import { useEffect, useRef, useState } from 'react';

import { type CodeEditorMode, type CodeEditorViewProps } from './code-editor';
import { findJSONEHighlights } from './json-e';
import { rangeOf, type TextRange } from './locate';
import { setupMonaco } from './setup';
import { defineTheme, THEME_NAME } from './theme';

setupMonaco();

/** Owner of the markers set for `issue`, so they don't mix with the JSON worker's. */
const MARKER_OWNER = 'decoy';

/** Height of an `autoHeight` editor before its content is measured. */
const MIN_HEIGHT = 96;

const OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  fixedOverflowWidgets: true,
  folding: true,
  fontFamily: '"Geist Mono", ui-monospace, monospace',
  fontSize: 12.5,
  hideCursorInOverviewRuler: true,
  insertSpaces: true,
  lineHeight: 20,
  lineNumbersMinChars: 3,
  minimap: { enabled: false },
  occurrencesHighlight: 'off',
  overviewRulerBorder: false,
  overviewRulerLanes: 0,
  padding: { top: 12, bottom: 12 },
  // Keys and values are strings: suggest while typing inside them.
  quickSuggestions: { strings: true, other: true, comments: false },
  scrollBeyondLastLine: false,
  scrollbar: { useShadows: false },
  stickyScroll: { enabled: false },
  suggest: { showWords: false },
  tabSize: 2,
  theme: THEME_NAME,
  wordBasedSuggestions: 'off',
};

let modelCount = 0;

const languageOf = (mode: CodeEditorMode) =>
  mode === 'text' ? 'plaintext' : 'json';

const createModel = (mode: CodeEditorMode, value: string) => {
  modelCount++;
  const extension = mode === 'text' ? 'txt' : 'json';
  // The mode in the path is what the JSON schemas and the json-e completions
  // are matched against.
  const model = editor.createModel(
    value,
    languageOf(mode),
    Uri.parse(`inmemory://decoy/${mode}/${modelCount}.${extension}`),
  );
  // Punctuation keeps one color: the model, not the editor, owns this option.
  model.updateOptions({
    bracketColorizationOptions: {
      enabled: false,
      independentColorPoolPerBracketType: false,
    },
  });
  return model;
};

const rangeAt = (model: editor.ITextModel, { offset, length }: TextRange) =>
  Range.fromPositions(
    model.getPositionAt(offset),
    model.getPositionAt(offset + length),
  );

type View = {
  instance: editor.IStandaloneCodeEditor;
  model: editor.ITextModel;
};

/**
 * Monaco, mounted. Loaded lazily by `CodeEditor`: it is several MB. See
 * `CodeEditor` for the props.
 */
export default function MonacoView({
  value,
  onChange,
  readOnly = false,
  mode,
  issue,
  autoHeight = false,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: CodeEditorViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>();
  const [contentHeight, setContentHeight] = useState(MIN_HEIGHT);
  const latest = useRef({ value, onChange });
  const syncing = useRef(false);
  const highlights = useRef<editor.IEditorDecorationsCollection>(undefined);

  useEffect(() => {
    latest.current = { value, onChange };
  });

  useEffect(() => {
    if (host.current === null) {
      return undefined;
    }
    defineTheme();
    const model = createModel(mode, latest.current.value);
    const instance = editor.create(host.current, { ...OPTIONS, model });
    highlights.current = instance.createDecorationsCollection();
    const typing = model.onDidChangeContent(() => {
      if (!syncing.current) {
        latest.current.onChange?.(model.getValue());
      }
    });
    // The height is only used by `autoHeight` editors.
    const growing = instance.onDidContentSizeChange(() => {
      setContentHeight(instance.getContentHeight());
    });
    setView({ instance, model });
    return () => {
      typing.dispose();
      growing.dispose();
      instance.dispose();
      model.dispose();
      setView(undefined);
    };
  }, [mode]);

  // The theme is built from CSS variables: rebuild it when the page theme flips.
  useEffect(() => {
    const watching = new MutationObserver(() => {
      defineTheme();
      editor.setTheme(THEME_NAME);
    });
    watching.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      watching.disconnect();
    };
  }, []);

  // The value is controlled, but Monaco keeps its own undo history: apply
  // only what differs from the text, as an edit.
  useEffect(() => {
    if (view === undefined || view.model.getValue() === value) {
      return;
    }
    syncing.current = true;
    view.model.pushEditOperations(
      [],
      [{ range: view.model.getFullModelRange(), text: value }],
      () => null,
    );
    syncing.current = false;
  }, [view, value]);

  useEffect(() => {
    view?.instance.updateOptions({
      readOnly,
      domReadOnly: readOnly,
      renderLineHighlight: readOnly ? 'none' : 'line',
      // A body that grows with its content leaves the wheel to the page.
      scrollbar: { alwaysConsumeMouseWheel: !autoHeight },
    });
  }, [view, readOnly, autoHeight]);

  useEffect(() => {
    if (view === undefined) {
      return;
    }
    view.instance.updateOptions({ ariaLabel });
    const input = view.instance.getDomNode()?.querySelector('textarea');
    setAttribute(input, 'aria-invalid', ariaInvalid);
    setAttribute(input, 'aria-describedby', ariaDescribedBy);
  }, [view, ariaLabel, ariaInvalid, ariaDescribedBy]);

  useEffect(() => {
    if (view === undefined) {
      return;
    }
    const markers =
      issue === undefined
        ? []
        : [
            {
              severity: MarkerSeverity.Error,
              message: issue.message,
              ...toMarkerRange(rangeAt(view.model, rangeOf(value, issue.path))),
            },
          ];
    editor.setModelMarkers(view.model, MARKER_OWNER, markers);
  }, [view, issue, value]);

  useEffect(() => {
    if (view === undefined || mode !== 'json-e') {
      return;
    }
    highlights.current?.set(
      findJSONEHighlights(value).map((highlight) => ({
        range: rangeAt(view.model, highlight),
        options: {
          inlineClassName:
            highlight.kind === 'operator'
              ? 'code-operator'
              : 'code-interpolation',
        },
      })),
    );
  }, [view, mode, value]);

  return (
    <div
      ref={host}
      className={autoHeight ? 'max-h-[60vh]' : 'absolute inset-0'}
      data-readonly={readOnly ? '' : undefined}
      style={autoHeight ? { height: contentHeight } : undefined}
    />
  );
}

const toMarkerRange = (range: Range) => ({
  startLineNumber: range.startLineNumber,
  startColumn: range.startColumn,
  endLineNumber: range.endLineNumber,
  endColumn: range.endColumn,
});

const setAttribute = (
  element: Element | null | undefined,
  name: string,
  value: boolean | string | undefined,
) => {
  if (value === undefined) {
    element?.removeAttribute(name);
  } else {
    element?.setAttribute(name, String(value));
  }
};
