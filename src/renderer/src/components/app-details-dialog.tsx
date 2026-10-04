// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useState, type JSX } from 'react'
import type { InstallOptions } from '@core/index'
import type { TrackedApp } from '@core/models/tracked-app'
import { installTypeDisplayName } from '@core/models/install-type'
import { useActions } from '@renderer/src/hooks/use-actions'
import { needsInstallTarget } from '@renderer/src/lib/install-options'
import { InstallOptionsDialog } from './install-options-dialog'
import { useNotifications } from './notifications'
import { InfoRow } from './info-row'
import { Badge, Button, ConfirmDialog, Dialog } from './ui'

export type AppDetailsDialogProps = {
  open: boolean
  app: TrackedApp | null
  onClose: () => void
}

/** Read-only details plus the full set of per-app actions. */
export function AppDetailsDialog({
  open,
  app,
  onClose
}: AppDetailsDialogProps): JSX.Element | null {
  const { installApp, uninstallApp, launchApp, checkAppUpdate, openExternal } = useActions()
  const { notify } = useNotifications()
  const [confirmingUninstall, setConfirmingUninstall] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)

  if (!open || app == null) return null

  const busy =
    installApp.isPending ||
    uninstallApp.isPending ||
    launchApp.isPending ||
    checkAppUpdate.isPending ||
    openExternal.isPending

  async function install(options?: InstallOptions): Promise<void> {
    if (app == null) return
    try {
      await installApp.mutateAsync(options === undefined ? { app } : { app, options })
      notify({ tone: 'success', message: `${app.displayName} installed.` })
    } catch {
      // The mutation's onError already raised a persistent notification.
    }
  }

  async function run(action: 'install' | 'uninstall' | 'launch' | 'check'): Promise<void> {
    if (app == null) return
    if (action === 'install') {
      // A raw-binary install needs a destination; every other type installs to
      // its own location, so it goes straight through.
      if (needsInstallTarget(app.installType)) {
        setOptionsOpen(true)
      } else {
        await install()
      }
      return
    }
    try {
      if (action === 'uninstall') {
        await uninstallApp.mutateAsync(app)
        notify({ tone: 'success', message: `${app.displayName} uninstalled.` })
      } else if (action === 'launch') {
        await launchApp.mutateAsync(app)
      } else {
        await checkAppUpdate.mutateAsync(app)
        notify({ tone: 'info', message: `Checked ${app.displayName} for updates.` })
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
        title={app.displayName}
        description={`${app.repoOwner}/${app.repoName}`}
        size="md"
        footer={
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        }
      >
        <div className="space-y-2">
          <InfoRow label="Repository">
            <span className="break-all">{app.repoUrl}</span>
          </InfoRow>
          <InfoRow label="Installed">{app.installedVersion ?? 'Not installed'}</InfoRow>
          <InfoRow label="Latest">{app.latestVersion ?? 'Unknown'}</InfoRow>
          <InfoRow label="Update status">
            {app.hasUpdate ? <Badge tone="warning">Update available</Badge> : 'Up to date'}
          </InfoRow>
          {app.installType ? (
            <InfoRow label="Install type">{installTypeDisplayName(app.installType)}</InfoRow>
          ) : null}
          {app.launchCommand ? <InfoRow label="Launch command">{app.launchCommand}</InfoRow> : null}
          {app.packageName ? <InfoRow label="Package name">{app.packageName}</InfoRow> : null}
          {app.architectures.length > 0 ? (
            <InfoRow label="Architectures">{app.architectures.join(', ')}</InfoRow>
          ) : null}
          {app.assetFilterPattern ? (
            <InfoRow label="Asset filter">{app.assetFilterPattern}</InfoRow>
          ) : null}
          {app.tagPrefix ? <InfoRow label="Tag prefix">{app.tagPrefix}</InfoRow> : null}
          <InfoRow label="Pre-releases">{app.includePrerelease ? 'Included' : 'Excluded'}</InfoRow>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {!app.isInstalled ? (
            <Button variant="primary" disabled={busy} onClick={() => void run('install')}>
              {installApp.isPending ? 'Installing…' : 'Install'}
            </Button>
          ) : null}
          {app.isInstalled && app.hasUpdate ? (
            <Button variant="primary" disabled={busy} onClick={() => void run('install')}>
              {installApp.isPending ? 'Upgrading…' : 'Upgrade to latest'}
            </Button>
          ) : null}
          {app.isInstalled ? (
            <>
              <Button variant="default" disabled={busy} onClick={() => void run('launch')}>
                {launchApp.isPending ? 'Launching…' : 'Launch'}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => setConfirmingUninstall(true)}>
                {uninstallApp.isPending ? 'Uninstalling…' : 'Uninstall'}
              </Button>
            </>
          ) : null}
          <Button variant="ghost" disabled={busy} onClick={() => void run('check')}>
            {checkAppUpdate.isPending ? 'Checking…' : 'Check for updates'}
          </Button>
          <Button
            variant="ghost"
            disabled={openExternal.isPending}
            onClick={() => openExternal.mutate(app.repoUrl)}
          >
            {openExternal.isPending ? 'Opening…' : 'Open on GitHub'}
          </Button>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmingUninstall}
        title={`Uninstall ${app.displayName}`}
        message={`Uninstall ${app.displayName}? The application files will be removed.`}
        confirmLabel="Uninstall"
        busy={busy}
        onConfirm={() => {
          setConfirmingUninstall(false)
          void run('uninstall')
        }}
        onCancel={() => setConfirmingUninstall(false)}
      />

      {optionsOpen ? (
        <InstallOptionsDialog
          app={app}
          busy={installApp.isPending}
          onCancel={() => setOptionsOpen(false)}
          onConfirm={(options) => {
            setOptionsOpen(false)
            void install(options)
          }}
        />
      ) : null}
    </>
  )
}
