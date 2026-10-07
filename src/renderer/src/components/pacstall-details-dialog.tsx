// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useState, type JSX } from 'react'
import type { TrackedPacstallPackage } from '@core/models/tracked-pacstall-package'
import { usePacstallActions } from '@renderer/src/hooks/use-pacstall'
import { useNotifications } from './notifications'
import { InfoRow } from './info-row'
import { Badge, Button, ConfirmDialog, Dialog } from './ui'

export type PacstallDetailsDialogProps = {
  open: boolean
  pkg: TrackedPacstallPackage | null
  onClose: () => void
}

/** Read-only pacstall details plus install/upgrade/uninstall/check actions. */
export function PacstallDetailsDialog({
  open,
  pkg,
  onClose
}: PacstallDetailsDialogProps): JSX.Element | null {
  const {
    installPacstall,
    uninstallPacstall,
    updatePacstall,
    checkPacstallUpdate,
    launchPacstall
  } = usePacstallActions()
  const { notify } = useNotifications()
  const [confirmingUninstall, setConfirmingUninstall] = useState(false)

  if (!open || pkg == null) return null

  const busy =
    installPacstall.isPending ||
    uninstallPacstall.isPending ||
    updatePacstall.isPending ||
    checkPacstallUpdate.isPending ||
    launchPacstall.isPending

  async function run(
    action: 'install' | 'upgrade' | 'uninstall' | 'check' | 'launch'
  ): Promise<void> {
    if (pkg == null) return
    try {
      if (action === 'install') {
        await installPacstall.mutateAsync(pkg)
        notify({ tone: 'success', message: `${pkg.effectiveDisplayName} installed.` })
      } else if (action === 'upgrade') {
        await updatePacstall.mutateAsync(pkg)
        notify({ tone: 'success', message: `${pkg.effectiveDisplayName} upgraded.` })
      } else if (action === 'uninstall') {
        await uninstallPacstall.mutateAsync(pkg)
        notify({ tone: 'success', message: `${pkg.effectiveDisplayName} uninstalled.` })
      } else if (action === 'launch') {
        await launchPacstall.mutateAsync(pkg)
      } else {
        await checkPacstallUpdate.mutateAsync(pkg)
        notify({ tone: 'info', message: `Checked ${pkg.effectiveDisplayName} for updates.` })
      }
    } catch {
      // The mutations' onError already raised a persistent notification.
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
          {pkg.description ? <InfoRow label="Description">{pkg.description}</InfoRow> : null}
          {pkg.maintainer ? <InfoRow label="Maintainer">{pkg.maintainer}</InfoRow> : null}
          {pkg.registryRepo ? <InfoRow label="Registry">{pkg.registryRepo}</InfoRow> : null}
          <InfoRow label="Installed">{pkg.installedVersion ?? 'Not installed'}</InfoRow>
          <InfoRow label="Latest">{pkg.latestVersion ?? 'Unknown'}</InfoRow>
          <InfoRow label="Update status">
            {pkg.hasUpdate ? <Badge tone="warning">Update available</Badge> : 'Up to date'}
          </InfoRow>
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
              {installPacstall.isPending ? 'Installing…' : 'Install'}
            </Button>
          ) : null}
          {pkg.installedVersion && pkg.hasUpdate ? (
            <Button variant="primary" disabled={busy} onClick={() => void run('upgrade')}>
              {updatePacstall.isPending ? 'Upgrading…' : 'Upgrade to latest'}
            </Button>
          ) : null}
          {pkg.installedVersion ? (
            <>
              <Button variant="default" disabled={busy} onClick={() => void run('launch')}>
                {launchPacstall.isPending ? 'Launching…' : 'Launch'}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => setConfirmingUninstall(true)}>
                {uninstallPacstall.isPending ? 'Uninstalling…' : 'Uninstall'}
              </Button>
            </>
          ) : null}
          <Button variant="ghost" disabled={busy} onClick={() => void run('check')}>
            {checkPacstallUpdate.isPending ? 'Checking…' : 'Check for updates'}
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
