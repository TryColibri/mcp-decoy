import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { TunnelPopover } from './tunnel-popover';

describe('TunnelPopover', () => {
  it('hides the command until the hint link is clicked', async () => {
    render(<TunnelPopover host="localhost" port={6280} />);

    expect(screen.queryByText(/cloudflared/)).toBeNull();

    await userEvent.click(
      screen.getByRole('button', { name: 'Need a public URL?' }),
    );

    expect(
      screen.getByText('cloudflared tunnel --url http://localhost:6280'),
    ).toBeVisible();
  });

  it('shows a single command for the given host and port', async () => {
    render(<TunnelPopover host="192.168.1.5" port={7000} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Need a public URL?' }),
    );

    expect(
      screen.getByText('cloudflared tunnel --url http://192.168.1.5:7000'),
    ).toBeVisible();
    expect(screen.queryByText(/ngrok/)).toBeNull();
  });

  it('closes on Escape', async () => {
    render(<TunnelPopover host="localhost" port={6280} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Need a public URL?' }),
    );
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByText(/cloudflared/)).toBeNull();
  });
});
