// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * Internal coercion helpers for values that arrive from JSON or SQLite.
 *
 * The Dart sources cast these values (`as String?`, `as bool?`) and rely on the
 * platform type system; here we narrow by `typeof` and fall back to `null` so a
 * malformed payload cannot masquerade as a valid field.
 */

/** Returns [value] as a string, or `null` when it is absent. */
export function optionalString(value: unknown): string | null {
  return value == null ? null : String(value)
}

/** Returns [value] as a finite number, or `null` when it is not numeric. */
export function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Returns [value] as a boolean, or `null` when it is not a boolean. */
export function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** Returns [value] as a `string[]`, or `null` when it is not an array. */
export function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) ? value.map((item) => String(item)) : null
}

/** Filters [value] down to its object elements (Dart `whereType<Map>()`). */
export function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> => typeof item === 'object' && item !== null
      )
    : []
}
