// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useState, type JSX } from 'react'
import { Button, ConfirmDialog } from './ui'

export type BatchActionBarProps = {
  selectedCount: number
  totalCount: number
  busy?: boolean
  onSelectAll: () => void
  onDeselectAll: () => void
  onCheck: () => void
  onInstall: () => void
  onDelete: () => void
}

/**
 * Sticky action bar shown while multi-select is active.
 *
 * The "select all" control flips to "deselect all" once every visible row is
 * selected, matching `batch_action_bar.dart`. Batch delete is destructive, so
 * it is routed through a non-dismissible confirmation before `onDelete` fires.
 */
export function BatchActionBar({
  selectedCount,
  totalCount,
  busy = false,
  onSelectAll,
  onDeselectAll,
  onCheck,
  onInstall,
  onDelete
}: BatchActionBarProps): JSX.Element {
  const allSelected = totalCount > 0 && selectedCount === totalCount
  const noneSelected = selectedCount === 0
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <div className="border-t border-border bg-raised px-4 py-3">
      <p className="text-xs text-muted" aria-live="polite">
        {selectedCount} of {totalCount} selected
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="default" size="small" onClick={allSelected ? onDeselectAll : onSelectAll}>
          {allSelected ? 'Deselect all' : 'Select all'}
        </Button>
        <Button variant="default" size="small" disabled={noneSelected || busy} onClick={onCheck}>
          Check for updates
        </Button>
        <Button variant="primary" size="small" disabled={noneSelected || busy} onClick={onInstall}>
          Install
        </Button>
        <Button
          variant="danger"
          size="small"
          disabled={noneSelected || busy}
          onClick={() => setConfirmingDelete(true)}
        >
          Delete
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete selected"
        message={`Permanently delete ${selectedCount} selected item(s)? This cannot be undone.`}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() => {
          setConfirmingDelete(false)
          onDelete()
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  )
}
