// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { formatDate } from './format-date'

describe('formatDate', () => {
  it('renders an em dash for null and undefined', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate(undefined)).toBe('—')
  })

  it('renders an em dash for an unparseable value', () => {
    expect(formatDate('not-a-date')).toBe('—')
  })

  it('formats a Date to a non-empty string', () => {
    const formatted = formatDate(new Date('2026-03-04T00:00:00Z'))
    expect(formatted).not.toBe('—')
    expect(formatted.length).toBeGreaterThan(0)
  })

  it('formats an ISO-8601 string the same way as the equivalent Date', () => {
    const iso = '2026-03-04T12:30:00.000Z'
    expect(formatDate(iso)).toBe(formatDate(new Date(iso)))
  })
})
