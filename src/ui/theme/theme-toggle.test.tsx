import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers system, light and dark, with system selected by default', () => {
    render(<ThemeToggle />);

    expect(screen.getByRole('radio', { name: 'System theme' })).toBeChecked();
    expect(
      screen.getByRole('radio', { name: 'Light theme' }),
    ).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dark theme' })).not.toBeChecked();
  });

  it('applies and stores the picked theme', async () => {
    render(<ThemeToggle />);

    await userEvent.click(screen.getByRole('radio', { name: 'Dark theme' }));

    expect(screen.getByRole('radio', { name: 'Dark theme' })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('shows a stored preference as selected', () => {
    localStorage.setItem('theme', 'light');

    render(<ThemeToggle />);

    expect(screen.getByRole('radio', { name: 'Light theme' })).toBeChecked();
  });
});
