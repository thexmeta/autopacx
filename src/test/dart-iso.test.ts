// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { formatDartLocalIso, parseDate } from '@core/internal/date'

describe('formatDartLocalIso', () => {
  it('emits a local ISO string with no trailing Z (Dart DateTime.toIso8601String)', () => {
    const date = new Date(2026, 9, 4, 0, 17, 23, 456)

    const formatted = formatDartLocalIso(date)

    expect(formatted).toBe('2026-10-04T00:17:23.456')
    expect(formatted).not.toMatch(/Z$/)
  })

  it('round-trips through parseDate preserving the instant', () => {
    const date = new Date(2026, 9, 4, 0, 17, 23, 456)

    expect(parseDate(formatDartLocalIso(date)).getTime()).toBe(date.getTime())
  })

  it('zero-pads every field', () => {
    const date = new Date(2026, 0, 2, 3, 4, 5, 6)

    expect(formatDartLocalIso(date)).toBe('2026-01-02T03:04:05.006')
  })
})
