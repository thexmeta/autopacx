// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useState, type JSX } from 'react'
import type { MaskedSettings } from '@core/index'
import { useActions } from '@renderer/src/hooks/use-actions'
import { useHasGithubToken, useSettings } from '@renderer/src/hooks/use-settings'
import { useTheme, type Theme } from '@renderer/src/hooks/use-theme'
import { useNotifications } from './notifications'
import { Button, Dialog, SelectField, Switch, TextField } from './ui'

const ARCHITECTURE_OPTIONS = ['amd64', 'arm64', 'x86_64', 'arm', 'armhf', 'i386'].map((arch) => ({
  value: arch,
  label: arch
}))

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
  const { notify } = useNotifications()

  const [token, setToken] = useState('')
  const [releasesPerPage, setReleasesPerPage] = useState(
    typeof settings.github_releases_per_page === 'number'
      ? String(settings.github_releases_per_page)
      : '100'
  )
  const [defaultArch, setDefaultArch] = useState(
    typeof settings.default_architecture === 'string' ? settings.default_architecture : 'amd64'
  )
  const [debugLogging, setDebugLogging] = useState(settings.enable_debug_logging === true)

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

  async function handleSaveArchitecture(): Promise<void> {
    try {
      await setSettings.mutateAsync({ default_architecture: defaultArch })
      notify({ tone: 'success', message: 'Default architecture saved.' })
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

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Theme</h3>
        <div className="flex gap-2">
          <Button
            variant={theme === 'dark' ? 'primary' : 'default'}
            size="small"
            onClick={() => handleTheme('dark')}
          >
            Dark
          </Button>
          <Button
            variant={theme === 'light' ? 'primary' : 'default'}
            size="small"
            onClick={() => handleTheme('light')}
          >
            Light
          </Button>
        </div>
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
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Defaults</h3>
        <SelectField
          label="Default architecture"
          options={ARCHITECTURE_OPTIONS}
          value={defaultArch}
          onChange={(event) => setDefaultArch(event.target.value)}
        />
        <Button variant="default" size="small" onClick={() => void handleSaveArchitecture()}>
          Save default architecture
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
