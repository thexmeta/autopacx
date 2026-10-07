// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useMemo, useState, type JSX } from 'react'
import {
  choosePreferredAsset,
  groupAssetsByInstallType,
  installTypeDisplayName,
  type GithubAssetOptionWire
} from '@core/index'
import { useGithubReleaseAssets } from '@renderer/src/hooks/use-github-release-assets'
import { Badge, Button, Dialog, EmptyState, Spinner } from './ui'

/** The sentinel value for the "let AutoNex choose" option. */
const AUTO = ''

/** Formats a byte count as a compact human string. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[unit]}`
}

/** A single selectable asset radio. */
function AssetOption({
  asset,
  selected,
  onSelect
}: {
  asset: GithubAssetOptionWire
  selected: boolean
  onSelect: () => void
}): JSX.Element {
  return (
    <label className="flex items-start gap-2 rounded-field px-1 py-0.5 hover:bg-hover">
      <input
        type="radio"
        name="github-asset"
        value={asset.name}
        checked={selected}
        onChange={onSelect}
        className="mt-0.5 accent-[var(--accent-solid)]"
      />
      <span className="min-w-0">
        <span className="block break-all text-sm text-text">{asset.name}</span>
        <span className="block text-2xs text-faint">{formatBytes(asset.size)}</span>
      </span>
    </label>
  )
}

export type GithubAssetDialogProps = {
  repoOwner: string
  repoName: string
  /** Human label used in the title and empty state. */
  displayName: string
  includePrerelease?: boolean
  busy: boolean
  onCancel: () => void
  /** Receives the chosen asset name, or `null` for the auto-pick. */
  onConfirm: (assetName: string | null) => void
}

/**
 * Release-asset picker, ported from the `pickInstallType` + `chooseAsset` path
 * in `lib/ui/upgrade_flow.dart`.
 *
 * Assets are grouped by install type (mirroring `pickInstallType`) and shown as
 * radios. An explicit "Auto (best match)" option passes no `assetName`, keeping
 * the installer's existing auto-pick. When there is exactly one installable
 * asset it is preselected, mirroring `chooseAsset`'s silent single-candidate
 * path; an architecture-preferred asset is preselected when one is available.
 */
export function GithubAssetDialog({
  repoOwner,
  repoName,
  displayName,
  includePrerelease,
  busy,
  onCancel,
  onConfirm
}: GithubAssetDialogProps): JSX.Element {
  const query = useGithubReleaseAssets({ repoOwner, repoName, includePrerelease })

  const groups = useMemo(() => groupAssetsByInstallType(query.data?.assets ?? []), [query.data])
  const installable = useMemo(() => groups.flatMap((group) => group.assets), [groups])

  // The user's explicit choice; `null` until they pick. The effective selection
  // is derived so a single installable asset (or an architecture-preferred one)
  // is preselected without an effect.
  const [chosen, setChosen] = useState<string | null>(null)
  const preferred = choosePreferredAsset(installable, [])
  const selected = chosen ?? preferred?.name ?? AUTO

  const hasAssets = installable.length > 0

  let body: JSX.Element
  if (query.isPending) {
    body = (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-center gap-2 py-10 text-sm text-muted"
      >
        <Spinner />
        <span>Loading packages…</span>
      </div>
    )
  } else if (query.isError) {
    body = (
      <EmptyState
        title="Could not load packages"
        description={query.error?.message ?? 'An unexpected error occurred.'}
        action={
          <Button variant="default" size="small" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    )
  } else if (!hasAssets) {
    body = (
      <EmptyState
        title="No downloadable packages"
        description={`${displayName} has no release asset AutoNex can install.`}
      />
    )
  } else {
    body = (
      <div role="radiogroup" aria-label="Package to install" className="space-y-3">
        <label className="flex items-start gap-2 rounded-field px-1 py-0.5 hover:bg-hover">
          <input
            type="radio"
            name="github-asset"
            value={AUTO}
            checked={selected === AUTO}
            onChange={() => setChosen(AUTO)}
            className="mt-0.5 accent-[var(--accent-solid)]"
          />
          <span className="min-w-0">
            <span className="block text-sm text-text-strong">Auto (best match)</span>
            <span className="block text-xs text-muted">
              Let AutoNex choose the best asset for this system.
            </span>
          </span>
        </label>

        {groups.map((group) => (
          <fieldset key={group.installType} className="space-y-1">
            <legend className="px-1 text-xs font-medium text-secondary">
              <Badge tone="neutral">{installTypeDisplayName(group.installType)}</Badge>
            </legend>
            {group.assets.map((asset) => (
              <AssetOption
                key={asset.name}
                asset={asset}
                selected={selected === asset.name}
                onSelect={() => setChosen(asset.name)}
              />
            ))}
          </fieldset>
        ))}
      </div>
    )
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      title={`Install ${displayName}`}
      description="Choose which release package to install."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => onConfirm(selected === AUTO ? null : selected)}
            disabled={busy || !hasAssets}
          >
            {busy ? 'Installing…' : 'Install'}
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  )
}
