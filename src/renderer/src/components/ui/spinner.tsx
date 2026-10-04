// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import type { JSX } from 'react'
import { cn } from '@renderer/src/lib/cn'

export type SpinnerProps = {
  className?: string
}

/**
 * An indeterminate loading indicator that inherits the current text colour.
 * It is decorative: the surrounding live region owns the announced status
 * text, so the spinner itself is hidden from assistive technology.
 */
export function Spinner({ className }: SpinnerProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none',
        className
      )}
    />
  )
}
