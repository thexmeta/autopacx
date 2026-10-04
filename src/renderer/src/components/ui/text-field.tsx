// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useId, type ComponentPropsWithoutRef, type JSX, type ReactNode } from 'react'
import { cn } from '@renderer/src/lib/cn'

export type TextFieldProps = Omit<ComponentPropsWithoutRef<'input'>, 'id'> & {
  label: string
  /** Static helper text shown below the control. */
  hint?: string
  /** Validation error; when set it replaces the hint and marks the field invalid. */
  error?: string
  /** Rendered after the label, e.g. a "required" affordance. */
  labelAddon?: ReactNode
}

/**
 * A labelled text input built from a native `<input>` so it keeps full keyboard
 * and assistive-technology semantics. The label, hint and error are wired to the
 * control with `aria-describedby`/`aria-invalid`.
 */
export function TextField({
  label,
  hint,
  error,
  labelAddon,
  className,
  ...props
}: TextFieldProps): JSX.Element {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = error ? errorId : hint ? hintId : undefined

  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-2 text-xs font-medium text-secondary">
        <label htmlFor={id}>{label}</label>
        {labelAddon}
      </span>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'h-8 rounded-field border border-border-strong bg-field px-2 text-sm text-text',
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
