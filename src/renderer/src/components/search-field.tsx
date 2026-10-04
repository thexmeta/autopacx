// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { type JSX } from 'react'

export type SearchFieldProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

/** A compact search input with a clear button. */
export function SearchField({
  value,
  onChange,
  placeholder = 'Search'
}: SearchFieldProps): JSX.Element {
  return (
    <div className="relative flex-1">
      <input
        type="search"
        role="searchbox"
        aria-label="Search"
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
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-field px-1.5 text-xs text-muted hover:text-text"
        >
          ✕
        </button>
      ) : null}
    </div>
  )
}
