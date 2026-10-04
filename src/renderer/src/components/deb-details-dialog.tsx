// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useState, type JSX } from 'react'
import type { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { useActions } from '@renderer/src/hooks/use-actions'
import { useNotifications } from './notifications'
import { InfoRow } from './info-row'
import { Badge, Button, ConfirmDialog, Dialog } from './ui'

export type DebDetailsDialogProps = {
  open: boolean
  pkg: TrackedDebPackage | null
  onClose: () => void
}

/** Read-only deb details plus install/uninstall/check actions. */
export function DebDetailsDialog({
  open,
  pkg,
  onClose
}: DebDetailsDialogProps): JSX.Element | null {
  const { installDeb, uninstallDeb, checkDebUpdate, launchDeb } = useActions()
  const { notify } = useNotifications()
  const [confirmingUninstall, setConfirmingUninstall] = useState(false)

  if (!open || pkg == null) return null

  const busy =
    installDeb.isPending ||
    uninstallDeb.isPending ||
    checkDebUpdate.isPending ||
    launchDeb.isPending

  async function run(action: 'install' | 'uninstall' | 'check' | 'launch'): Promise<void> {
    if (pkg == null) return
    try {
      if (action === 'install') {
        await installDeb.mutateAsync(pkg)
        notify({ tone: 'success', message: `${pkg.effectiveDisplayName} installed.` })
      } else if (action === 'uninstall') {
        await uninstallDeb.mutateAsync(pkg)
        notify({ tone: 'success', message: `${pkg.effectiveDisplayName} uninstalled.` })
      } else if (action === 'launch') {
        await launchDeb.mutateAsync(pkg)
      } else {
        await checkDebUpdate.mutateAsync(pkg)
        notify({ tone: 'info', message: `Checked ${pkg.effectiveDisplayName} for updates.` })
      }
    } catch {
      // The mutation's onError already raised a persistent notification.
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={pkg.effectiveDisplayName}
        description={pkg.name}
        size="md"
        footer={
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        }
      >
        <div className="space-y-2">
          <InfoRow label="URL">
            <span className="break-all">{pkg.packageUrl}</span>
          </InfoRow>
          <InfoRow label="Installed">{pkg.installedVersion ?? 'Not installed'}</InfoRow>
          <InfoRow label="Latest">{pkg.latestVersion ?? 'Unknown'}</InfoRow>
          <InfoRow label="Update status">
            {pkg.hasUpdate ? <Badge tone="warning">Update available</Badge> : 'Up to date'}
          </InfoRow>
          {pkg.fileSize ? <InfoRow label="File size">{pkg.fileSize}</InfoRow> : null}
          {pkg.fileDate ? (
            <InfoRow label="File date">{pkg.fileDate.toLocaleString()}</InfoRow>
          ) : null}
          {pkg.lastChecked ? (
            <InfoRow label="Last checked">{pkg.lastChecked.toLocaleString()}</InfoRow>
          ) : null}
          <InfoRow label="Auto-update check">
            {pkg.autoUpdate ? 'On (preference only, no scheduler)' : 'Off'}
          </InfoRow>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {!pkg.installedVersion ? (
            <Button variant="primary" disabled={busy} onClick={() => void run('install')}>
              {installDeb.isPending ? 'Installing…' : 'Install'}
            </Button>
          ) : null}
          {pkg.installedVersion && pkg.hasUpdate ? (
            <Button variant="primary" disabled={busy} onClick={() => void run('install')}>
              {installDeb.isPending ? 'Upgrading…' : 'Upgrade to latest'}
            </Button>
          ) : null}
          {pkg.installedVersion ? (
            <>
              <Button variant="default" disabled={busy} onClick={() => void run('launch')}>
                {launchDeb.isPending ? 'Launching…' : 'Launch'}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => setConfirmingUninstall(true)}>
                {uninstallDeb.isPending ? 'Uninstalling…' : 'Uninstall'}
              </Button>
            </>
          ) : null}
          <Button variant="ghost" disabled={busy} onClick={() => void run('check')}>
            {checkDebUpdate.isPending ? 'Checking…' : 'Check for updates'}
          </Button>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmingUninstall}
        title={`Uninstall ${pkg.effectiveDisplayName}`}
        message={`Uninstall ${pkg.effectiveDisplayName}? The package will be removed.`}
        confirmLabel="Uninstall"
        busy={busy}
        onConfirm={() => {
          setConfirmingUninstall(false)
          void run('uninstall')
        }}
        onCancel={() => setConfirmingUninstall(false)}
      />
    </>
  )
}
