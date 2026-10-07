// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { formatRepoReference, parseRepoReference } from './repo-reference'

describe('parseRepoReference', () => {
  it('parses a bare owner/repo slug', () => {
    expect(parseRepoReference('owner/repo')).toEqual({ owner: 'owner', name: 'repo' })
  })

  it('parses a full https GitHub URL', () => {
    expect(parseRepoReference('https://github.com/owner/repo')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
  })

  it('tolerates a trailing slash', () => {
    expect(parseRepoReference('https://github.com/owner/repo/')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
    expect(parseRepoReference('owner/repo/')).toEqual({ owner: 'owner', name: 'repo' })
  })

  it('strips a trailing .git suffix', () => {
    expect(parseRepoReference('owner/repo.git')).toEqual({ owner: 'owner', name: 'repo' })
    expect(parseRepoReference('https://github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
  })

  it('ignores a query string and fragment', () => {
    expect(parseRepoReference('https://github.com/owner/repo?tab=readme')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
    expect(parseRepoReference('https://github.com/owner/repo#readme')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
    expect(parseRepoReference('owner/repo?x=1#y')).toEqual({ owner: 'owner', name: 'repo' })
  })

  it('accepts a /releases path and a /releases/tag/<x> path', () => {
    expect(parseRepoReference('https://github.com/owner/repo/releases')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
    expect(parseRepoReference('https://github.com/owner/repo/releases/tag/v1.2.3')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
    expect(parseRepoReference('owner/repo/releases/tag/v1.2.3')).toEqual({
      owner: 'owner',
      name: 'repo'
    })
  })

  it('trims surrounding whitespace before parsing', () => {
    expect(parseRepoReference('  owner/repo  ')).toEqual({ owner: 'owner', name: 'repo' })
  })

  it('collapses empty path segments', () => {
    expect(parseRepoReference('owner//repo')).toEqual({ owner: 'owner', name: 'repo' })
  })

  it('rejects a non-GitHub host', () => {
    expect(parseRepoReference('https://gitlab.com/owner/repo')).toBeNull()
  })

  it('rejects an empty or whitespace-only input', () => {
    expect(parseRepoReference('')).toBeNull()
    expect(parseRepoReference('   ')).toBeNull()
  })

  it('rejects an input without both owner and name', () => {
    expect(parseRepoReference('owner')).toBeNull()
    expect(parseRepoReference('/releases')).toBeNull()
    expect(parseRepoReference('https://github.com/owner')).toBeNull()
  })

  it('rejects a part containing whitespace or illegal characters', () => {
    expect(parseRepoReference('own er/repo')).toBeNull()
    expect(parseRepoReference('owner/re po')).toBeNull()
    expect(parseRepoReference('owner/repo!')).toBeNull()
  })

  it('returns the first two segments for a deeper path', () => {
    expect(parseRepoReference('owner/repo/issues/5')).toEqual({ owner: 'owner', name: 'repo' })
  })
})

describe('formatRepoReference', () => {
  it('joins owner and name with a slash', () => {
    expect(formatRepoReference('owner', 'repo')).toBe('owner/repo')
  })

  it('round-trips through parseRepoReference', () => {
    const formatted = formatRepoReference('thexmeta', 'autopacx')
    expect(parseRepoReference(formatted)).toEqual({ owner: 'thexmeta', name: 'autopacx' })
  })
})
