// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { parseRepoSearch } from './repo-search'

const GOOD = {
  total_count: 2,
  incomplete_results: false,
  items: [
    {
      full_name: 'owner/one',
      description: 'first repo',
      stargazers_count: 42,
      language: 'TypeScript',
      license: { spdx_id: 'MIT', name: 'MIT License' },
      default_branch: 'main',
      html_url: 'https://github.com/owner/one',
      updated_at: '2026-01-01T00:00:00Z'
    },
    {
      full_name: 'owner/two',
      description: null,
      stargazers_count: 0,
      language: null,
      license: null,
      default_branch: 'master',
      html_url: 'https://github.com/owner/two',
      updated_at: '2026-02-01T00:00:00Z'
    }
  ]
}

describe('parseRepoSearch — good payload', () => {
  it('reads the envelope and every item field', () => {
    const result = parseRepoSearch(GOOD)
    expect(result.total_count).toBe(2)
    expect(result.incomplete_results).toBe(false)
    expect(result.items).toHaveLength(2)

    const [first, second] = result.items
    expect(first.full_name).toBe('owner/one')
    expect(first.description).toBe('first repo')
    expect(first.stargazers_count).toBe(42)
    expect(first.language).toBe('TypeScript')
    expect(first.license).toEqual({ spdx_id: 'MIT', name: 'MIT License' })
    expect(first.default_branch).toBe('main')
    expect(first.html_url).toBe('https://github.com/owner/one')
    expect(first.updated_at).toBe('2026-01-01T00:00:00Z')

    expect(second.description).toBeNull()
    expect(second.language).toBeNull()
    expect(second.license).toBeNull()
  })
})

describe('parseRepoSearch — malformed input', () => {
  it('skips non-object items and items with wrong-typed fields', () => {
    const result = parseRepoSearch({
      total_count: 4,
      incomplete_results: true,
      items: [
        GOOD.items[0],
        null,
        'nope',
        ['array'],
        { full_name: 'bad/type', stargazers_count: 'lots' },
        { full_name: 'bad/license', license: 'MIT' }
      ]
    })
    expect(result.total_count).toBe(4)
    expect(result.incomplete_results).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].full_name).toBe('owner/one')
  })

  it('returns empty defaults when the top-level payload is not an object', () => {
    for (const payload of [null, undefined, 42, 'text', [], true]) {
      const result = parseRepoSearch(payload)
      expect(result).toEqual({ total_count: 0, incomplete_results: false, items: [] })
    }
  })

  it('coerces missing envelope fields to their defaults', () => {
    expect(parseRepoSearch({})).toEqual({
      total_count: 0,
      incomplete_results: false,
      items: []
    })
    expect(parseRepoSearch({ items: 'not-an-array' }).items).toEqual([])
  })

  it('coerces absent item fields leniently', () => {
    const result = parseRepoSearch({ items: [{ full_name: 'owner/three' }] })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual({
      full_name: 'owner/three',
      description: null,
      stargazers_count: 0,
      language: null,
      license: null,
      default_branch: '',
      html_url: '',
      updated_at: ''
    })
  })
})
