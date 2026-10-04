// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import type { JSX } from 'react'
import { Spinner } from './ui'

/**
 * Placeholder shown while a lazily-loaded dialog chunk is being fetched.
 *
 * Dialogs are modal and render in a portal, so the placeholder mirrors their
 * overlay footprint and announces itself through a live region.
 */
export function DialogFallback(): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim text-muted"
    >
      <Spinner />
    </div>
  )
}
