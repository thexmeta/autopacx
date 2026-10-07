// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { lazy, Suspense, useId, useMemo, useState, type JSX } from 'react'
import {
  applyFilter,
  compareByName,
  type BatchOperationResultWire,
  type ItemFilter
} from '@core/index'
import type { TrackedPacstallPackage } from '@core/models/tracked-pacstall-package'
import { useActions } from '@renderer/src/hooks/use-actions'
import {
  usePacstallActions,
  usePacstallPackages,
  usePacstallStatus
} from '@renderer/src/hooks/use-pacstall'
import { BatchActionBar } from './batch-action-bar'
import { DialogFallback } from './lazy-dialog'
import { useNotifications } from './notifications'
import { SearchField } from './search-field'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  SegmentedControl,
  Spinner
} from './ui'

const PacstallDetailsDialog = lazy(() =>
  import('./pacstall-details-dialog').then((module) => ({
    default: module.PacstallDetailsDialog
  }))
)

/**
 * The pacstall install guide. Must be an allowlisted host (`github.com`),
 * because `openExternal` refuses anything else.
 */
const PACSTALL_INSTALL_DOCS_URL = 'https://github.com/pacstall/pacstall'

function pkgKey(pkg: TrackedPacstallPackage): string {
  return pkg.id != null ? `id:${pkg.id}` : `name:${pkg.name}`
}

function searchText(pkg: TrackedPacstallPackage): string {
  return [pkg.effectiveDisplayName, pkg.name, pkg.packageName ?? '', pkg.maintainer ?? '']
    .join(' ')
    .toLowerCase()
}

function summarizeResults(results: readonly BatchOperationResultWire[]): string {
  const failed = results.filter((entry) => !entry.success)
  if (failed.length === 0) return `${results.length} operation(s) completed successfully.`
  const details = failed.map((entry) => `${entry.appName}: ${entry.error ?? 'failed'}`).join('\n')
  return `${results.length - failed.length} succeeded, ${failed.length} failed.\n${details}`
}

type PacstallRowProps = {
  pkg: TrackedPacstallPackage
  multiSelect: boolean
  selected: boolean
  /** False when pacstall is missing (or resolved to an unexpected path). */
  canInstall: boolean
  /** Points the disabled Install button at the banner that explains why. */
  installHintId?: string
  onToggleSelected: () => void
  onOpenDetails: () => void
  onDelete: () => void
}

function PacstallPackageRow({
  pkg,
  multiSelect,
  selected,
  canInstall,
  installHintId,
  onToggleSelected,
  onOpenDetails,
  onDelete
}: PacstallRowProps): JSX.Element {
  const {
    installPacstall,
    uninstallPacstall,
    updatePacstall,
    checkPacstallUpdate,
    launchPacstall
  } = usePacstallActions()
  const [confirmingUninstall, setConfirmingUninstall] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const installing = installPacstall.isPending && installPacstall.variables === pkg
  const upgrading = updatePacstall.isPending && updatePacstall.variables === pkg
  const uninstalling = uninstallPacstall.isPending && uninstallPacstall.variables === pkg
  const checking = checkPacstallUpdate.isPending && checkPacstallUpdate.variables === pkg
  const launching = launchPacstall.isPending && launchPacstall.variables === pkg
  const busy = installing || upgrading || uninstalling || checking || launching

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
        <Badge tone="accent">pacstall</Badge>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
        <span className="truncate">{pkg.name}</span>
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
              aria-describedby={installHintId}
              disabled={busy || !canInstall}
              onClick={() => installPacstall.mutate(pkg)}
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
              onClick={() => updatePacstall.mutate(pkg)}
            >
              {upgrading ? 'Upgrading…' : 'Upgrade'}
            </Button>
          ) : null}
          {pkg.installedVersion ? (
            <>
              <Button
                variant="default"
                size="small"
                aria-label={`Launch ${pkg.effectiveDisplayName}`}
                disabled={busy}
                onClick={() => launchPacstall.mutate(pkg)}
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
            onClick={() => checkPacstallUpdate.mutate(pkg)}
          >
            {checking ? 'Checking…' : 'Check updates'}
          </Button>
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
          uninstallPacstall.mutate(pkg)
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

/** The tracked pacstall list with per-item actions, search and batch. */
export function PacstallPackageList(): JSX.Element {
  const { data, isPending, isError, error, refetch } = usePacstallPackages()
  const status = usePacstallStatus()
  const { deletePacstall } = usePacstallActions()
  const { batchInstall, batchDelete, batchUpdate, openExternal } = useActions()
  const { notify } = useNotifications()

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ItemFilter>('all')
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [detailsPkg, setDetailsPkg] = useState<TrackedPacstallPackage | null>(null)

  const pathUnexpected = status.data?.pathUnexpected === true
  const showBanner = status.data != null && (!status.data.installed || pathUnexpected)
  const canInstall = status.data != null && !showBanner
  const bannerId = useId()

  const packages = useMemo(() => data ?? [], [data])
  const visiblePackages = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const searched =
      needle.length === 0 ? packages : packages.filter((pkg) => searchText(pkg).includes(needle))
    const filtered = applyFilter(searched, filter, {
      isInstalled: (pkg) => pkg.installedVersion != null,
      hasUpdate: (pkg) => pkg.hasUpdate
    })
    return filtered.sort((a, b) =>
      compareByName(
        { displayName: a.effectiveDisplayName },
        { displayName: b.effectiveDisplayName }
      )
    )
  }, [packages, query, filter])

  const selectedPackages = visiblePackages.filter((pkg) => selectedKeys.has(pkgKey(pkg)))
  const batchBusy = batchInstall.isPending || batchDelete.isPending || batchUpdate.isPending

  function toggleSelected(pkg: TrackedPacstallPackage): void {
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
        const summary = await batchDelete.mutateAsync({
          appIds: [],
          debIds: [],
          pacstallIds: ids
        })
        notify({
          tone: summary.failed > 0 ? 'warning' : 'success',
          message: `Removed ${summary.succeeded} package(s), ${summary.failed} failed.`
        })
      } else {
        const results =
          kind === 'install'
            ? await batchInstall.mutateAsync({
                apps: [],
                debPackages: [],
                pacstallPackages: selectedPackages
              })
            : await batchUpdate.mutateAsync({
                apps: [],
                debPackages: [],
                pacstallPackages: selectedPackages
              })
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
        <span>Loading pacstall packages…</span>
      </div>
    )
  }

  if (isError) {
    return (
      <EmptyState
        title="Could not load pacstall packages"
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
      {showBanner ? (
        <div
          id={bannerId}
          role="status"
          className="mb-3 rounded-field border border-star/40 bg-star/10 px-3 py-2 text-xs text-star"
        >
          {pathUnexpected ? (
            <p>
              pacstall resolved to an unexpected path ({status.data?.path ?? 'unknown'}). AutoNex
              only installs through <code>/usr/bin/pacstall</code>.
            </p>
          ) : (
            <p>pacstall is not installed on this system.</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="default"
              size="small"
              onClick={() => void openExternal.mutateAsync(PACSTALL_INSTALL_DOCS_URL)}
            >
              How to install pacstall
            </Button>
            <Button
              variant="ghost"
              size="small"
              disabled={status.isFetching}
              onClick={() => void status.refetch()}
            >
              {status.isFetching ? 'Detecting…' : 'Detect again'}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pb-3">
        <SearchField value={query} onChange={setQuery} placeholder="Search pacstall packages…" />
        <SegmentedControl
          ariaLabel="Filter pacstall packages"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'installed', label: 'Installed' },
            { value: 'updates', label: 'Updates available' }
          ]}
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
          title="No pacstall packages tracked"
          description="Install a package from Discover to track it here."
        />
      ) : visiblePackages.length === 0 ? (
        <EmptyState title={`No matches for “${query.trim()}”`} />
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {visiblePackages.map((pkg) => (
            <PacstallPackageRow
              key={pkgKey(pkg)}
              pkg={pkg}
              multiSelect={multiSelect}
              selected={selectedKeys.has(pkgKey(pkg))}
              canInstall={canInstall}
              installHintId={showBanner ? bannerId : undefined}
              onToggleSelected={() => toggleSelected(pkg)}
              onOpenDetails={() => (multiSelect ? toggleSelected(pkg) : setDetailsPkg(pkg))}
              onDelete={() => {
                if (pkg.id != null) deletePacstall.mutate(pkg.id)
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

      {detailsPkg ? (
        <Suspense fallback={<DialogFallback />}>
          <PacstallDetailsDialog open pkg={detailsPkg} onClose={() => setDetailsPkg(null)} />
        </Suspense>
      ) : null}
    </div>
  )
}
