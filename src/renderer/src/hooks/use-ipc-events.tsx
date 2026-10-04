// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

/* eslint-disable react-refresh/only-export-components -- the provider and its
   accessor hook are intentionally co-located. */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode
} from 'react'
import type { BatchProgressEvent } from '@core/index'

type IpcEventsValue = {
  /** Latest in-flight batch progress, or null when no batch is running. */
  progress: BatchProgressEvent | null
}

const IpcEventsContext = createContext<IpcEventsValue>({ progress: null })

/**
 * Subscribes to the main process progress channel for the lifetime of the app
 * and exposes the latest {@link BatchProgressEvent}.
 *
 * The banner clears itself once every item is accounted for, so a finished
 * batch does not leave a stale progress bar on screen.
 */
export function IpcEventsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [progress, setProgress] = useState<BatchProgressEvent | null>(null)

  useEffect(() => {
    const unsubscribe = window.autonex.onEvent((event) => {
      setProgress(event.completed >= event.total ? null : event)
    })
    return unsubscribe
  }, [])

  const value = useMemo(() => ({ progress }), [progress])

  return <IpcEventsContext.Provider value={value}>{children}</IpcEventsContext.Provider>
}

/** The latest batch progress, if any. */
export function useBatchProgress(): BatchProgressEvent | null {
  return useContext(IpcEventsContext).progress
}
