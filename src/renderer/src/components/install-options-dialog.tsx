// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useState, type JSX } from 'react'
import type { InstallOptions } from '@core/index'
import type { TrackedApp } from '@core/models/tracked-app'
import { executableName } from '@renderer/src/lib/install-options'
import { Button, Dialog, TextField } from './ui'

export type InstallOptionsDialogProps = {
  app: TrackedApp
  busy: boolean
  onCancel: () => void
  onConfirm: (options: InstallOptions) => void
}

/**
 * Collects the destination for a raw-binary install, ported from the
 * `chooseInstallTarget` path in `lib/ui/upgrade_flow.dart`.
 *
 * Only a binary install needs a target; the binary name defaults to the app's
 * executable name so an archive's payload can be selected. Leaving the path
 * blank lets the main process use its default (`~/.local/bin/<name>`), which
 * keeps the "install latest" behaviour when nothing is entered.
 *
 * The parent mounts this only while it is open, so the initial field values are
 * derived once from the app without a reset effect.
 */
export function InstallOptionsDialog({
  app,
  busy,
  onCancel,
  onConfirm
}: InstallOptionsDialogProps): JSX.Element {
  const [targetPath, setTargetPath] = useState('')
  const [binaryName, setBinaryName] = useState(() => executableName(app))
  const [pathError, setPathError] = useState<string | undefined>(undefined)

  function handleConfirm(): void {
    const trimmedPath = targetPath.trim()
    if (trimmedPath.length > 0 && !trimmedPath.startsWith('/')) {
      setPathError('Install path must be absolute')
      return
    }
    setPathError(undefined)
    onConfirm({
      targetPath: trimmedPath.length > 0 ? trimmedPath : null,
      binaryName: binaryName.trim().length > 0 ? binaryName.trim() : null
    })
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      title={`Install ${app.displayName}`}
      description="Choose where the binary is installed."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirm} disabled={busy}>
            {busy ? 'Installing…' : 'Install'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <TextField
          label="Install path"
          hint="Absolute path; leave blank for ~/.local/bin/<name>"
          placeholder="/usr/local/bin/my-app"
          value={targetPath}
          error={pathError}
          onChange={(event) => {
            setTargetPath(event.target.value)
            if (pathError) setPathError(undefined)
          }}
        />
        <TextField
          label="Binary name"
          hint="Executable to select from an archive and install as"
          value={binaryName}
          onChange={(event) => setBinaryName(event.target.value)}
        />
      </div>
    </Dialog>
  )
}
