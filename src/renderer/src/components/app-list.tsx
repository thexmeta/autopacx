// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { lazy, Suspense, useMemo, useState, type JSX } from 'react'
import type { BatchOperationResultWire, InstallOptions } from '@core/index'
import type { TrackedApp } from '@core/models/tracked-app'
import { useActions } from '@renderer/src/hooks/use-actions'
import { useApps } from '@renderer/src/hooks/use-apps'
import { needsInstallTarget } from '@renderer/src/lib/install-options'
import { BatchActionBar } from './batch-action-bar'
import { DialogFallback } from './lazy-dialog'
import { useNotifications } from './notifications'
import { SearchField } from './search-field'
import { Badge, Button, ConfirmDialog, EmptyState, IconButton, Spinner } from './ui'

// Rarely-used, heavy surfaces are split into their own chunks and fetched the
// first time they are opened, keeping the always-visible list in the main bundle.
const AddAppDialog = lazy(() =>
  import('./add-app-dialog').then((module) => ({ default: module.AddAppDialog }))
)
const AppDetailsDialog = lazy(() =>
  import('./app-details-dialog').then((module) => ({ default: module.AppDetailsDialog }))
)
const EditAppDialog = lazy(() =>
  import('./edit-app-dialog').then((module) => ({ default: module.EditAppDialog }))
)
const InstallOptionsDialog = lazy(() =>
  import('./install-options-dialog').then((module) => ({ default: module.InstallOptionsDialog }))
)

/** A stable key for an app even before it has been persisted (id == null). */
function appKey(app: TrackedApp): string {
  return app.id != null ? `id:${app.id}` : `repo:${app.repoOwner}/${app.repoName}`
}

/** Case-insensitive haystack used by the search filter. */
function searchText(app: TrackedApp): string {
  return [
    app.displayName,
    app.repoOwner,
    app.repoName,
    app.packageName ?? '',
    app.launchCommand ?? ''
  ]
    .join(' ')
    .toLowerCase()
}

/** Builds a one-line summary of a batch result for the notification stack. */
function summarizeResults(results: readonly BatchOperationResultWire[]): string {
  const failed = results.filter((entry) => !entry.success)
  if (failed.length === 0) return `${results.length} operation(s) completed successfully.`
  const details = failed.map((entry) => `${entry.appName}: ${entry.error ?? 'failed'}`).join('\n')
  return `${results.length - failed.length} succeeded, ${failed.length} failed.\n${details}`
}

type AppRowProps = {
  app: TrackedApp
  multiSelect: boolean
  selected: boolean
  onToggleSelected: () => void
  onOpenDetails: () => void
  onEdit: () => void
  onDelete: () => void
}

function TrackedAppRow({
  app,
  multiSelect,
  selected,
  onToggleSelected,
  onOpenDetails,
  onEdit,
  onDelete
}: AppRowProps): JSX.Element {
  const { installApp, uninstallApp, launchApp, checkAppUpdate } = useActions()
  const [confirmingUninstall, setConfirmingUninstall] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)

  const installing = installApp.isPending && installApp.variables?.app === app
  const uninstalling = uninstallApp.isPending && uninstallApp.variables === app
  const launching = launchApp.isPending && launchApp.variables === app
  const checking = checkAppUpdate.isPending && checkAppUpdate.variables === app
  const busy = installing || uninstalling || launching || checking

  // A raw-binary install needs a destination; every other type installs to its
  // own location, so it goes straight through.
  function requestInstall(): void {
    if (needsInstallTarget(app.installType)) {
      setOptionsOpen(true)
    } else {
      installApp.mutate({ app })
    }
  }

  function confirmInstallOptions(options: InstallOptions): void {
    setOptionsOpen(false)
    installApp.mutate({ app, options })
  }

  return (
    <li className="bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {multiSelect ? (
          <input
            type="checkbox"
            aria-label={`Select ${app.displayName}`}
            checked={selected}
            onChange={onToggleSelected}
            className="size-3.5 accent-[var(--accent-solid)]"
          />
        ) : null}
        <button
          type="button"
          onClick={onOpenDetails}
          className="truncate text-sm font-semibold text-text-strong hover:underline"
        >
          {app.displayName}
        </button>
        {app.hasUpdate ? <Badge tone="warning">Update available</Badge> : null}
        {app.isInstalled ? <Badge tone="success">Installed</Badge> : null}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
        <span>
          {app.repoOwner}/{app.repoName}
        </span>
        <span>Installed: {app.installedVersion ?? '—'}</span>
        <span className={app.hasUpdate ? 'font-semibold text-star' : undefined}>
          Latest: {app.latestVersion ?? '—'}
        </span>
      </div>

      {!multiSelect ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {!app.isInstalled ? (
            <Button
              variant="primary"
              size="small"
              aria-label={`Install ${app.displayName}`}
              disabled={busy}
              onClick={requestInstall}
            >
              {installing ? 'Installing…' : 'Install'}
            </Button>
          ) : null}
          {app.hasUpdate ? (
            <Button
              variant="primary"
              size="small"
              aria-label={`Upgrade ${app.displayName}`}
              disabled={busy}
              onClick={requestInstall}
            >
              {installing ? 'Upgrading…' : 'Upgrade'}
            </Button>
          ) : null}
          {app.isInstalled ? (
            <Button
              variant="default"
              size="small"
              aria-label={`Launch ${app.displayName}`}
              disabled={busy}
              onClick={() => launchApp.mutate(app)}
            >
              {launching ? 'Launching…' : 'Launch'}
            </Button>
          ) : null}
          {app.isInstalled ? (
            <Button
              variant="danger"
              size="small"
              aria-label={`Uninstall ${app.displayName}`}
              disabled={busy}
              onClick={() => setConfirmingUninstall(true)}
            >
              {uninstalling ? 'Uninstalling…' : 'Uninstall'}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="small"
            aria-label={`Check updates for ${app.displayName}`}
            disabled={busy}
            onClick={() => checkAppUpdate.mutate(app)}
          >
            {checking ? 'Checking…' : 'Check updates'}
          </Button>
          <IconButton label={`Edit ${app.displayName}`} variant="ghost" onClick={onEdit}>
            ✎
          </IconButton>
          <IconButton
            label={`Delete ${app.displayName}`}
            variant="ghost"
            onClick={() => setConfirmingDelete(true)}
          >
            🗑
          </IconButton>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmingUninstall}
        title={`Uninstall ${app.displayName}`}
        message={`Uninstall ${app.displayName}? The application files will be removed.`}
        confirmLabel="Uninstall"
        busy={uninstalling}
        onConfirm={() => {
          setConfirmingUninstall(false)
          uninstallApp.mutate(app)
        }}
        onCancel={() => setConfirmingUninstall(false)}
      />
      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete ${app.displayName}`}
        message={`Stop tracking ${app.displayName}? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmingDelete(false)
          onDelete()
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
      {optionsOpen ? (
        <Suspense fallback={<DialogFallback />}>
          <InstallOptionsDialog
            app={app}
            busy={installing}
            onCancel={() => setOptionsOpen(false)}
            onConfirm={confirmInstallOptions}
          />
        </Suspense>
      ) : null}
    </li>
  )
}

/** The tracked-app list with per-item actions, search, multi-select and batch. */
export function AppList(): JSX.Element {
  const { data, isPending, isError, error, refetch } = useApps()
  const { deleteApp, checkAll, batchInstall, batchDelete, batchUpdate } = useActions()
  const { notify } = useNotifications()

  const [query, setQuery] = useState('')
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [editApp, setEditApp] = useState<TrackedApp | null>(null)
  const [detailsApp, setDetailsApp] = useState<TrackedApp | null>(null)

  const apps = useMemo(() => data ?? [], [data])
  const visibleApps = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return apps
    return apps.filter((app) => searchText(app).includes(needle))
  }, [apps, query])

  const selectedApps = visibleApps.filter((app) => selectedKeys.has(appKey(app)))
  const batchBusy = batchInstall.isPending || batchDelete.isPending || batchUpdate.isPending

  function toggleSelected(app: TrackedApp): void {
    const key = appKey(app)
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectAll(): void {
    setSelectedKeys(new Set(visibleApps.map(appKey)))
  }

  function deselectAll(): void {
    setSelectedKeys(new Set())
  }

  function exitMultiSelect(): void {
    setMultiSelect(false)
    deselectAll()
  }

  async function runCheckAll(): Promise<void> {
    try {
      const result = await checkAll.mutateAsync()
      const total = result.apps.length + result.debPackages.length
      if (result.failures.length === 0) {
        notify({ tone: 'success', message: `Checked ${total} item(s).` })
      } else {
        const details = result.failures.map((entry) => `${entry.name}: ${entry.error}`).join('\n')
        notify({
          tone: 'warning',
          message: `${result.failures.length} of ${total} failed.\n${details}`
        })
      }
    } catch {
      // The mutation's onError already raised a persistent notification.
    }
  }

  async function runBatch(kind: 'install' | 'check' | 'delete'): Promise<void> {
    if (selectedApps.length === 0) return
    try {
      if (kind === 'delete') {
        const ids = selectedApps.map((app) => app.id).filter((id): id is number => id != null)
        const summary = await batchDelete.mutateAsync({ appIds: ids, debIds: [] })
        notify({
          tone: summary.failed > 0 ? 'warning' : 'success',
          message: `Removed ${summary.succeeded} app(s), ${summary.failed} failed.`
        })
      } else {
        const results =
          kind === 'install'
            ? await batchInstall.mutateAsync({ apps: selectedApps, debPackages: [] })
            : await batchUpdate.mutateAsync({ apps: selectedApps, debPackages: [] })
        notify({
          tone: results.some((entry) => !entry.success) ? 'warning' : 'success',
          message: summarizeResults(results)
        })
      }
      deselectAll()
    } catch {
      // The mutation's onError already raised a persistent notification.
    }
  }

  if (isPending) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-center gap-2 py-16 text-sm text-muted"
      >
        <Spinner />
        <span>Loading apps…</span>
      </div>
    )
  }

  if (isError) {
    return (
      <EmptyState
        title="Could not load apps"
        description={error?.message ?? 'An unexpected error occurred.'}
        action={
          <Button variant="default" size="small" onClick={() => void refetch()}>
            Retry
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search apps by name, repo, package…"
        />
        <Button variant="primary" size="small" onClick={() => setAddOpen(true)}>
          Add app
        </Button>
        <Button
          variant="default"
          size="small"
          disabled={checkAll.isPending}
          onClick={() => void runCheckAll()}
        >
          {checkAll.isPending ? 'Checking…' : 'Check all'}
        </Button>
        <Button
          variant={multiSelect ? 'default' : 'ghost'}
          size="small"
          onClick={multiSelect ? exitMultiSelect : () => setMultiSelect(true)}
        >
          {multiSelect ? 'Close multi-select' : 'Select multiple'}
        </Button>
      </div>

      {apps.length === 0 ? (
        <EmptyState
          title="No apps tracked"
          description="Add a GitHub repository to track its releases."
          action={
            <Button variant="primary" size="small" onClick={() => setAddOpen(true)}>
              Add app
            </Button>
          }
        />
      ) : visibleApps.length === 0 ? (
        <EmptyState title={`No matches for “${query.trim()}”`} />
      ) : (
        <ul className="flex-1 divide-y divide-border overflow-y-auto">
          {visibleApps.map((app) => (
            <TrackedAppRow
              key={appKey(app)}
              app={app}
              multiSelect={multiSelect}
              selected={selectedKeys.has(appKey(app))}
              onToggleSelected={() => toggleSelected(app)}
              onOpenDetails={() => (multiSelect ? toggleSelected(app) : setDetailsApp(app))}
              onEdit={() => setEditApp(app)}
              onDelete={() => {
                if (app.id != null) deleteApp.mutate(app.id)
              }}
            />
          ))}
        </ul>
      )}

      {multiSelect ? (
        <BatchActionBar
          selectedCount={selectedApps.length}
          totalCount={visibleApps.length}
          busy={batchBusy}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          onCheck={() => void runBatch('check')}
          onInstall={() => void runBatch('install')}
          onDelete={() => void runBatch('delete')}
        />
      ) : null}

      {addOpen ? (
        <Suspense fallback={<DialogFallback />}>
          <AddAppDialog open onClose={() => setAddOpen(false)} />
        </Suspense>
      ) : null}
      {editApp ? (
        <Suspense fallback={<DialogFallback />}>
          <EditAppDialog open app={editApp} onClose={() => setEditApp(null)} />
        </Suspense>
      ) : null}
      {detailsApp ? (
        <Suspense fallback={<DialogFallback />}>
          <AppDetailsDialog open app={detailsApp} onClose={() => setDetailsApp(null)} />
        </Suspense>
      ) : null}
    </div>
  )
}
