import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Checkbox } from '@base-ui/react/checkbox';
import { Tooltip } from '@base-ui/react/tooltip';
import {
  CheckIcon,
  EyeSlashIcon,
  FloppyDiskIcon,
  TrashIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react';
import { type ReactNode, useId, useState } from 'react';
import { twMerge } from 'tailwind-merge';

import {
  type ServerSummary,
  type Tool,
  type ToolAnnotations,
} from '@/shared/api';
import { ApiError, client, unwrap, unwrapEmpty } from '@/ui/api';
import { Button, buttonClasses } from '@/ui/components/button';
import { tw } from '@/ui/tw';

import {
  isToolFormDirty,
  parseToolForm,
  toFormErrors,
  toFormState,
  type ToolFormErrors,
  type ToolFormState,
} from './tool-form';
import { useToolValidation } from './use-tool-validation';
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from './use-unsaved-changes-guard';

/** Props of `ToolEditor`. */
export type ToolEditorProps = {
  /** The server the tool belongs to. */
  server: ServerSummary;
  /** The saved tool being edited. */
  tool: Tool;
  /** Called after a successful save, publish or unpublish. */
  onSaved: (tool: Tool) => Promise<void>;
  /** Called after the tool was deleted. */
  onDeleted: () => Promise<void>;
};

const fieldLabel = tw`flex flex-col gap-1.5 text-[13px] text-ink-700`;
const hint = tw`text-xs font-normal text-ink-500`;
const textarea = tw`box-border w-full rounded-lg border bg-paper-50 px-3.5 py-3 leading-[1.6] text-ink-900`;
/** Fixed-size, fills the height left over in its field. */
const code = tw`${textarea} min-h-0 flex-1 resize-none font-mono text-[12.5px]`;
const prose = tw`${textarea} resize-y font-sans text-sm`;
/** Lets two fields side by side share their label row, so the inputs line up. */
const aligned = tw`@4xl:row-span-2 @4xl:grid @4xl:grid-rows-subgrid`;
const control = tw`box-border min-h-10 rounded-lg border bg-white px-3 text-sm font-medium text-ink-900`;

const ANNOTATIONS: Array<{ key: keyof ToolAnnotations; tip: string }> = [
  {
    key: 'readOnlyHint',
    tip: 'The tool does not modify its environment. Clients may skip confirmation prompts.',
  },
  {
    key: 'destructiveHint',
    tip: 'The tool may delete or overwrite data rather than only add to it. Only meaningful when not read-only.',
  },
  {
    key: 'openWorldHint',
    tip: 'The tool reaches outside a closed domain, for example the web or other external services.',
  },
];

/** Right column of the Tools tab: every field of one tool and its actions. */
export function ToolEditor({
  server,
  tool,
  onSaved,
  onDeleted,
}: ToolEditorProps) {
  const [form, setForm] = useState<ToolFormState>(() => toFormState(tool));
  const [errors, setErrors] = useState<ToolFormErrors>({});
  const [busy, setBusy] = useState(false);
  const dirty = isToolFormDirty(form, tool);
  const { blocker, allowLeave, blockLeave } = useUnsavedChangesGuard(dirty);
  const validation = useToolValidation({
    inputSchema: form.inputSchema,
    responseTemplate: form.responseTemplate,
  });
  const inputSchemaError = errors.inputSchema ?? validation.inputSchemaError;
  const responseTemplateError =
    errors.responseTemplate ?? validation.responseTemplateError;
  const ids = {
    name: useId(),
    title: useId(),
    description: useId(),
    schema: useId(),
    schemaHint: useId(),
    template: useId(),
    templateHint: useId(),
  };

  const update = <K extends keyof ToolFormState>(
    key: K,
    value: ToolFormState[K],
  ) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({
      ...previous,
      [key]: undefined,
      form: undefined,
    }));
  };

  const save = async (published: boolean) => {
    const parsed = parseToolForm(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setBusy(true);
    allowLeave();
    try {
      const saved = await unwrap(
        client.servers[':server'].tools[':tool'].$patch({
          param: { server: server.name, tool: tool.name },
          json: { ...parsed.patch, published },
        }),
      );
      await onSaved(saved);
    } catch (caught) {
      blockLeave();
      setErrors(describeError(caught));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    allowLeave();
    try {
      await unwrapEmpty(
        client.servers[':server'].tools[':tool'].$delete({
          param: { server: server.name, tool: tool.name },
        }),
      );
      await onDeleted();
    } catch (caught) {
      blockLeave();
      setErrors(describeError(caught));
      setBusy(false);
    }
  };

  const sessions = server.sessionCount;
  const actions = tool.published ? (
    <>
      <Button
        variant="primary"
        disabled={busy || !dirty}
        onClick={() => save(true)}
      >
        <FloppyDiskIcon size={16} aria-hidden="true" />
        Save changes
      </Button>
      <Button disabled={busy} onClick={() => save(false)}>
        <EyeSlashIcon size={16} aria-hidden="true" />
        Unpublish
      </Button>
      <ConfirmButton
        title={`Delete “${tool.name}”?`}
        description="Clients stop seeing it right away. This can’t be undone."
        confirm="Delete tool"
        disabled={busy}
        onConfirm={remove}
      >
        <TrashIcon size={16} aria-hidden="true" />
        Delete tool
      </ConfirmButton>
    </>
  ) : (
    <>
      <Button variant="primary" disabled={busy} onClick={() => save(true)}>
        <UploadSimpleIcon size={16} aria-hidden="true" />
        Publish tool
      </Button>
      <Button disabled={busy || !dirty} onClick={() => save(false)}>
        <FloppyDiskIcon size={16} aria-hidden="true" />
        Save draft
      </Button>
      <ConfirmButton
        title={`Discard “${tool.name}”?`}
        description="The draft is deleted. Clients never saw it."
        confirm="Discard draft"
        disabled={busy}
        onConfirm={remove}
      >
        <TrashIcon size={16} aria-hidden="true" />
        Discard draft
      </ConfirmButton>
    </>
  );

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <UnsavedChangesDialog blocker={blocker} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-1 flex-col gap-5 px-8 pt-7 pb-8">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="m-0 font-mono text-[22px] font-medium break-all">
              {tool.name}
            </h2>
            <span
              className={twMerge(
                'rounded-full px-2 py-0.5 text-xs font-semibold',
                tool.published
                  ? 'bg-green-50 text-green-900'
                  : 'bg-orange-50 text-orange-800',
              )}
            >
              {tool.published ? 'Published' : 'Draft · not published'}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field id={ids.name} label="Name" error={errors.name}>
              <input
                id={ids.name}
                className={twMerge(control, 'font-mono', borderOf(errors.name))}
                value={form.name}
                onChange={(event) => {
                  update('name', event.target.value);
                }}
                spellCheck={false}
                aria-invalid={errors.name !== undefined}
              />
            </Field>
            <Field
              id={ids.title}
              label="Title"
              hint="optional, shown to users"
              error={errors.title}
            >
              <input
                id={ids.title}
                className={twMerge(control, borderOf(errors.title))}
                value={form.title}
                onChange={(event) => {
                  update('title', event.target.value);
                }}
              />
            </Field>
          </div>

          <Field
            id={ids.description}
            label="Description"
            error={errors.description}
          >
            <textarea
              id={ids.description}
              rows={2}
              className={twMerge(prose, borderOf(errors.description))}
              value={form.description}
              onChange={(event) => {
                update('description', event.target.value);
              }}
            />
          </Field>

          <div className="grid min-h-120 flex-1 grid-cols-1 gap-4 contain-size @4xl:min-h-80 @4xl:grid-cols-2 @4xl:grid-rows-[auto_minmax(0,1fr)] @4xl:gap-y-1.5">
            <Field
              id={ids.schema}
              className={aligned}
              label="Input schema"
              hint="JSON Schema with “type”: “object”. Not enforced on calls."
              hintId={ids.schemaHint}
              error={inputSchemaError}
            >
              <textarea
                id={ids.schema}
                className={twMerge(code, borderOf(inputSchemaError))}
                value={form.inputSchema}
                onChange={(event) => {
                  update('inputSchema', event.target.value);
                }}
                spellCheck={false}
                aria-describedby={ids.schemaHint}
                aria-invalid={inputSchemaError !== undefined}
              />
            </Field>

            <Field
              id={ids.template}
              className={aligned}
              label="Response template"
              hint={<TemplateHint />}
              hintId={ids.templateHint}
              error={responseTemplateError}
            >
              <textarea
                id={ids.template}
                className={twMerge(code, borderOf(responseTemplateError))}
                value={form.responseTemplate}
                onChange={(event) => {
                  update('responseTemplate', event.target.value);
                }}
                spellCheck={false}
                aria-describedby={ids.templateHint}
                aria-invalid={responseTemplateError !== undefined}
              />
            </Field>
          </div>

          <fieldset className="m-0 flex flex-wrap gap-x-6 gap-y-2 border-0 p-0 text-sm text-ink-700">
            <legend className="sr-only">Annotations</legend>
            <Tooltip.Provider>
              {ANNOTATIONS.map(({ key, tip }) => (
                <AnnotationCheckbox
                  key={key}
                  name={key}
                  tip={tip}
                  checked={form.annotations[key]}
                  onCheckedChange={(checked) => {
                    update('annotations', {
                      ...form.annotations,
                      [key]: checked,
                    });
                  }}
                />
              ))}
            </Tooltip.Provider>
          </fieldset>
        </div>
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t border-paper-200 bg-white px-8 py-3">
        {errors.form !== undefined && (
          <p role="alert" className="m-0 text-[13px] text-red-800">
            {errors.form}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {actions}
          <span className="text-[13px] text-ink-600">
            Live, no restart · notifies{' '}
            <strong>
              {sessions} {sessions === 1 ? 'session' : 'sessions'}
            </strong>{' '}
            on <span className="font-mono">{server.name}</span>
          </span>
        </div>
      </footer>
    </div>
  );
}

type FieldProps = {
  className?: string;
  id: string;
  label: string;
  hint?: ReactNode;
  hintId?: string;
  error: string | undefined;
  children: ReactNode;
};

function Field({
  className,
  id,
  label,
  hint: hintContent,
  hintId,
  error,
  children,
}: FieldProps) {
  return (
    <div className={twMerge(fieldLabel, className)}>
      <p className="m-0">
        <label htmlFor={id}>{label}</label>
        {hintContent !== undefined && (
          <>
            {' '}
            <span id={hintId} className={hint}>
              {hintContent}
            </span>
          </>
        )}
      </p>
      <div className="flex flex-1 flex-col gap-1.5">
        {children}
        {error !== undefined && (
          <span role="alert" className="text-[13px] font-normal text-red-800">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

function TemplateHint() {
  return (
    <>
      A{' '}
      <a href="https://json-e.js.org/" target="_blank" rel="noreferrer">
        json-e
      </a>{' '}
      template rendering to a <span className="font-mono">CallToolResult</span>.{' '}
      <span className="font-mono">{'${args.city}'}</span> interpolates an
      argument; <span className="font-mono">{'{ "$eval": "args" }'}</span>{' '}
      inserts a structure. Keys starting with{' '}
      <span className="font-mono">$</span> are operators; write{' '}
      <span className="font-mono">$$</span> for a literal{' '}
      <span className="font-mono">$</span>.
    </>
  );
}

type AnnotationCheckboxProps = {
  name: string;
  tip: string;
  checked: boolean | undefined;
  onCheckedChange: (checked: boolean) => void;
};

function AnnotationCheckbox({
  name,
  tip,
  checked,
  onCheckedChange,
}: AnnotationCheckboxProps) {
  return (
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the label text sits inside Tooltip.Trigger
    <label className="inline-flex min-h-8 cursor-pointer items-center">
      <Tooltip.Root>
        <Tooltip.Trigger
          render={<span className="inline-flex items-center gap-2" />}
        >
          <Checkbox.Root
            checked={checked}
            onCheckedChange={onCheckedChange}
            className="flex size-4 items-center justify-center rounded-sm border border-paper-300 bg-white data-checked:border-ink-900 data-checked:bg-ink-900"
          >
            <Checkbox.Indicator className="flex text-white data-unchecked:hidden">
              <CheckIcon size={12} weight="bold" aria-hidden="true" />
            </Checkbox.Indicator>
          </Checkbox.Root>
          <span className="font-mono text-[13px]">{name}</span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner side="top" sideOffset={6}>
            <Tooltip.Popup className="max-w-72 rounded-lg bg-ink-900 px-3 py-2 text-xs/normal text-white shadow-lg">
              {tip}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </label>
  );
}

type ConfirmButtonProps = {
  children: ReactNode;
  title: string;
  description: string;
  confirm: string;
  disabled: boolean;
  onConfirm: () => Promise<void>;
};

function ConfirmButton({
  children,
  title,
  description,
  confirm,
  disabled,
  onConfirm,
}: ConfirmButtonProps) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        className={buttonClasses('danger')}
        disabled={disabled}
      >
        {children}
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-ink-900/30" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 flex w-105 max-w-[calc(100vw-2rem)] -translate-1/2 flex-col gap-4 rounded-xl border border-paper-200 bg-white p-6 shadow-xl">
          <AlertDialog.Title className="m-0 text-base font-semibold">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description className="m-0 text-sm text-ink-600">
            {description}
          </AlertDialog.Description>
          <div className="flex justify-end gap-3">
            <AlertDialog.Close className={buttonClasses('secondary', 'small')}>
              Cancel
            </AlertDialog.Close>
            <AlertDialog.Close
              className={buttonClasses('primary', 'small')}
              onClick={onConfirm}
            >
              {confirm}
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

const borderOf = (error: string | undefined) =>
  error === undefined ? 'border-paper-300' : 'border-red-700';

const describeError = (caught: unknown): ToolFormErrors => {
  if (caught instanceof ApiError && caught.status === 409) {
    return { name: caught.message };
  }
  if (caught instanceof ApiError) {
    const errors = toFormErrors(caught.fieldErrors);
    return Object.keys(errors).length === 0 ? { form: caught.message } : errors;
  }
  return { form: caught instanceof Error ? caught.message : String(caught) };
};
