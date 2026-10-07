// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useMemo, useState, type JSX } from 'react'
import { usePacstallStatus } from '@renderer/src/hooks/use-pacstall'
import { GithubRepoResults } from './github-repo-results'
import { PacstallResults } from './pacstall-results'
import { SegmentedControl } from './ui'

type DiscoverMode = 'github' | 'pacstall'

const MODE_OPTIONS: readonly { value: DiscoverMode; label: string }[] = [
  { value: 'github', label: 'GitHub repositories' },
  { value: 'pacstall', label: 'pacstall packages' }
]

export type DiscoverViewProps = {
  /** Opens the settings sheet (used by the rate-limit "Add a GitHub token" CTA). */
  onOpenSettings?: () => void
}

/**
 * The Discover surface: search GitHub repositories or browse pacstall packages.
 *
 * The pacstall mode is only offered when pacstall integration is enabled in
 * settings (the main process folds `pacstall_enabled` into
 * {@link PacstallStatusWire.enabled}), matching the settings copy that says
 * enabling it is what makes pacstall packages appear in Discover.
 */
export function DiscoverView({ onOpenSettings }: DiscoverViewProps): JSX.Element {
  const [mode, setMode] = useState<DiscoverMode>('github')
  const status = usePacstallStatus()
  const pacstallEnabled = status.data?.enabled === true

  const options = useMemo(
    () =>
      pacstallEnabled ? MODE_OPTIONS : MODE_OPTIONS.filter((option) => option.value !== 'pacstall'),
    [pacstallEnabled]
  )
  const activeMode: DiscoverMode = pacstallEnabled ? mode : 'github'

  return (
    <div className="flex h-full flex-col">
      <div className="pb-3">
        <SegmentedControl
          ariaLabel="Discover source"
          options={options}
          value={activeMode}
          onChange={setMode}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeMode === 'github' ? (
          <GithubRepoResults onOpenSettings={onOpenSettings} />
        ) : (
          <PacstallResults />
        )}
      </div>
    </div>
  )
}
