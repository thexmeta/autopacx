// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { applyFilter, compareByName, type ItemFilter } from './tracked-order'

interface Row {
  readonly displayName: string
  readonly installed: boolean
  readonly hasUpdate: boolean
}

function row(displayName: string, installed = false, hasUpdate = false): Row {
  return { displayName, installed, hasUpdate }
}

const predicates = {
  isInstalled: (item: Row): boolean => item.installed,
  hasUpdate: (item: Row): boolean => item.hasUpdate
}

describe('compareByName', () => {
  it('orders names case-insensitively, interleaving upper and lower case', () => {
    // This is the item 3b regression: a case-sensitive (ASCII) sort groups the
    // capitalised names before the lower-case ones.
    const input = [
      'Zettlr',
      'AyuGram Desktop',
      'biome',
      'Android Messages Desktop',
      'waveterm',
      'beekeeper-studio'
    ]

    const sorted = [...input].sort((a, b) => compareByName({ displayName: a }, { displayName: b }))

    expect(sorted).toEqual([
      'Android Messages Desktop',
      'AyuGram Desktop',
      'beekeeper-studio',
      'biome',
      'waveterm',
      'Zettlr'
    ])
  })

  it('ignores case when comparing', () => {
    expect(compareByName({ displayName: 'alpha' }, { displayName: 'BETA' })).toBeLessThan(0)
    expect(compareByName({ displayName: 'BETA' }, { displayName: 'alpha' })).toBeGreaterThan(0)
  })

  it('uses a deterministic tiebreak for a case-only difference', () => {
    // Same base letter sequence, so the primary comparison is equal; the
    // tiebreak must still give a stable, non-zero ordering.
    const result = compareByName({ displayName: 'alpha' }, { displayName: 'Alpha' })
    expect(result).not.toBe(0)
    expect(compareByName({ displayName: 'Alpha' }, { displayName: 'alpha' })).toBe(-result)
  })

  it('returns zero for identical names', () => {
    expect(compareByName({ displayName: 'Same' }, { displayName: 'Same' })).toBe(0)
  })
})

describe('applyFilter', () => {
  const items = [
    row('Installed and stale', true, true),
    row('Installed only', true, false),
    row('Update only', false, true),
    row('Neither', false, false)
  ]

  it('returns every item for the all filter', () => {
    expect(applyFilter(items, 'all', predicates)).toEqual(items)
  })

  it('keeps only installed items for the installed filter', () => {
    expect(applyFilter(items, 'installed', predicates).map((item) => item.displayName)).toEqual([
      'Installed and stale',
      'Installed only'
    ])
  })

  it('keeps only items with an update for the updates filter', () => {
    expect(applyFilter(items, 'updates', predicates).map((item) => item.displayName)).toEqual([
      'Installed and stale',
      'Update only'
    ])
  })

  it('does not mutate the input array', () => {
    const before = [...items]
    applyFilter(items, 'installed', predicates)
    expect(items).toEqual(before)
  })

  it('preserves input order', () => {
    const reversed = [...items].reverse()
    const filters: ItemFilter[] = ['all', 'installed', 'updates']
    for (const filter of filters) {
      const result = applyFilter(reversed, filter, predicates)
      expect(result).toEqual(
        reversed.filter((item) => applyFilter([item], filter, predicates).length > 0)
      )
    }
  })
})
