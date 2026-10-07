// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * Filters a pacstall index (a list of package names) by a free-text query.
 *
 * The match is a case-insensitive substring test and the input order is
 * preserved, so the result is deterministic. An empty (or whitespace-only)
 * query matches nothing, mirroring the UI's "no query, no list" behaviour.
 */
export function filterPacstallIndex(names: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return []
  return names.filter((name) => name.toLowerCase().includes(needle))
}
