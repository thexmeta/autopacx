// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useId, type ComponentPropsWithoutRef, type JSX, type ReactNode } from 'react'
import { cn } from '@renderer/src/lib/cn'

export type CheckboxProps = Omit<ComponentPropsWithoutRef<'input'>, 'type' | 'id'> & {
  label: ReactNode
  /** Optional secondary line, e.g. a short explanation. */
  description?: string
}

/**
 * A native checkbox with an explicit label. `indeterminate` is supported so a
 * "select all" control can reflect a partial selection.
 *
 * The input is nested in a 24×24px label so the click/tap target meets WCAG
 * 2.5.8 while the control itself stays visually 14px.
 */
export function Checkbox({ label, description, className, ...props }: CheckboxProps): JSX.Element {
  const id = useId()

  return (
    <div className={cn('flex items-start gap-2', className)}>
      <label
        htmlFor={id}
        className="flex min-h-6 min-w-6 shrink-0 cursor-pointer items-center justify-center"
      >
        <input
          id={id}
          type="checkbox"
          className="size-3.5 shrink-0 cursor-pointer accent-[var(--accent-solid)] disabled:cursor-not-allowed disabled:opacity-50"
          {...props}
        />
      </label>
      <label htmlFor={id} className="flex cursor-pointer flex-col text-xs text-text">
        <span>{label}</span>
        {description ? <span className="text-2xs text-faint">{description}</span> : null}
      </label>
    </div>
  )
}
