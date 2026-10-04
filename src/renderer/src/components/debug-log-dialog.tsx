// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useState, type JSX } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNotifications } from './notifications'
import { Button, Dialog, Spinner } from './ui'

export type DebugLogDialogProps = {
  open: boolean
  onClose: () => void
}

/**
 * Read-only viewer for the main-process debug log.
 *
 * The renderer never touches the filesystem: it asks the main process for a
 * tail of the log through `getDebugLog`, renders it in a monospace, scrollable
 * panel, and can clear it through `clearDebugLog`. Mirrors the Dart viewer in
 * `lib/ui/home_screen.dart` (`_showDebugLog`).
 */
export function DebugLogDialog({ open, onClose }: DebugLogDialogProps): JSX.Element {
  const queryClient = useQueryClient()
  const { notify } = useNotifications()
  const [clearing, setClearing] = useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['debugLog'],
    queryFn: () => window.autonex.getDebugLog(),
    enabled: open
  })

  async function handleClear(): Promise<void> {
    setClearing(true)
    try {
      await window.autonex.clearDebugLog()
      await queryClient.invalidateQueries({ queryKey: ['debugLog'] })
      notify({ tone: 'success', message: 'Debug log cleared.' })
    } catch (clearError) {
      notify({
        tone: 'error',
        message: `Clear debug log failed: ${
          clearError instanceof Error ? clearError.message : String(clearError)
        }`
      })
    } finally {
      setClearing(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Debug log"
      description="Most recent diagnostic output from the main process."
      size="lg"
      footer={
        <>
          <Button
            variant="default"
            size="small"
            disabled={clearing}
            onClick={() => void handleClear()}
          >
            {clearing ? 'Clearing…' : 'Clear log'}
          </Button>
          <Button
            variant="default"
            size="small"
            disabled={isPending}
            onClick={() => void refetch()}
          >
            Refresh
          </Button>
          <Button variant="ghost" size="small" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {isPending ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 py-8 text-sm text-muted"
        >
          <Spinner />
          <span>Loading log…</span>
        </div>
      ) : isError ? (
        <p role="alert" className="py-4 text-xs text-red">
          {error?.message ?? 'Could not read the debug log.'}
        </p>
      ) : (
        <div className="space-y-2">
          {data?.truncated ? (
            <p className="text-2xs italic text-muted">
              Showing the most recent portion of the log.
            </p>
          ) : null}
          <pre
            data-testid="debug-log-content"
            className="max-h-[55vh] overflow-auto rounded-field border border-border-strong bg-field p-2 font-mono text-2xs leading-relaxed text-text"
          >
            {data?.content != null && data.content.length > 0
              ? data.content
              : 'The debug log is empty.'}
          </pre>
        </div>
      )}
    </Dialog>
  )
}
