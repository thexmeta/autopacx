// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { lazy, Suspense, useMemo, useState, type JSX } from 'react'
import type { BatchOperationResultWire } from '@core/index'
import type { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { useActions } from '@renderer/src/hooks/use-actions'
import { useDebPackages } from '@renderer/src/hooks/use-deb-packages'
import { BatchActionBar } from './batch-action-bar'
import { DialogFallback } from './lazy-dialog'
import { useNotifications } from './notifications'
import { SearchField } from './search-field'
import { Badge, Button, ConfirmDialog, EmptyState, IconButton, Spinner } from './ui'

// Detail/edit surfaces are split into their own chunks and fetched on demand.
const DebDetailsDialog = lazy(() =>
  import('./deb-details-dialog').then((module) => ({ default: module.DebDetailsDialog }))
)
const EditDebPackageDialog = lazy(() =>
  import('./edit-deb-package-dialog').then((module) => ({
    default: module.EditDebPackageDialog
  }))
)

function pkgKey(pkg: TrackedDebPackage): string {
  return pkg.id != null ? `id:${pkg.id}` : `url:${pkg.packageUrl}`
}

function searchText(pkg: TrackedDebPackage): string {
  return [pkg.displayName ?? '', pkg.name, pkg.packageUrl].join(' ').toLowerCase()
}

function summarizeResults(results: readonly BatchOperationResultWire[]): string {
  const failed = results.filter((entry) => !entry.success)
  if (failed.length === 0) return `${results.length} operation(s) completed successfully.`
  const details = failed.map((entry) => `${entry.appName}: ${entry.error ?? 'failed'}`).join('\n')
  return `${results.length - failed.length} succeeded, ${failed.length} failed.\n${details}`
}

type DebRowProps = {
  pkg: TrackedDebPackage
  multiSelect: boolean
  selected: boolean
  onToggleSelected: () => void
  onOpenDetails: () => void
  onEdit: () => void
  onDelete: () => void
}

function DebPackageRow({
  pkg,
  multiSelect,
  selected,
  onToggleSelected,
  onOpenDetails,
  onEdit,
  onDelete
}: DebRowProps): JSX.Element {
  const { installDeb, uninstallDeb, checkDebUpdate, launchDeb } = useActions()
  const [confirmingUninstall, setConfirmingUninstall] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const installing = installDeb.isPending && installDeb.variables === pkg
  const uninstalling = uninstallDeb.isPending && uninstallDeb.variables === pkg
  const checking = checkDebUpdate.isPending && checkDebUpdate.variables === pkg
  const launching = launchDeb.isPending && launchDeb.variables === pkg
  const busy = installing || uninstalling || checking || launching

  return (
    <li className="bg-surface px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {multiSelect ? (
          <input
            type="checkbox"
            aria-label={`Select ${pkg.effectiveDisplayName}`}
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
          {pkg.effectiveDisplayName}
        </button>
        {pkg.hasUpdate ? <Badge tone="warning">Update available</Badge> : null}
        <Badge tone="accent">Direct</Badge>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
        <span className="truncate">{pkg.filename || pkg.packageUrl}</span>
        <span>Installed: {pkg.installedVersion ?? '—'}</span>
        <span className={pkg.hasUpdate ? 'font-semibold text-star' : undefined}>
          Latest: {pkg.latestVersion ?? '—'}
        </span>
      </div>

      {!multiSelect ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {!pkg.installedVersion ? (
            <Button
              variant="primary"
              size="small"
              aria-label={`Install ${pkg.effectiveDisplayName}`}
              disabled={busy}
              onClick={() => installDeb.mutate(pkg)}
            >
              {installing ? 'Installing…' : 'Install'}
            </Button>
          ) : null}
          {pkg.installedVersion && pkg.hasUpdate ? (
            <Button
              variant="primary"
              size="small"
              aria-label={`Upgrade ${pkg.effectiveDisplayName}`}
              disabled={busy}
              onClick={() => installDeb.mutate(pkg)}
            >
              {installing ? 'Upgrading…' : 'Upgrade'}
            </Button>
          ) : null}
          {pkg.installedVersion ? (
            <>
              <Button
                variant="default"
                size="small"
                aria-label={`Launch ${pkg.effectiveDisplayName}`}
                disabled={busy}
                onClick={() => launchDeb.mutate(pkg)}
              >
                {launching ? 'Launching…' : 'Launch'}
              </Button>
              <Button
                variant="danger"
                size="small"
                aria-label={`Uninstall ${pkg.effectiveDisplayName}`}
                disabled={busy}
                onClick={() => setConfirmingUninstall(true)}
              >
                {uninstalling ? 'Uninstalling…' : 'Uninstall'}
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            size="small"
            aria-label={`Check updates for ${pkg.effectiveDisplayName}`}
            disabled={busy}
            onClick={() => checkDebUpdate.mutate(pkg)}
          >
            {checking ? 'Checking…' : 'Check updates'}
          </Button>
          <IconButton label={`Edit ${pkg.effectiveDisplayName}`} variant="ghost" onClick={onEdit}>
            ✎
          </IconButton>
          <IconButton
            label={`Delete ${pkg.effectiveDisplayName}`}
            variant="ghost"
            onClick={() => setConfirmingDelete(true)}
          >
            🗑
          </IconButton>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmingUninstall}
        title={`Uninstall ${pkg.effectiveDisplayName}`}
        message={`Uninstall ${pkg.effectiveDisplayName}? The package will be removed.`}
        confirmLabel="Uninstall"
        busy={uninstalling}
        onConfirm={() => {
          setConfirmingUninstall(false)
          uninstallDeb.mutate(pkg)
        }}
        onCancel={() => setConfirmingUninstall(false)}
      />
      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete ${pkg.effectiveDisplayName}`}
        message={`Stop tracking ${pkg.effectiveDisplayName}? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmingDelete(false)
          onDelete()
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </li>
  )
}

/** The tracked deb-package list with per-item actions, search and batch. */
export function DebPackageList(): JSX.Element {
  const { data, isPending, isError, error, refetch } = useDebPackages()
  const { deleteDeb, batchInstall, batchDelete, batchUpdate } = useActions()
  const { notify } = useNotifications()

  const [query, setQuery] = useState('')
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [editPkg, setEditPkg] = useState<TrackedDebPackage | null>(null)
  const [detailsPkg, setDetailsPkg] = useState<TrackedDebPackage | null>(null)

  const packages = useMemo(() => data ?? [], [data])
  const visiblePackages = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return packages
    return packages.filter((pkg) => searchText(pkg).includes(needle))
  }, [packages, query])

  const selectedPackages = visiblePackages.filter((pkg) => selectedKeys.has(pkgKey(pkg)))
  const batchBusy = batchInstall.isPending || batchDelete.isPending || batchUpdate.isPending

  function toggleSelected(pkg: TrackedDebPackage): void {
    const key = pkgKey(pkg)
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectAll(): void {
    setSelectedKeys(new Set(visiblePackages.map(pkgKey)))
  }

  function deselectAll(): void {
    setSelectedKeys(new Set())
  }

  function exitMultiSelect(): void {
    setMultiSelect(false)
    deselectAll()
  }

  async function runBatch(kind: 'install' | 'check' | 'delete'): Promise<void> {
    if (selectedPackages.length === 0) return
    try {
      if (kind === 'delete') {
        const ids = selectedPackages.map((pkg) => pkg.id).filter((id): id is number => id != null)
        const summary = await batchDelete.mutateAsync({ appIds: [], debIds: ids })
        notify({
          tone: summary.failed > 0 ? 'warning' : 'success',
          message: `Removed ${summary.succeeded} package(s), ${summary.failed} failed.`
        })
      } else {
        const results =
          kind === 'install'
            ? await batchInstall.mutateAsync({ apps: [], debPackages: selectedPackages })
            : await batchUpdate.mutateAsync({ apps: [], debPackages: selectedPackages })
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
        <span>Loading deb packages…</span>
      </div>
    )
  }

  if (isError) {
    return (
      <EmptyState
        title="Could not load deb packages"
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
          placeholder="Search packages by name or URL…"
        />
        <Button
          variant={multiSelect ? 'default' : 'ghost'}
          size="small"
          onClick={multiSelect ? exitMultiSelect : () => setMultiSelect(true)}
        >
          {multiSelect ? 'Close multi-select' : 'Select multiple'}
        </Button>
      </div>

      {packages.length === 0 ? (
        <EmptyState
          title="No deb packages tracked"
          description="Track a direct .deb download URL to watch it for updates."
        />
      ) : visiblePackages.length === 0 ? (
        <EmptyState title={`No matches for “${query.trim()}”`} />
      ) : (
        <ul className="flex-1 divide-y divide-border overflow-y-auto">
          {visiblePackages.map((pkg) => (
            <DebPackageRow
              key={pkgKey(pkg)}
              pkg={pkg}
              multiSelect={multiSelect}
              selected={selectedKeys.has(pkgKey(pkg))}
              onToggleSelected={() => toggleSelected(pkg)}
              onOpenDetails={() => (multiSelect ? toggleSelected(pkg) : setDetailsPkg(pkg))}
              onEdit={() => setEditPkg(pkg)}
              onDelete={() => {
                if (pkg.id != null) deleteDeb.mutate(pkg.id)
              }}
            />
          ))}
        </ul>
      )}

      {multiSelect ? (
        <BatchActionBar
          selectedCount={selectedPackages.length}
          totalCount={visiblePackages.length}
          busy={batchBusy}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          onCheck={() => void runBatch('check')}
          onInstall={() => void runBatch('install')}
          onDelete={() => void runBatch('delete')}
        />
      ) : null}

      {editPkg ? (
        <Suspense fallback={<DialogFallback />}>
          <EditDebPackageDialog open pkg={editPkg} onClose={() => setEditPkg(null)} />
        </Suspense>
      ) : null}
      {detailsPkg ? (
        <Suspense fallback={<DialogFallback />}>
          <DebDetailsDialog open pkg={detailsPkg} onClose={() => setDetailsPkg(null)} />
        </Suspense>
      ) : null}
    </div>
  )
}
