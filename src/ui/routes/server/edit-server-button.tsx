import { PencilSimpleIcon } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { type ServerSummary } from '@/shared/api';
import { Button } from '@/ui/components/button';
import { EditServerDialog } from '@/ui/components/edit-server-dialog';

/** Props of `EditServerButton`. */
export type EditServerButtonProps = {
  /** The server to edit. */
  server: ServerSummary;
  /** The button's label, next to the pencil icon. */
  children: ReactNode;
};

/**
 * A button that opens the edit dialog of a server. A rename moves the current
 * tab to the server's new URL.
 */
export function EditServerButton({ server, children }: EditServerButtonProps) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [editing, setEditing] = useState(false);

  // A rename moves every tab of the server to the new URL.
  const follow = (updated: ServerSummary, previousName: string) => {
    if (updated.name !== previousName) {
      const prefix = `/servers/${previousName}`;
      void navigate(
        `/servers/${updated.name}${pathname.slice(prefix.length)}${search}`,
        { replace: true },
      );
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size="small"
        onClick={() => {
          setEditing(true);
        }}
      >
        <PencilSimpleIcon size={14} aria-hidden="true" />
        {children}
      </Button>
      {editing && (
        <EditServerDialog
          server={server}
          onSaved={follow}
          onClose={() => {
            setEditing(false);
          }}
        />
      )}
    </>
  );
}
