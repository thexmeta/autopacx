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
import type { BatchProgressEvent, BatchUpdateResult, OperationProgressEvent } from '@core/index'

/**
 * The operation currently shown in the progress banner: either a batch sweep
 * or a single long-running install/uninstall/check, discriminated by `kind` so
 * the banner can read the right fields.
 */
export type ActiveOperation =
  | { readonly kind: 'batch'; readonly event: BatchProgressEvent }
  | { readonly kind: 'operation'; readonly event: OperationProgressEvent }

type IpcEventsValue = {
  /** The in-flight operation, or null when nothing is running. */
  readonly activeOperation: ActiveOperation | null
}

const IpcEventsContext = createContext<IpcEventsValue>({ activeOperation: null })

/**
 * Subscribes to the main process progress channel for the lifetime of the app
 * and exposes the latest {@link ActiveOperation}.
 *
 * Both event shapes travel on the same channel: a batch event carries no `kind`
 * and a single-operation event is tagged `kind: 'operation'`. The banner clears
 * itself once the batch has accounted for every item (`completed >= total`) or
 * a single operation reaches a terminal phase (`done`/`failed`), so a finished
 * operation does not leave a stale bar on screen.
 */
export function IpcEventsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [activeOperation, setActiveOperation] = useState<ActiveOperation | null>(null)

  useEffect(() => {
    const unsubscribe = window.autonex.onEvent((event) => {
      if ('kind' in event) {
        const terminal = event.phase === 'done' || event.phase === 'failed'
        setActiveOperation(terminal ? null : { kind: 'operation', event })
      } else {
        setActiveOperation(event.completed >= event.total ? null : { kind: 'batch', event })
      }
    })
    return unsubscribe
  }, [])

  const value = useMemo(() => ({ activeOperation }), [activeOperation])

  return <IpcEventsContext.Provider value={value}>{children}</IpcEventsContext.Provider>
}

/** The operation currently shown in the progress banner, if any. */
export function useActiveOperation(): ActiveOperation | null {
  return useContext(IpcEventsContext).activeOperation
}

/**
 * The number of tracked items swept by `checkAllUpdates`, counting all three
 * lanes (GitHub apps, deb packages and pacstall packages). The renderer's
 * "checked N items" summary uses this so a pacstall-only sweep is not
 * reported as zero.
 */
export function totalCheckedItems(
  result: Pick<BatchUpdateResult, 'apps' | 'debPackages' | 'pacstallPackages'>
): number {
  return result.apps.length + result.debPackages.length + result.pacstallPackages.length
}
