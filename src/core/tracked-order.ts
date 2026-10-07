// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/**
 * Shared ordering and filtering helpers for tracked items.
 *
 * This module is part of the framework-free core: it imports nothing from
 * Electron, Node.js or the DOM.
 */

/** The minimal shape needed to order a tracked item by its display name. */
export interface NamedItem {
  readonly displayName: string
}

/**
 * Orders two tracked items by display name, case-insensitively.
 *
 * The primary comparison uses `localeCompare` with `sensitivity: 'base'`, so
 * `Android`, `android` and `ANDROID` sort together and case never splits the
 * list into two groups (the Apps-view bug: a plain `<`/`>` comparison sorts by
 * UTF-16 code unit, which places every capitalised name before every
 * lower-case one).
 *
 * A deterministic tiebreak resolves names that are equal under the base
 * comparison (identical, or differing only in case) so the sort is stable and
 * reproducible.
 */
export function compareByName(a: NamedItem, b: NamedItem): number {
  const primary = a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
  if (primary !== 0) return primary
  // Case-only (or identical) difference: fall back to a total order on the raw
  // strings so the result never depends on the input order.
  return a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0
}

/** The list filters exposed by the Apps / packages view. */
export type ItemFilter = 'all' | 'installed' | 'updates'

/** How {@link applyFilter} decides whether an item is installed / updatable. */
export interface FilterPredicates<T> {
  readonly isInstalled: (item: T) => boolean
  readonly hasUpdate: (item: T) => boolean
}

/**
 * Applies a list filter, preserving the input order.
 *
 * `all` returns a shallow copy of every item, `installed` keeps items the
 * predicate reports as installed, and `updates` keeps items with a pending
 * update. The input array is never mutated.
 */
export function applyFilter<T>(
  items: readonly T[],
  filter: ItemFilter,
  predicates: FilterPredicates<T>
): T[] {
  if (filter === 'installed') return items.filter((item) => predicates.isInstalled(item))
  if (filter === 'updates') return items.filter((item) => predicates.hasUpdate(item))
  return [...items]
}
