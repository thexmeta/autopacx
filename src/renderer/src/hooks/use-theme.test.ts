// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useTheme } from './use-theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.dataset['theme'] = ''
})

afterEach(() => {
  localStorage.clear()
})

describe('useTheme', () => {
  it('defaults to dark and applies it to the document root', () => {
    renderHook(() => useTheme())

    expect(document.documentElement.dataset['theme']).toBe('dark')
  })

  it('toggles to light, applies it and persists it', () => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.toggleTheme())

    expect(result.current.theme).toBe('light')
    expect(document.documentElement.dataset['theme']).toBe('light')
    expect(localStorage.getItem('autonex:theme')).toBe('light')
  })

  it('restores a persisted theme on mount', () => {
    localStorage.setItem('autonex:theme', 'light')

    renderHook(() => useTheme())

    expect(document.documentElement.dataset['theme']).toBe('light')
  })
})
