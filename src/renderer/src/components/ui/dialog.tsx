// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import {
  useEffect,
  useId,
  useRef,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@renderer/src/lib/cn'

const SIZE_CLASSES = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-2xl'
} as const

export type DialogSize = keyof typeof SIZE_CLASSES

export type DialogProps = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  /** Rendered in the footer, typically the action buttons. */
  footer?: ReactNode
  size?: DialogSize
  /** When false, Escape and backdrop clicks do not close the dialog. */
  dismissible?: boolean
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

/**
 * A modal dialog rendered in a portal.
 *
 * It moves focus onto the panel when it opens, contains Tab within the panel,
 * restores focus to the element that opened it on close, and closes on Escape
 * (when dismissible). The heading/description are wired to the panel with
 * `aria-labelledby`/`aria-describedby` using generated ids.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true
}: DialogProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => {
      const target = previouslyFocused.current
      if (target && typeof target.focus === 'function' && target.isConnected) {
        target.focus()
      }
    }
  }, [open])

  if (!open) return null

  const handleKeyDown = (event: ReactKeyboardEvent): void => {
    if (event.key === 'Escape') {
      if (dismissible) {
        event.stopPropagation()
        onClose()
      }
      return
    }
    if (event.key !== 'Tab') return

    const panel = panelRef.current
    if (!panel) return
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    if (focusables.length === 0) {
      event.preventDefault()
      panel.focus()
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    const inside = active instanceof HTMLElement && panel.contains(active)

    if (event.shiftKey) {
      if (!inside || active === first || active === panel) {
        event.preventDefault()
        last.focus()
      }
    } else if (!inside || active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onKeyDown={handleKeyDown}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-scrim"
        onClick={dismissible ? onClose : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-modal border border-border-strong bg-surface shadow-[var(--shadow)]',
          SIZE_CLASSES[size]
        )}
      >
        <header className="border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-sm font-semibold text-text-strong">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-0.5 text-xs text-muted">
              {description}
            </p>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
