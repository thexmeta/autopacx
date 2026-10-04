// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import type { JSX, ReactNode } from 'react'
import { cn } from '@renderer/src/lib/cn'

export type EmptyStateProps = {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
  className?: string
}

/** Centred placeholder shown when a list has no rows. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center',
        className
      )}
    >
      {icon ? <div className="text-faint">{icon}</div> : null}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-text-strong">{title}</p>
        {description ? <p className="text-xs text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}
