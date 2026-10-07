// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import type { JSX } from 'react'
import { useActiveOperation } from '@renderer/src/hooks/use-ipc-events'

/** Human label for every progress event `method`. */
const METHOD_LABEL: Record<string, string> = {
  // Batch sweeps.
  batchInstall: 'Installing',
  batchDelete: 'Deleting',
  batchUpdate: 'Checking for updates',
  checkAllUpdates: 'Checking for updates',
  // Single operations.
  installApp: 'Installing',
  uninstallApp: 'Uninstalling',
  installDeb: 'Installing',
  uninstallDebPackage: 'Uninstalling',
  upgradeApp: 'Upgrading',
  checkAppUpdate: 'Checking for updates',
  checkDebUpdate: 'Checking for updates'
}

/**
 * Live progress for a running batch or single operation.
 *
 * Renders nothing when no operation is in flight. The bar is determinate when
 * the event carries a positive `total`, and an indeterminate pulsing bar
 * otherwise; either way it is a real `role="progressbar"` so assistive
 * technology can read the state.
 */
export function ProgressBanner(): JSX.Element | null {
  const active = useActiveOperation()

  if (active == null) return null

  const method = active.event.method
  const total = active.event.total
  const completed = active.event.completed
  const subject = active.kind === 'batch' ? active.event.currentOperation : active.event.name
  const detail = active.kind === 'operation' ? active.event.detail : undefined

  const label = METHOD_LABEL[method] ?? 'Working'
  const determinate = total > 0
  const percent = determinate ? Math.round((completed / total) * 100) : 0
  const ariaLabel = detail != null ? `${label}: ${subject} — ${detail}` : `${label}: ${subject}`

  return (
    <div
      role="progressbar"
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? total : undefined}
      aria-valuenow={determinate ? completed : undefined}
      aria-live="polite"
      aria-atomic="true"
      aria-label={ariaLabel}
      className="border-b border-border bg-accent-tint px-6 py-2"
    >
      <div className="flex items-center justify-between gap-3 text-xs text-secondary">
        <span className="truncate">
          {label}: <span className="text-text-strong">{subject}</span>
          {detail != null ? <span className="text-muted"> — {detail}</span> : null}
        </span>
        <span className="shrink-0 tabular-nums">
          {determinate ? `${completed}/${total}` : 'Working…'}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-pill bg-field">
        <div
          className={
            determinate
              ? 'h-full rounded-pill bg-accent-solid transition-[width]'
              : 'h-full w-full animate-pulse rounded-pill bg-accent-solid/60'
          }
          style={determinate ? { width: `${percent}%` } : undefined}
        />
      </div>
    </div>
  )
}
