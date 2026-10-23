import { type ComponentProps } from 'react';
import { Link } from 'react-router';
import { twMerge } from 'tailwind-merge';

import { tw } from '@/ui/tw';

/** Visual weight of a button. */
export type ButtonVariant = 'primary' | 'secondary' | 'danger';

/** Size of a button: `large` is the 44px call to action, `small` fits toolbars. */
export type ButtonSize = 'large' | 'small';

const base = tw`inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg font-sans whitespace-nowrap no-underline transition-colors disabled:cursor-not-allowed`;

const variants: Record<ButtonVariant, string> = {
  primary: tw`border-0 bg-ink font-semibold text-white hover:bg-[#2a2d34] hover:text-white disabled:bg-ink-faint`,
  secondary: tw`border border-control bg-surface font-medium text-ink hover:bg-hover hover:text-ink disabled:text-ink-faint`,
  danger: tw`border border-control bg-surface font-medium text-error hover:bg-error-bg hover:text-error disabled:text-ink-faint`,
};

const sizes: Record<ButtonSize, string> = {
  large: tw`min-h-11 px-5 text-sm`,
  small: tw`min-h-9 px-3 text-[13px]`,
};

/**
 * Class names of a button, for elements that can't be a `Button` (Base UI
 * triggers, links).
 *
 * @param variant - Visual weight.
 * @param size - Height and padding.
 */
export function buttonClasses(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'large',
): string {
  return tw`${base} ${variants[variant]} ${sizes[size]}`;
}

/** Props of `Button`. */
export type ButtonProps = ComponentProps<'button'> & {
  /** Visual weight. Default: `secondary`. */
  variant?: ButtonVariant;
  /** Height and padding. Default: `large`. */
  size?: ButtonSize;
};

/**
 * A `<button>` styled as an MCP Decoy button. Defaults to `type="button"`.
 * `className` is merged over the button styles; `ref` is the `<button>`.
 */
export function Button({
  variant,
  size,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={twMerge(buttonClasses(variant, size), className)}
      {...props}
    />
  );
}

/** Props of `ButtonLink`. */
export type ButtonLinkProps = ComponentProps<typeof Link> & {
  /** Visual weight. Default: `secondary`. */
  variant?: ButtonVariant;
  /** Height and padding. Default: `large`. */
  size?: ButtonSize;
};

/**
 * A router `<Link>` styled as an MCP Decoy button. `className` is merged over the
 * button styles; `ref` is the `<a>`.
 */
export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={twMerge(buttonClasses(variant, size), className)}
      {...props}
    />
  );
}
