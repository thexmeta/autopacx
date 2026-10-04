// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import type { JSX } from 'react'
import { Button } from './button'
import { Dialog } from './dialog'

export type ConfirmDialogProps = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A non-dismissible confirmation prompt for destructive actions.
 *
 * Backdrop clicks and Escape are ignored (`dismissible={false}`), so the only
 * ways out are the explicit Cancel or Confirm buttons. This is what routes
 * Uninstall/Delete through a deliberate second step before mutating.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): JSX.Element | null {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      dismissible={false}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-xs text-text">{message}</p>
    </Dialog>
  )
}
