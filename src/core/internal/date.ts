// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * Internal date helpers shared by the ported models.
 *
 * They mirror Dart's `DateTime.parse` / `DateTime.tryParse` split closely
 * enough for the wire formats handled by the core layer: a parseable ISO-8601
 * string becomes a `Date`, an unparseable one throws (like `DateTime.parse`),
 * and `null`/`undefined` stays `null`.
 */

/** Parses [value] as a date, throwing when it is not a valid date (Dart `DateTime.parse`). */
export function parseDate(value: string): Date {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`)
  }
  return parsed
}

/**
 * Parses an optional date value. Accepts an already-constructed `Date` (the
 * SQLite round trip can hand one back) or a string. Returns `null` for
 * `null`/`undefined`.
 */
export function parseDateOrNull(value: unknown): Date | null {
  if (value == null) return null
  if (value instanceof Date) return value
  return parseDate(String(value))
}

/** Parses a required date value, accepting a `Date` instance or a string. */
export function requireDate(value: unknown): Date {
  if (value instanceof Date) return value
  return parseDate(String(value))
}

/**
 * Formats [date] the way Dart's `DateTime.toIso8601String()` does for a *local*
 * `DateTime`: `YYYY-MM-DDTHH:mm:ss.mmm` with **no trailing `Z`** and no offset.
 *
 * This is the on-disk form the Flutter app writes into `apps.json`,
 * `deb_packages.json` and `settings.json`. JavaScript's `Date.toISOString()`
 * always emits a UTC `Z` form instead, which would shift every timestamp by the
 * local UTC offset on the next read, so the persistence layer must use this
 * formatter. `parseDate` already accepts both forms on the way back in.
 */
export function formatDartLocalIso(date: Date): string {
  const pad = (value: number, length = 2): string => String(value).padStart(length, '0')
  const year = pad(date.getFullYear(), 4)
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  const millis = pad(date.getMilliseconds(), 3)
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}`
}
