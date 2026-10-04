// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import type { JSX } from 'react'
import { useBatchProgress } from '@renderer/src/hooks/use-ipc-events'

const METHOD_LABEL: Record<string, string> = {
  batchInstall: 'Installing',
  batchDelete: 'Deleting',
  batchUpdate: 'Checking for updates',
  checkAllUpdates: 'Checking for updates'
}

/**
 * Live progress for a running batch operation.
 *
 * Renders nothing when no batch is in flight. The bar is a real
 * `role="progressbar"` so assistive technology can read the completion state.
 */
export function ProgressBanner(): JSX.Element | null {
  const progress = useBatchProgress()

  if (!progress) return null

  const percent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0
  const label = METHOD_LABEL[progress.method] ?? 'Working'

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={progress.total}
      aria-valuenow={progress.completed}
      aria-live="polite"
      aria-atomic="true"
      aria-label={`${label}: ${progress.currentOperation}`}
      className="border-b border-border bg-accent-tint px-6 py-2"
    >
      <div className="flex items-center justify-between gap-3 text-xs text-secondary">
        <span className="truncate">
          {label}: <span className="text-text-strong">{progress.currentOperation}</span>
        </span>
        <span className="shrink-0 tabular-nums">
          {progress.completed}/{progress.total}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-pill bg-field">
        <div
          className="h-full rounded-pill bg-accent-solid transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
