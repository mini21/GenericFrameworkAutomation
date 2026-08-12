import { APIResponse } from '@playwright/test';

/** Throws with response body context on mismatch — more diagnosable than a bare status check. */
export async function expectStatus(response: APIResponse, expected: number): Promise<void> {
  if (response.status() !== expected) {
    const body = await response.text().catch(() => '<unreadable body>');
    throw new Error(
      `Expected status ${expected} but got ${response.status()} for ${response.url()}. Body: ${body}`,
    );
  }
}

export type SchemaShape = Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>;

/**
 * Minimal, dependency-free structural check: every key in `shape` must be
 * present on `data` with the matching JS type. Intentionally not a full
 * JSON Schema engine — for deeper validation, swap in a library (zod, ajv)
 * behind this same function signature.
 */
export function validateSchema(data: unknown, shape: SchemaShape): string[] {
  if (typeof data !== 'object' || data === null) {
    return ['Expected response body to be an object'];
  }

  const record = data as Record<string, unknown>;
  const errors: string[] = [];

  for (const [key, expectedType] of Object.entries(shape)) {
    const value = record[key];
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== expectedType) {
      errors.push(`Field "${key}": expected ${expectedType}, got ${actualType}`);
    }
  }

  return errors;
}

export function assertSchema(data: unknown, shape: SchemaShape): void {
  const errors = validateSchema(data, shape);
  if (errors.length > 0) {
    throw new Error(`Schema validation failed:\n${errors.join('\n')}`);
  }
}
