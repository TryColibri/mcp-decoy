import { AlertDialog } from '@base-ui/react/alert-dialog';
import { useEffect, useRef } from 'react';
import { type Blocker, useBlocker } from 'react-router';

import { buttonClasses } from '@/ui/components/button';

/** Result of `useUnsavedChangesGuard`. */
export type UnsavedChangesGuard = {
  /** The router blocker; `blocked` while a navigation awaits a decision. */
  blocker: Blocker;
  /** Lets the next navigation through, for when the changes were just saved. */
  allowLeave: () => void;
  /** Re-arms the guard, for when saving failed. */
  blockLeave: () => void;
};

/**
 * Warns before the user loses unsaved changes: the browser's own prompt on
 * reload, close or external navigation, and a blocked router navigation
 * (render `UnsavedChangesDialog` with the returned `blocker`) inside the app.
 *
 * @param dirty - Whether there are unsaved changes.
 */
export function useUnsavedChangesGuard(dirty: boolean): UnsavedChangesGuard {
  const released = useRef(false);
  const blocker = useBlocker(() => dirty && !released.current);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    const warn = (event: BeforeUnloadEvent) => {
      if (!released.current) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);

  return {
    blocker,
    allowLeave: () => {
      released.current = true;
    },
    blockLeave: () => {
      released.current = false;
    },
  };
}

/** Props of `UnsavedChangesDialog`. */
export type UnsavedChangesDialogProps = {
  /** The blocker from `useUnsavedChangesGuard`. */
  blocker: Blocker;
};

/** Asks whether to discard the unsaved changes or stay on the page. */
export function UnsavedChangesDialog({ blocker }: UnsavedChangesDialogProps) {
  return (
    <AlertDialog.Root
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.state === 'blocked') {
          blocker.reset();
        }
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-ink-900/30" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 flex w-105 max-w-[calc(100vw-2rem)] -translate-1/2 flex-col gap-4 rounded-xl border border-paper-200 bg-white p-6 shadow-xl">
          <AlertDialog.Title className="m-0 text-base font-semibold">
            Discard unsaved changes?
          </AlertDialog.Title>
          <AlertDialog.Description className="m-0 text-sm text-ink-600">
            This tool has changes that haven’t been saved. Leaving now loses
            them.
          </AlertDialog.Description>
          <div className="flex justify-end gap-3">
            <AlertDialog.Close className={buttonClasses('secondary', 'small')}>
              Keep editing
            </AlertDialog.Close>
            <button
              type="button"
              className={buttonClasses('primary', 'small')}
              onClick={() => {
                if (blocker.state === 'blocked') {
                  blocker.proceed();
                }
              }}
            >
              Discard changes
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
