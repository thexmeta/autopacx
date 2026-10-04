// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import type { JSX, ReactNode } from 'react'

export type InfoRowProps = {
  label: string
  children: ReactNode
}

/** A label/value row used by the details dialogs. */
export function InfoRow({ label, children }: InfoRowProps): JSX.Element {
  return (
    <div className="flex gap-3 text-xs">
      <span className="w-28 shrink-0 font-semibold text-muted">{label}</span>
      <span className="min-w-0 flex-1 break-words text-text">{children}</span>
    </div>
  )
}
