// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import type { JSX, ReactNode } from 'react'
import { cn } from '@renderer/src/lib/cn'

const TONE_CLASSES = {
  neutral: 'bg-field text-secondary',
  accent: 'bg-accent-tint text-accent',
  success: 'bg-green/15 text-green',
  warning: 'bg-star/15 text-star',
  danger: 'bg-red/15 text-red'
} as const

export type BadgeTone = keyof typeof TONE_CLASSES

export type BadgeProps = {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}

/** A small, pill-shaped status label. */
export function Badge({ tone = 'neutral', className, children }: BadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide',
        TONE_CLASSES[tone],
        className
      )}
    >
      {children}
    </span>
  )
}
