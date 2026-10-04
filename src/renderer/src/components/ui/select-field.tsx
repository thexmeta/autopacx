// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useId, type ComponentPropsWithoutRef, type JSX } from 'react'
import { cn } from '@renderer/src/lib/cn'

export type SelectOption = { value: string; label: string }

export type SelectFieldProps = Omit<ComponentPropsWithoutRef<'select'>, 'id' | 'children'> & {
  label: string
  options: readonly SelectOption[]
  hint?: string
}

/** A labelled native `<select>`, styled with the design tokens. */
export function SelectField({
  label,
  options,
  hint,
  className,
  ...props
}: SelectFieldProps): JSX.Element {
  const id = useId()
  const hintId = `${id}-hint`

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-secondary">
        {label}
      </label>
      <select
        id={id}
        aria-describedby={hint ? hintId : undefined}
        className={cn(
          'h-8 rounded-field border border-border-strong bg-field px-2 text-sm text-text',
          'focus-visible:border-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={hintId} className="text-2xs text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
