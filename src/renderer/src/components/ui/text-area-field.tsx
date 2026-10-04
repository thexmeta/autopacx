// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useId, type ComponentPropsWithoutRef, type JSX, type ReactNode } from 'react'
import { cn } from '@renderer/src/lib/cn'

export type TextAreaFieldProps = Omit<ComponentPropsWithoutRef<'textarea'>, 'id'> & {
  label: string
  hint?: string
  error?: string
  labelAddon?: ReactNode
}

/** Multi-line variant of {@link TextField}, used for diagnostic output. */
export function TextAreaField({
  label,
  hint,
  error,
  labelAddon,
  className,
  rows = 4,
  ...props
}: TextAreaFieldProps): JSX.Element {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = error ? errorId : hint ? hintId : undefined

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-center gap-2 text-xs font-medium text-secondary">
        {label}
        {labelAddon}
      </label>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'rounded-field border border-border-strong bg-field px-2 py-1 font-mono text-xs text-text',
          'placeholder:text-faint focus-visible:border-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-red',
          className
        )}
        {...props}
      />
      {error ? (
        <p id={errorId} className="text-2xs text-red">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-2xs text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
