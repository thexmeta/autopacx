// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { type JSX } from 'react'

export type SearchFieldProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Accessible name for the input; defaults to "Search". */
  label?: string
}

/**
 * A compact search input with a clear button.
 *
 * `type="search"` already exposes the implicit `searchbox` role, so no explicit
 * role is needed. The clear button is at least 24×24px (WCAG 2.5.8) while the
 * field keeps its 32px height.
 */
export function SearchField({
  value,
  onChange,
  placeholder = 'Search',
  label = 'Search'
}: SearchFieldProps): JSX.Element {
  return (
    <div className="relative flex-1">
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-field border border-border-strong bg-field px-2 pr-7 text-sm text-text placeholder:text-faint focus-visible:border-accent"
      />
      {value.length > 0 ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-1 top-1/2 inline-flex min-h-6 min-w-6 -translate-y-1/2 items-center justify-center rounded-field text-xs text-muted hover:text-text"
        >
          ✕
        </button>
      ) : null}
    </div>
  )
}
