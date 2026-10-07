// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'autopacx:theme'

/** Reads the persisted theme, defaulting to dark. */
export function resolveInitialTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'dark'
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'dark'
}

/** Applies a theme to the document root, which the token CSS keys off. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme
}

/** Dark/light theme state, applied to `<html>` and persisted to localStorage. */
export function useTheme(): {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
} {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }, [])

  return { theme, setTheme, toggleTheme }
}
