// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useId, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { cn } from '@renderer/src/lib/cn'

export type SegmentedControlOption<T extends string> = {
  value: T
  label: string
}

export type SegmentedControlProps<T extends string> = {
  options: readonly SegmentedControlOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name for the radio group. */
  ariaLabel: string
  className?: string
}

/**
 * A two-or-more-mode switch rendered as an ARIA radio group.
 *
 * It is a single-choice filter (not a tab set that owns panels), so the
 * `radiogroup` pattern fits: every option exposes `role="radio"` and
 * `aria-checked`, only the checked one is in the tab order (roving tabindex),
 * and the arrow keys plus Home/End move the selection (selection follows
 * focus). All colours come from the design tokens so both themes stay legible
 * and the focus ring is the shared `:focus-visible` outline.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className
}: SegmentedControlProps<T>): JSX.Element {
  const baseId = useId()

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = options.length - 1
    let nextIndex: number
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = index === last ? 0 : index + 1
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = index === 0 ? last : index - 1
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = last
        break
      default:
        return
    }
    event.preventDefault()
    const next = options[nextIndex]
    if (next == null) return
    onChange(next.value)
    // Selection follows focus: move focus to the newly checked radio.
    document.getElementById(`${baseId}-${next.value}`)?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex rounded-field border border-border-strong bg-field p-0.5',
        className
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            id={`${baseId}-${option.value}`}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'rounded-field px-3 py-1 text-xs font-medium transition-colors',
              selected ? 'bg-accent-solid text-on-accent' : 'text-secondary hover:text-text'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
