// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * Formats a release/publish date for display.
 *
 * Accepts a `Date` or an ISO-8601 string; returns an em dash for
 * `null`/`undefined` or an unparseable value. `Intl.DateTimeFormat` is used so
 * the output follows the user's locale, and no Node/Electron API is touched
 * (the renderer stays framework-free at this boundary).
 */
export function formatDate(value: Date | string | null | undefined): string {
  if (value == null) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date)
}
