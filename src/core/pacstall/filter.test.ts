// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { filterPacstallIndex } from './filter'

const NAMES = ['neovim', 'Neovim-Nightly', 'nodejs', 'ripgrep', 'rg', 'vim'] as const

describe('filterPacstallIndex', () => {
  it('returns [] for an empty or whitespace-only query', () => {
    expect(filterPacstallIndex(NAMES, '')).toEqual([])
    expect(filterPacstallIndex(NAMES, '   ')).toEqual([])
  })

  it('matches a case-insensitive substring', () => {
    expect(filterPacstallIndex(NAMES, 'neo')).toEqual(['neovim', 'Neovim-Nightly'])
    expect(filterPacstallIndex(NAMES, 'NEO')).toEqual(['neovim', 'Neovim-Nightly'])
  })

  it('matches anywhere in the name, not just the prefix', () => {
    expect(filterPacstallIndex(NAMES, 'grep')).toEqual(['ripgrep'])
    expect(filterPacstallIndex(NAMES, 'vim')).toEqual(['neovim', 'Neovim-Nightly', 'vim'])
  })

  it('preserves the input order and returns [] when nothing matches', () => {
    expect(filterPacstallIndex(NAMES, 'o')).toEqual(['neovim', 'Neovim-Nightly', 'nodejs'])
    expect(filterPacstallIndex(NAMES, 'zzz')).toEqual([])
  })

  it('does not mutate the input', () => {
    const names = ['b', 'a']
    filterPacstallIndex(names, 'a')
    expect(names).toEqual(['b', 'a'])
  })
})
