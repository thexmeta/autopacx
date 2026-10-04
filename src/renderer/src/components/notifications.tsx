// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/* eslint-disable react-refresh/only-export-components -- the provider, its
   accessor hook and the viewport are intentionally co-located. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode
} from 'react'
import { cn } from '@renderer/src/lib/cn'

export type NotificationTone = 'error' | 'warning' | 'success' | 'info'

export type AppNotification = {
  id: number
  tone: NotificationTone
  message: string
}

export type NotifyInput = {
  tone?: NotificationTone
  message: string
}

type NotificationsContextValue = {
  notifications: AppNotification[]
  notify: (input: NotifyInput) => void
  dismiss: (id: number) => void
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null)

const TONE_CLASSES: Record<NotificationTone, string> = {
  error: 'border-red/40 bg-red/15 text-red',
  warning: 'border-star/40 bg-star/15 text-star',
  success: 'border-green/40 bg-green/15 text-green',
  info: 'border-border-strong bg-raised text-text'
}

const TONE_ICON: Record<NotificationTone, string> = {
  error: '!',
  warning: '!',
  success: '✓',
  info: 'i'
}

/** Success/info notices are transient; error/warning stay until dismissed. */
const AUTO_DISMISS_MS = 5000

/**
 * Holds the application notification queue.
 *
 * Success and info notices auto-dismiss after a short timeout so the stack
 * cannot grow unbounded, while error and warning notices stay persistent so
 * long diagnostic dumps — apt output with unmet dependencies, batch summaries —
 * remain readable until the user closes them, mirroring `error_snack.dart`.
 */
export function NotificationsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const nextId = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setNotifications((current) => current.filter((entry) => entry.id !== id))
  }, [])

  const notify = useCallback(
    (input: NotifyInput) => {
      const id = nextId.current++
      const tone = input.tone ?? 'info'
      setNotifications((current) => [...current, { id, tone, message: input.message }])
      if (tone === 'success' || tone === 'info') {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
        )
      }
    },
    [dismiss]
  )

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const value = useMemo(
    () => ({ notifications, notify, dismiss }),
    [notifications, notify, dismiss]
  )

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

/** Access the notification queue. Throws when used outside the provider. */
export function useNotifications(): NotificationsContextValue {
  const value = useContext(NotificationsContext)
  if (!value) throw new Error('useNotifications must be used within a NotificationsProvider')
  return value
}

/** The persistent notification stack, pinned to the bottom-right corner. */
export function NotificationViewport(): JSX.Element {
  const { notifications, dismiss } = useNotifications()

  if (notifications.length === 0) return <></>

  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-end gap-2 p-4"
    >
      {notifications.map((entry) => (
        <div
          key={entry.id}
          role={entry.tone === 'error' || entry.tone === 'warning' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-dropdown border px-3 py-2 text-xs shadow-lg',
            TONE_CLASSES[entry.tone]
          )}
        >
          <span aria-hidden="true" className="mt-px font-bold">
            {TONE_ICON[entry.tone]}
          </span>
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{entry.message}</p>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => dismiss(entry.id)}
            className="shrink-0 rounded-field px-1 text-current opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
