import { useEffect, useRef, useState } from 'react';

import { checkInputSchema, checkResponseTemplate } from './tool-form';

/**
 * After a field is validated, further edits wait this long before the next
 * validation.
 */
export const VALIDATION_GRACE_MS = 400;

/** Params of `useToolValidation`. */
export type ToolValidationParams = {
  /** Input schema text as typed. */
  inputSchema: string;
  /** Response template text as typed. */
  responseTemplate: string;
};

/** Live validation of the two JSON fields. */
export type ToolValidation = {
  /** Why the input schema is invalid, if it is. */
  inputSchemaError: string | undefined;
  /** Why the response template is not JSON, if it is not. */
  responseTemplateError: string | undefined;
};

/**
 * Validates the input schema and the response template while they are
 * edited, not on save. The first edit is validated immediately; edits during
 * the next `VALIDATION_GRACE_MS` are not validated one by one, only the latest
 * text once the grace period ends.
 *
 * @param params - The field texts.
 */
export function useToolValidation({
  inputSchema,
  responseTemplate,
}: ToolValidationParams): ToolValidation {
  const settledSchema = useThrottled(inputSchema);
  const settledTemplate = useThrottled(responseTemplate);
  return {
    inputSchemaError: checkInputSchema(settledSchema),
    responseTemplateError: checkResponseTemplate(settledTemplate),
  };
}

/**
 * Follows `value`, but at most once per `VALIDATION_GRACE_MS`: the first
 * change goes through at once, later ones are held and only the latest is
 * applied when the grace period ends.
 */
const useThrottled = (value: string): string => {
  const [settled, setSettled] = useState(value);
  const settledAt = useRef(0);

  useEffect(() => {
    if (value === settled) {
      return undefined;
    }
    const apply = () => {
      settledAt.current = Date.now();
      setSettled(value);
    };
    const wait = settledAt.current + VALIDATION_GRACE_MS - Date.now();
    if (wait <= 0) {
      apply();
      return undefined;
    }
    const timer = setTimeout(apply, wait);
    return () => {
      clearTimeout(timer);
    };
  }, [value, settled]);

  return settled;
};
