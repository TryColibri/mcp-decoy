import { type ComponentProps } from 'react';
import { Link } from 'react-router';

/** Visual weight of a button. */
export type ButtonVariant = 'primary' | 'secondary' | 'danger';

/** Size of a button: `large` is the 44px call to action, `small` fits toolbars. */
export type ButtonSize = 'large' | 'small';

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-sans whitespace-nowrap no-underline transition-colors cursor-pointer disabled:cursor-not-allowed';

const variants: Record<ButtonVariant, string> = {
  primary:
    'border-0 bg-ink text-white font-semibold hover:bg-[#2a2d34] hover:text-white disabled:bg-ink-faint',
  secondary:
    'border border-control bg-surface text-ink font-medium hover:bg-hover hover:text-ink disabled:text-ink-faint',
  danger:
    'border border-control bg-surface text-error font-medium hover:bg-error-bg hover:text-error disabled:text-ink-faint',
};

const sizes: Record<ButtonSize, string> = {
  large: 'min-h-11 px-5 text-sm',
  small: 'min-h-9 px-3 text-[13px]',
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
  return `${base} ${variants[variant]} ${sizes[size]}`;
}

/** Props of `Button`. */
export type ButtonProps = ComponentProps<'button'> & {
  /** Visual weight. Default: `secondary`. */
  variant?: ButtonVariant;
  /** Height and padding. Default: `large`. */
  size?: ButtonSize;
};

/** A `<button>` styled as a decoy button. Defaults to `type="button"`. */
export function Button({
  variant,
  size,
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${buttonClasses(variant, size)} ${className}`}
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

/** A router `<Link>` styled as a decoy button. */
export function ButtonLink({
  variant,
  size,
  className = '',
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={`${buttonClasses(variant, size)} ${className}`}
      {...props}
    />
  );
}
