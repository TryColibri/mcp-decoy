import { type FieldError } from '@/shared/api';

/** Base class of the errors services throw. Front-ends map them to their own vocabulary. */
export abstract class DomainError extends Error {}

/** The addressed resource does not exist. */
export class NotFoundError extends DomainError {
  override name = 'NotFoundError';
}

/** The operation conflicts with existing state, for example a duplicate name. */
export class ConflictError extends DomainError {
  override name = 'ConflictError';
}

/** The input is invalid. Carries one entry per offending field. */
export class ValidationError extends DomainError {
  override name = 'ValidationError';

  /** Field-level errors, with dotted paths. */
  readonly errors: FieldError[];

  /**
   * @param errors - Field-level errors, with dotted paths.
   * @param message - Summary; defaults to the first field error.
   */
  constructor(errors: FieldError[], message?: string) {
    super(message ?? errors.at(0)?.message ?? 'Invalid input');
    this.errors = errors;
  }
}
