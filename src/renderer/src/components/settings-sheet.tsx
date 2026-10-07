// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useState, type JSX } from 'react'
import type { MaskedSettings } from '@core/index'
import { useActions } from '@renderer/src/hooks/use-actions'
import { usePacstallStatus } from '@renderer/src/hooks/use-pacstall'
import {
  defaultArchitectures,
  defaultArchTypes,
  defaultInstallType
} from '@renderer/src/lib/add-app-defaults'
import {
  GITHUB_SEARCH_SORT_OPTIONS,
  resolveGithubSearchPerPage,
  resolveGithubSearchSort,
  useHasGithubToken,
  useSettings
} from '@renderer/src/hooks/use-settings'
import { useTheme, type Theme } from '@renderer/src/hooks/use-theme'
import { useNotifications } from './notifications'
import { ArchSelect } from './arch-select'
import { Button, Dialog, SegmentedControl, SelectField, Switch, TextField } from './ui'

/**
 * Install formats a new app may default to. Values match the model's
 * `InstallType`; an empty value means "let the app decide" (the installer
 * identifies the format from the release asset).
 */
const INSTALL_TYPE_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'appImage', label: 'AppImage' },
  { value: 'binary', label: 'Binary' },
  { value: 'deb', label: 'DEB' }
] as const

/** Splits a comma-separated list into trimmed, non-empty entries. */
function parseList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

const THEME_OPTIONS: readonly { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' }
]

const DEFAULT_REGISTRY_REPO = 'pacstall/pacstall-programs'
const DEFAULT_REGISTRY_BRANCH = 'master'
const DEFAULT_INDEX_TTL_HOURS = 24

export type SettingsSheetProps = {
  open: boolean
  onClose: () => void
}

type SettingsFormProps = {
  settings: MaskedSettings
  hasToken: boolean
}

/**
 * The settings form.
 *
 * It is only mounted once the masked settings have loaded, so each field's
 * initial value can come straight from props without an effect that would
 * cascade renders. The GitHub token is write-only: the field starts empty, is
 * submitted through `setGithubToken`, and the persisted value is never fetched
 * or rendered — only the boolean `hasToken` indicator is shown.
 */
function SettingsForm({ settings, hasToken }: SettingsFormProps): JSX.Element {
  const { theme, setTheme } = useTheme()
  const { setGithubToken, setSettings, exportData, importData } = useActions()
  const pacstallStatus = usePacstallStatus()
  const { notify } = useNotifications()

  const [token, setToken] = useState('')
  const [releasesPerPage, setReleasesPerPage] = useState(
    typeof settings.github_releases_per_page === 'number'
      ? String(settings.github_releases_per_page)
      : '100'
  )
  const [architectures, setArchitectures] = useState<string[]>(() => defaultArchitectures(settings))
  const [archTypesInput, setArchTypesInput] = useState(() => defaultArchTypes(settings).join(', '))
  const [installType, setInstallType] = useState(() => defaultInstallType(settings))
  const [assetFilterPattern, setAssetFilterPattern] = useState(
    typeof settings.default_asset_filter_pattern === 'string'
      ? settings.default_asset_filter_pattern
      : ''
  )
  const [binaryInstallDir, setBinaryInstallDir] = useState(
    typeof settings.default_binary_install_dir === 'string'
      ? settings.default_binary_install_dir
      : ''
  )
  const [debugLogging, setDebugLogging] = useState(settings.enable_debug_logging === true)

  const [searchSort, setSearchSort] = useState(resolveGithubSearchSort(settings.github_search_sort))
  const [searchPerPage, setSearchPerPage] = useState(
    String(resolveGithubSearchPerPage(settings.github_search_per_page))
  )

  const [pacstallEnabled, setPacstallEnabled] = useState(settings.pacstall_enabled === true)
  const [registryRepo, setRegistryRepo] = useState(
    typeof settings.pacstall_registry_repo === 'string' &&
      settings.pacstall_registry_repo.length > 0
      ? settings.pacstall_registry_repo
      : DEFAULT_REGISTRY_REPO
  )
  const [registryBranch, setRegistryBranch] = useState(
    typeof settings.pacstall_registry_branch === 'string' &&
      settings.pacstall_registry_branch.length > 0
      ? settings.pacstall_registry_branch
      : DEFAULT_REGISTRY_BRANCH
  )
  const [indexTtl, setIndexTtl] = useState(
    typeof settings.pacstall_index_ttl_hours === 'number'
      ? String(settings.pacstall_index_ttl_hours)
      : String(DEFAULT_INDEX_TTL_HOURS)
  )

  function handleTheme(next: Theme): void {
    setTheme(next)
  }

  async function handleSaveToken(): Promise<void> {
    if (token.trim().length === 0) return
    try {
      await setGithubToken.mutateAsync(token.trim())
      // Drop the plaintext from component state as soon as it is persisted.
      setToken('')
      notify({ tone: 'success', message: 'GitHub token saved.' })
    } catch {
      // The mutation's onError already raised a persistent notification.
    }
  }

  async function handleSaveReleasesPerPage(): Promise<void> {
    const count = Number.parseInt(releasesPerPage, 10)
    if (Number.isNaN(count) || count < 1 || count > 100) {
      notify({ tone: 'warning', message: 'Releases per page must be between 1 and 100.' })
      return
    }
    try {
      await setSettings.mutateAsync({ github_releases_per_page: count })
      notify({ tone: 'success', message: 'Releases per page saved.' })
    } catch {
      // onError notified already.
    }
  }

  async function handleSaveSearchDefaults(): Promise<void> {
    const count = resolveGithubSearchPerPage(searchPerPage)
    try {
      await setSettings.mutateAsync({
        github_search_sort: searchSort,
        github_search_per_page: count
      })
      setSearchPerPage(String(count))
      notify({ tone: 'success', message: 'GitHub search defaults saved.' })
    } catch {
      // onError notified already.
    }
  }

  async function handleSaveDefaults(): Promise<void> {
    try {
      await setSettings.mutateAsync({
        default_architectures: architectures,
        default_arch_type: parseList(archTypesInput),
        default_install_type: installType,
        default_asset_filter_pattern: assetFilterPattern.trim(),
        default_binary_install_dir: binaryInstallDir.trim()
      })
      notify({ tone: 'success', message: 'Add-app defaults saved.' })
    } catch {
      // onError notified already.
    }
  }

  async function handleToggleDebug(next: boolean): Promise<void> {
    setDebugLogging(next)
    try {
      await setSettings.mutateAsync({ enable_debug_logging: next })
    } catch {
      setDebugLogging(!next)
    }
  }

  async function handleTogglePacstall(next: boolean): Promise<void> {
    setPacstallEnabled(next)
    try {
      await setSettings.mutateAsync({ pacstall_enabled: next })
    } catch {
      setPacstallEnabled(!next)
    }
  }

  async function handleSaveRegistry(): Promise<void> {
    const repo = registryRepo.trim()
    const branch = registryBranch.trim()
    const ttl = Number.parseInt(indexTtl, 10)
    if (repo.length === 0 || branch.length === 0) {
      notify({ tone: 'warning', message: 'Registry repo and branch are required.' })
      return
    }
    if (Number.isNaN(ttl) || ttl < 0) {
      notify({ tone: 'warning', message: 'Index TTL must be zero or more hours.' })
      return
    }
    try {
      await setSettings.mutateAsync({
        pacstall_registry_repo: repo,
        pacstall_registry_branch: branch,
        pacstall_index_ttl_hours: ttl
      })
      notify({ tone: 'success', message: 'pacstall registry settings saved.' })
    } catch {
      // onError notified already.
    }
  }

  async function handleExport(): Promise<void> {
    try {
      const result = await exportData.mutateAsync()
      notify({ tone: 'success', message: `Exported to ${result.path}` })
    } catch {
      // onError notified already.
    }
  }

  async function handleImport(): Promise<void> {
    try {
      const result = await importData.mutateAsync()
      notify({ tone: 'success', message: `Imported ${result.count} apps.` })
    } catch {
      // onError notified already.
    }
  }

  const detected = pacstallStatus.data
  const detectedLabel = pacstallStatus.isPending
    ? 'Checking…'
    : detected == null
      ? 'Unknown'
      : detected.installed
        ? `Detected${detected.version != null ? ` — v${detected.version}` : ''}`
        : 'Not detected'

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Theme</h3>
        <SegmentedControl
          ariaLabel="Theme"
          options={THEME_OPTIONS}
          value={theme}
          onChange={handleTheme}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">GitHub API</h3>
        <p className="text-2xs text-muted">
          {hasToken
            ? 'A GitHub token is configured.'
            : 'No GitHub token configured. Add one to raise API rate limits.'}
        </p>
        <TextField
          label="Personal access token"
          type="password"
          autoComplete="off"
          placeholder={hasToken ? 'Enter a new token to replace' : 'ghp_…'}
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        <Button
          variant="primary"
          size="small"
          disabled={token.trim().length === 0 || setGithubToken.isPending}
          onClick={() => void handleSaveToken()}
        >
          {setGithubToken.isPending ? 'Saving…' : 'Save token'}
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          GitHub API limits
        </h3>
        <TextField
          label="Releases per page"
          hint="Between 1 and 100"
          inputMode="numeric"
          value={releasesPerPage}
          onChange={(event) => setReleasesPerPage(event.target.value)}
        />
        <Button variant="default" size="small" onClick={() => void handleSaveReleasesPerPage()}>
          Save releases per page
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          GitHub repository search
        </h3>
        <SelectField
          label="Default sort"
          options={GITHUB_SEARCH_SORT_OPTIONS}
          value={searchSort}
          onChange={(event) => setSearchSort(resolveGithubSearchSort(event.target.value))}
        />
        <TextField
          label="Results per page"
          hint="Between 1 and 100"
          inputMode="numeric"
          value={searchPerPage}
          onChange={(event) => setSearchPerPage(event.target.value)}
        />
        <Button variant="default" size="small" onClick={() => void handleSaveSearchDefaults()}>
          Save search defaults
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">pacstall</h3>
        <Switch
          label="Enable pacstall integration"
          description="Show pacstall packages in Discover and allow installs."
          checked={pacstallEnabled}
          onCheckedChange={(next) => void handleTogglePacstall(next)}
        />
        <p className="text-2xs text-muted">Status: {detectedLabel}</p>
        <Button
          variant="ghost"
          size="small"
          disabled={pacstallStatus.isFetching}
          onClick={() => void pacstallStatus.refetch()}
        >
          {pacstallStatus.isFetching ? 'Detecting…' : 'Detect again'}
        </Button>
        <TextField
          label="Registry repo"
          hint="owner/repo of the pacstall registry"
          placeholder={DEFAULT_REGISTRY_REPO}
          value={registryRepo}
          onChange={(event) => setRegistryRepo(event.target.value)}
        />
        <TextField
          label="Registry branch"
          placeholder={DEFAULT_REGISTRY_BRANCH}
          value={registryBranch}
          onChange={(event) => setRegistryBranch(event.target.value)}
        />
        <TextField
          label="Index cache TTL (hours)"
          hint="How long the registry index stays fresh"
          inputMode="numeric"
          value={indexTtl}
          onChange={(event) => setIndexTtl(event.target.value)}
        />
        <Button variant="default" size="small" onClick={() => void handleSaveRegistry()}>
          Save pacstall settings
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Defaults for new apps
        </h3>
        <ArchSelect value={architectures} onChange={setArchitectures} />
        <TextField
          label="Architecture types"
          hint="Comma-separated architecture types the picker offers, e.g. amd64, arm64"
          value={archTypesInput}
          onChange={(event) => setArchTypesInput(event.target.value)}
        />
        <SelectField
          label="Default install type"
          hint="Expected package format; leave unspecified to detect from the release asset"
          options={INSTALL_TYPE_OPTIONS}
          value={installType}
          onChange={(event) => setInstallType(event.target.value)}
        />
        <TextField
          label="Default asset filter pattern"
          hint="Filter release assets by filename, e.g. *.deb or *amd64*"
          placeholder="*.deb"
          value={assetFilterPattern}
          onChange={(event) => setAssetFilterPattern(event.target.value)}
        />
        <TextField
          label="Default binary install location"
          hint="Directory new binary installs default to, e.g. ~/.local/bin"
          placeholder="~/.local/bin"
          value={binaryInstallDir}
          onChange={(event) => setBinaryInstallDir(event.target.value)}
        />
        <Button variant="default" size="small" onClick={() => void handleSaveDefaults()}>
          Save defaults
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Diagnostics</h3>
        <Switch
          label="Enable debug logging"
          checked={debugLogging}
          onCheckedChange={(next) => void handleToggleDebug(next)}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Data</h3>
        <div className="flex gap-2">
          <Button
            variant="default"
            size="small"
            disabled={exportData.isPending}
            onClick={() => void handleExport()}
          >
            {exportData.isPending ? 'Exporting…' : 'Export'}
          </Button>
          <Button
            variant="default"
            size="small"
            disabled={importData.isPending}
            onClick={() => void handleImport()}
          >
            {importData.isPending ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </section>
    </div>
  )
}

/** The settings surface, gating the form on the loaded masked settings. */
export function SettingsSheet({ open, onClose }: SettingsSheetProps): JSX.Element {
  const { data: settings } = useSettings()
  const { data: hasToken } = useHasGithubToken()

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Settings"
      size="md"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {settings ? (
        <SettingsForm settings={settings} hasToken={hasToken === true} />
      ) : (
        <p className="py-4 text-xs text-muted">Loading settings…</p>
      )}
    </Dialog>
  )
}
