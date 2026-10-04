// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it, vi } from 'vitest'
import type { Settings } from '@core/api'
import { InstallType } from '@core/models/install-type'
import { Release } from '@core/models/release'
import { TrackedApp } from '@core/models/tracked-app'
import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import {
  createHandlers,
  maskSettings,
  type ConfigLike,
  type DatabaseLike,
  type DebugLogLike,
  type ExternalCheckerLike,
  type ExternalLinkLike,
  type GitHubLike,
  type InstallerLike,
  type IpcDependencies,
  type StoreLike,
  type TokenLike
} from './ipc-handlers'

// --- Fixtures ---------------------------------------------------------------

function trackedApp(
  overrides: Partial<ConstructorParameters<typeof TrackedApp>[0]> = {}
): TrackedApp {
  return new TrackedApp({
    id: 1,
    repoOwner: 'owner',
    repoName: 'repo',
    displayName: 'App',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides
  })
}

function trackedDeb(
  overrides: Partial<ConstructorParameters<typeof TrackedDebPackage>[0]> = {}
): TrackedDebPackage {
  return new TrackedDebPackage({
    id: 1,
    name: 'thing',
    packageUrl: 'https://example.com/thing.deb',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides
  })
}

function release(tagName = 'v2.0.0'): Release {
  return new Release({
    tagName,
    prerelease: false,
    draft: false,
    assets: [],
    publishedAt: new Date('2026-02-01T00:00:00Z')
  })
}

interface HarnessInit {
  apps?: TrackedApp[]
  debPackages?: TrackedDebPackage[]
  settings?: Settings
}

function makeHarness(init: HarnessInit = {}) {
  let apps = [...(init.apps ?? [])]
  let debPackages = [...(init.debPackages ?? [])]
  let settings: Record<string, unknown> = { ...(init.settings ?? {}) }

  const store: StoreLike = {
    readApps: vi.fn(async () => [...apps]),
    writeApps: vi.fn(async (next: readonly TrackedApp[]) => {
      apps = [...next]
    }),
    readDebPackages: vi.fn(async () => [...debPackages]),
    writeDebPackages: vi.fn(async (next: readonly TrackedDebPackage[]) => {
      debPackages = [...next]
    }),
    readSettings: vi.fn(async () => ({ ...settings })),
    writeSettings: vi.fn(async (next: Settings) => {
      settings = { ...next }
    })
  }

  const github: GitHubLike = { getLatestReleaseWithPackageInfo: vi.fn() }
  const installer: InstallerLike = {
    identifyAssetType: vi.fn(),
    downloadFile: vi.fn(),
    installPackage: vi.fn(),
    uninstallPackage: vi.fn(),
    uninstallDebPackage: vi.fn(),
    launchApp: vi.fn(),
    launchDebPackage: vi.fn()
  }
  const database: DatabaseLike = { fetchDebInfo: vi.fn() }
  const external: ExternalCheckerLike = {
    getExternalVersion: vi.fn(),
    getExternalDebVersion: vi.fn()
  }
  const token: TokenLike = { hasToken: vi.fn(), setToken: vi.fn() }
  const config: ConfigLike = { exportConfig: vi.fn(), importConfig: vi.fn() }
  const debugLog: DebugLogLike = {
    readTail: vi.fn(async () => ({ content: 'log tail', truncated: false })),
    clear: vi.fn(async () => undefined),
    setEnabled: vi.fn()
  }
  const externalLink: ExternalLinkLike = { open: vi.fn(async () => undefined) }
  const emit = vi.fn()

  const deps: IpcDependencies = {
    store,
    github,
    installer,
    database,
    external,
    token,
    config,
    debugLog,
    externalLink,
    appVersion: '1.2.3',
    emit
  }

  return {
    handlers: createHandlers(deps),
    github,
    installer,
    database,
    external,
    token,
    config,
    debugLog,
    externalLink,
    emit,
    getApps: () => apps,
    getDebs: () => debPackages,
    getSettings: () => settings
  }
}

// --- Reads ------------------------------------------------------------------

describe('read handlers', () => {
  it('returns the tracked apps and deb packages as wire maps', async () => {
    const h = makeHarness({ apps: [trackedApp()], debPackages: [trackedDeb()] })

    const apps = (await h.handlers.getApps([])) as Array<Record<string, unknown>>
    const debs = (await h.handlers.getDebPackages([])) as Array<Record<string, unknown>>

    expect(apps[0]?.['repo_owner']).toBe('owner')
    expect(debs[0]?.['package_url']).toBe('https://example.com/thing.deb')
  })

  it('masks the GitHub token in getSettings', async () => {
    const h = makeHarness({
      settings: { theme: 'dark', github_token: 'ghp_plain', github_token_enc: 'cipher' }
    })
    vi.mocked(h.token.hasToken).mockResolvedValue(true)

    const result = (await h.handlers.getSettings([])) as Record<string, unknown>

    expect(result['theme']).toBe('dark')
    expect(result['hasGithubToken']).toBe(true)
    expect(result['github_token']).toBeUndefined()
    expect(result['github_token_enc']).toBeUndefined()
  })

  it('rejects arguments on a no-argument read', async () => {
    const h = makeHarness()
    await expect(h.handlers.getVersion([{ unexpected: true }])).rejects.toThrow()
  })

  it('returns the app version and token presence', async () => {
    const h = makeHarness()
    vi.mocked(h.token.hasToken).mockResolvedValue(true)

    expect(await h.handlers.getVersion([])).toBe('1.2.3')
    expect(await h.handlers.hasGithubToken([])).toBe(true)
  })
})

// --- Token ------------------------------------------------------------------

describe('token handlers', () => {
  it('delegates setGithubToken to the token store', async () => {
    const h = makeHarness()
    await h.handlers.setGithubToken(['ghp_secret'])
    expect(h.token.setToken).toHaveBeenCalledWith('ghp_secret')
  })

  it('rejects a non-string token', async () => {
    const h = makeHarness()
    await expect(h.handlers.setGithubToken([123])).rejects.toThrow()
  })
})

// --- External links ---------------------------------------------------------

describe('openExternal', () => {
  it('delegates an allowlisted URL to the external-link service', async () => {
    const h = makeHarness()
    await h.handlers.openExternal(['https://github.com/owner/repo'])
    expect(h.externalLink.open).toHaveBeenCalledWith('https://github.com/owner/repo')
  })

  it('rejects a non-https URL before it reaches the opener', async () => {
    const h = makeHarness()
    await expect(h.handlers.openExternal(['http://github.com/owner/repo'])).rejects.toThrow()
    expect(h.externalLink.open).not.toHaveBeenCalled()
  })

  it('rejects a non-string argument', async () => {
    const h = makeHarness()
    await expect(h.handlers.openExternal([123])).rejects.toThrow()
  })
})

// --- Install / uninstall ----------------------------------------------------

describe('installApp', () => {
  it('resolves the release, downloads, installs and persists the app', async () => {
    const h = makeHarness({ apps: [trackedApp()] })
    vi.mocked(h.github.getLatestReleaseWithPackageInfo).mockResolvedValue({
      release: release('v2.0.0'),
      packageName: 'app.deb',
      downloadUrl: 'https://example.com/app.deb',
      releaseDate: null
    })
    vi.mocked(h.installer.identifyAssetType).mockReturnValue(InstallType.deb)
    vi.mocked(h.installer.downloadFile).mockResolvedValue('/tmp/app.deb')
    vi.mocked(h.installer.installPackage).mockResolvedValue({
      launchCommand: '/usr/bin/app',
      packageName: 'app'
    })

    const result = (await h.handlers.installApp([trackedApp().toMap()])) as Record<string, unknown>

    expect(h.github.getLatestReleaseWithPackageInfo).toHaveBeenCalledWith('owner', 'repo', {
      assetFilterPattern: null,
      tagPrefix: null,
      architectures: [],
      includePrerelease: false
    })
    expect(h.installer.identifyAssetType).toHaveBeenCalledWith('app.deb', {
      app: expect.anything()
    })
    expect(h.installer.downloadFile).toHaveBeenCalledWith('https://example.com/app.deb', 'app.deb')
    expect(h.installer.installPackage).toHaveBeenCalledWith('/tmp/app.deb', 'deb', {
      targetPath: null,
      binaryName: null
    })
    expect(result['installed_version']).toBe('v2.0.0')
    expect(result['launch_command']).toBe('/usr/bin/app')
    expect(h.getApps()[0]?.installedVersion).toBe('v2.0.0')
  })

  it('throws when no installable asset is found', async () => {
    const h = makeHarness({ apps: [trackedApp()] })
    vi.mocked(h.github.getLatestReleaseWithPackageInfo).mockResolvedValue(null)

    await expect(h.handlers.installApp([trackedApp().toMap()])).rejects.toThrow(
      /No installable asset/
    )
  })

  it('rejects an invalid app payload', async () => {
    const h = makeHarness()
    await expect(h.handlers.installApp([{ bad: true }])).rejects.toThrow()
  })
})

describe('installDeb', () => {
  it('downloads and installs the package, recording the derived version', async () => {
    const h = makeHarness({ debPackages: [trackedDeb({ name: 'thing' })] })
    vi.mocked(h.installer.downloadFile).mockResolvedValue('/tmp/thing_1.2.3_amd64.deb')
    vi.mocked(h.installer.installPackage).mockResolvedValue({
      launchCommand: '/usr/bin/thing',
      packageName: 'thing'
    })

    const result = (await h.handlers.installDeb([trackedDeb().toMap()])) as Record<string, unknown>

    expect(h.installer.downloadFile).toHaveBeenCalledWith(
      'https://example.com/thing.deb',
      'thing.deb'
    )
    expect(h.installer.installPackage).toHaveBeenCalledWith('/tmp/thing_1.2.3_amd64.deb', 'deb')
    expect(result['installed_version']).toBe('1.2.3')
  })
})

describe('uninstall handlers', () => {
  it('uninstalls an app through the installer', async () => {
    const h = makeHarness()
    await h.handlers.uninstallApp([trackedApp().toMap()])
    expect(h.installer.uninstallPackage).toHaveBeenCalledTimes(1)
    const passed = vi.mocked(h.installer.uninstallPackage).mock.calls[0]?.[0]
    expect(passed).toBeInstanceOf(TrackedApp)
  })

  it('uninstalls a deb package through the installer', async () => {
    const h = makeHarness()
    await h.handlers.uninstallDebPackage([trackedDeb().toMap()])
    expect(h.installer.uninstallDebPackage).toHaveBeenCalledTimes(1)
    const passed = vi.mocked(h.installer.uninstallDebPackage).mock.calls[0]?.[0]
    expect(passed).toBeInstanceOf(TrackedDebPackage)
  })
})

describe('launchApp', () => {
  it('launches the app through the installer', async () => {
    const h = makeHarness()
    await h.handlers.launchApp([trackedApp().toMap()])
    expect(h.installer.launchApp).toHaveBeenCalledTimes(1)
  })
})

describe('launchDeb', () => {
  it('launches the package through the installer', async () => {
    const h = makeHarness()
    await h.handlers.launchDeb([trackedDeb().toMap()])
    expect(h.installer.launchDebPackage).toHaveBeenCalledTimes(1)
    const passed = vi.mocked(h.installer.launchDebPackage).mock.calls[0]?.[0]
    expect(passed).toBeInstanceOf(TrackedDebPackage)
  })
})

// --- Updates ----------------------------------------------------------------

describe('checkAppUpdate', () => {
  it('persists the latest release and detected installed version', async () => {
    const h = makeHarness({ apps: [trackedApp()] })
    vi.mocked(h.github.getLatestReleaseWithPackageInfo).mockResolvedValue({
      release: release('v3.0.0'),
      packageName: 'app.deb',
      downloadUrl: 'https://example.com/app.deb',
      releaseDate: null
    })
    vi.mocked(h.external.getExternalVersion).mockResolvedValue('2.5.0')

    const result = (await h.handlers.checkAppUpdate([trackedApp().toMap()])) as Record<
      string,
      unknown
    >

    expect(result['latest_version']).toBe('v3.0.0')
    expect(result['installed_version']).toBe('2.5.0')
    expect(h.getApps()[0]?.latestVersion).toBe('v3.0.0')
  })

  it('returns the app unchanged when there is nothing new', async () => {
    const h = makeHarness({ apps: [trackedApp()] })
    vi.mocked(h.github.getLatestReleaseWithPackageInfo).mockResolvedValue(null)
    vi.mocked(h.external.getExternalVersion).mockResolvedValue(null)

    const result = (await h.handlers.checkAppUpdate([trackedApp().toMap()])) as Record<
      string,
      unknown
    >
    expect(result['latest_version']).toBeNull()
  })
})

describe('checkDebUpdate', () => {
  it('returns the new version and refreshes metadata', async () => {
    const h = makeHarness({ debPackages: [trackedDeb()] })
    vi.mocked(h.database.fetchDebInfo).mockResolvedValue({
      version: '2.0.0',
      fileSize: '123',
      fileDate: new Date('2026-03-01T00:00:00Z')
    })
    vi.mocked(h.external.getExternalDebVersion).mockResolvedValue('1.0.0')

    const version = await h.handlers.checkDebUpdate([trackedDeb().toMap()])

    expect(version).toBe('2.0.0')
    expect(h.getDebs()[0]?.latestVersion).toBe('2.0.0')
  })

  it('returns null when neither probe yields a version', async () => {
    const h = makeHarness({ debPackages: [trackedDeb()] })
    vi.mocked(h.database.fetchDebInfo).mockResolvedValue({
      version: null,
      fileSize: null,
      fileDate: null
    })
    vi.mocked(h.external.getExternalDebVersion).mockResolvedValue(null)

    expect(await h.handlers.checkDebUpdate([trackedDeb().toMap()])).toBeNull()
  })
})

describe('checkAllUpdates', () => {
  it('sweeps every app and deb and returns the refreshed lists', async () => {
    const h = makeHarness({ apps: [trackedApp()], debPackages: [trackedDeb()] })
    vi.mocked(h.github.getLatestReleaseWithPackageInfo).mockResolvedValue({
      release: release('v4.0.0'),
      packageName: 'app.deb',
      downloadUrl: 'https://example.com/app.deb',
      releaseDate: null
    })
    vi.mocked(h.external.getExternalVersion).mockResolvedValue('3.0.0')
    vi.mocked(h.database.fetchDebInfo).mockResolvedValue({
      version: '2.0.0',
      fileSize: null,
      fileDate: null
    })
    vi.mocked(h.external.getExternalDebVersion).mockResolvedValue('1.0.0')

    const result = (await h.handlers.checkAllUpdates([])) as {
      apps: Array<Record<string, unknown>>
      debPackages: Array<Record<string, unknown>>
    }

    expect(result.apps[0]?.['latest_version']).toBe('v4.0.0')
    expect(result.debPackages[0]?.['latest_version']).toBe('2.0.0')
  })

  it('does not abort the sweep when one repository is unreachable', async () => {
    const h = makeHarness({ apps: [trackedApp()] })
    vi.mocked(h.github.getLatestReleaseWithPackageInfo).mockRejectedValue(new Error('offline'))

    const result = (await h.handlers.checkAllUpdates([])) as { apps: unknown[] }
    expect(result.apps.length).toBe(1)
  })

  it('collects a per-item failure list without aborting the sweep', async () => {
    const good = trackedApp({ id: 1, displayName: 'Good' })
    const bad = trackedApp({ id: 2, repoName: 'broken', displayName: 'Bad' })
    const h = makeHarness({ apps: [good, bad] })
    vi.mocked(h.github.getLatestReleaseWithPackageInfo).mockImplementation(async (_owner, repo) => {
      if (repo === 'broken') throw new Error('offline')
      return {
        release: release('v9.0.0'),
        packageName: 'a.deb',
        downloadUrl: 'https://example.com/a.deb',
        releaseDate: null
      }
    })
    vi.mocked(h.external.getExternalVersion).mockResolvedValue(null)

    const result = (await h.handlers.checkAllUpdates([])) as {
      apps: Array<Record<string, unknown>>
      failures: Array<{ name: string; error: string }>
    }

    expect(result.failures).toEqual([{ name: 'Bad', error: 'offline' }])
    // The reachable app still got its new version persisted.
    expect(result.apps.find((app) => app['display_name'] === 'Good')?.['latest_version']).toBe(
      'v9.0.0'
    )
  })

  it('emits progress events on the event channel during the sweep', async () => {
    const h = makeHarness({ apps: [trackedApp()], debPackages: [trackedDeb()] })
    vi.mocked(h.github.getLatestReleaseWithPackageInfo).mockResolvedValue(null)
    vi.mocked(h.external.getExternalVersion).mockResolvedValue(null)
    vi.mocked(h.database.fetchDebInfo).mockResolvedValue({
      version: null,
      fileSize: null,
      fileDate: null
    })
    vi.mocked(h.external.getExternalDebVersion).mockResolvedValue(null)

    await h.handlers.checkAllUpdates([])

    const events = vi.mocked(h.emit).mock.calls.map((call) => call[0] as Record<string, unknown>)
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((event) => event['method'] === 'checkAllUpdates')).toBe(true)
    const last = events.at(-1)
    expect(last?.['total']).toBe(2)
    expect(last?.['completed']).toBe(2)
  })
})

// --- Tracked-app CRUD -------------------------------------------------------

describe('app CRUD', () => {
  it('addApp assigns the next id and persists', async () => {
    const h = makeHarness({ apps: [trackedApp({ id: 4 })] })

    const id = await h.handlers.addApp([
      { repoOwner: 'owner', repoName: 'new-repo', displayName: 'New' }
    ])

    expect(id).toBe(5)
    expect(h.getApps().some((app) => app.repoName === 'new-repo')).toBe(true)
  })

  it('addApp rejects a duplicate owner/name pair', async () => {
    const h = makeHarness({ apps: [trackedApp()] })
    await expect(
      h.handlers.addApp([{ repoOwner: 'owner', repoName: 'repo', displayName: 'Dup' }])
    ).rejects.toThrow(/already exists/)
  })

  it('addApp persists the requested install type', async () => {
    const h = makeHarness()

    await h.handlers.addApp([
      { repoOwner: 'owner', repoName: 'new-repo', displayName: 'New', installType: 'binary' }
    ])

    const added = h.getApps().find((app) => app.repoName === 'new-repo')
    expect(added?.installType).toBe(InstallType.binary)
  })

  it('addApp stores a null install type when unspecified', async () => {
    const h = makeHarness()

    await h.handlers.addApp([{ repoOwner: 'owner', repoName: 'plain', displayName: 'Plain' }])

    expect(h.getApps().find((app) => app.repoName === 'plain')?.installType).toBeNull()
  })

  it('updateApp replaces the matching record', async () => {
    const h = makeHarness({ apps: [trackedApp()] })
    const updated = trackedApp({ displayName: 'Renamed' })

    await h.handlers.updateApp([updated.toMap()])

    expect(h.getApps()[0]?.displayName).toBe('Renamed')
  })

  it('updateApp throws for an unknown id', async () => {
    const h = makeHarness({ apps: [trackedApp({ id: 1 })] })
    await expect(h.handlers.updateApp([trackedApp({ id: 99 }).toMap()])).rejects.toThrow(
      /not found/
    )
  })

  it('deleteApp removes the matching record', async () => {
    const h = makeHarness({ apps: [trackedApp({ id: 1 }), trackedApp({ id: 2 })] })
    await h.handlers.deleteApp([1])
    expect(h.getApps().map((app) => app.id)).toEqual([2])
  })
})

// --- Tracked-deb CRUD -------------------------------------------------------

describe('deb CRUD', () => {
  it('addDebPackage probes metadata and assigns the next id', async () => {
    const h = makeHarness({ debPackages: [trackedDeb({ id: 3 })] })
    vi.mocked(h.database.fetchDebInfo).mockResolvedValue({
      version: '1.0.0',
      fileSize: '99',
      fileDate: new Date('2026-01-01T00:00:00Z')
    })

    const id = await h.handlers.addDebPackage([
      { name: 'new', packageUrl: 'https://example.com/new.deb' }
    ])

    expect(id).toBe(4)
    expect(h.database.fetchDebInfo).toHaveBeenCalledWith('https://example.com/new.deb')
    const added = h.getDebs().find((pkg) => pkg.id === 4)
    expect(added?.fileSize).toBe('99')
  })

  it('addDebPackage rejects a duplicate URL', async () => {
    const h = makeHarness({ debPackages: [trackedDeb()] })
    await expect(
      h.handlers.addDebPackage([{ name: 'dup', packageUrl: 'https://example.com/thing.deb' }])
    ).rejects.toThrow(/already exists/)
  })

  it('updateDebPackage and deleteDebPackage mutate the store', async () => {
    const h = makeHarness({ debPackages: [trackedDeb({ id: 1 }), trackedDeb({ id: 2 })] })
    await h.handlers.updateDebPackage([trackedDeb({ id: 1, displayName: 'Renamed' }).toMap()])
    await h.handlers.deleteDebPackage([2])

    expect(h.getDebs().map((pkg) => pkg.id)).toEqual([1])
    expect(h.getDebs()[0]?.displayName).toBe('Renamed')
  })

  it('updateDebPackage throws for an unknown id', async () => {
    const h = makeHarness({ debPackages: [trackedDeb({ id: 1 })] })
    await expect(h.handlers.updateDebPackage([trackedDeb({ id: 9 }).toMap()])).rejects.toThrow(
      /not found/
    )
  })
})

// --- Data / settings --------------------------------------------------------

describe('data handlers', () => {
  it('exportData returns the path from the config service', async () => {
    const h = makeHarness()
    vi.mocked(h.config.exportConfig).mockResolvedValue('/data/autonex-export.json')
    expect(await h.handlers.exportData([])).toEqual({ path: '/data/autonex-export.json' })
  })

  it('importData returns the imported count', async () => {
    const h = makeHarness()
    vi.mocked(h.config.importConfig).mockResolvedValue(3)
    expect(await h.handlers.importData([])).toEqual({ count: 3 })
  })
})

describe('setSettings', () => {
  it('merges the supplied keys and strips token keys', async () => {
    const h = makeHarness({ settings: { theme: 'dark' } })

    await h.handlers.setSettings([
      { theme: 'light', github_releases_per_page: 50, github_token: 'evil' }
    ])

    const settings = h.getSettings()
    expect(settings['theme']).toBe('light')
    expect(settings['github_releases_per_page']).toBe(50)
    expect(settings['github_token']).toBeUndefined()
  })

  it('applies the enable_debug_logging preference to the logger', async () => {
    const h = makeHarness()

    await h.handlers.setSettings([{ enable_debug_logging: false }])
    expect(h.debugLog.setEnabled).toHaveBeenCalledWith(false)

    await h.handlers.setSettings([{ enable_debug_logging: true }])
    expect(h.debugLog.setEnabled).toHaveBeenLastCalledWith(true)
  })

  it('leaves the logger untouched when the setting is absent', async () => {
    const h = makeHarness()

    await h.handlers.setSettings([{ theme: 'dark' }])

    expect(h.debugLog.setEnabled).not.toHaveBeenCalled()
  })
})

// --- Diagnostics ------------------------------------------------------------

describe('diagnostics handlers', () => {
  it('getDebugLog returns the logger tail', async () => {
    const h = makeHarness()
    vi.mocked(h.debugLog.readTail).mockResolvedValue({ content: 'hello', truncated: true })

    expect(await h.handlers.getDebugLog([])).toEqual({ content: 'hello', truncated: true })
  })

  it('clearDebugLog empties the log', async () => {
    const h = makeHarness()
    await h.handlers.clearDebugLog([])
    expect(h.debugLog.clear).toHaveBeenCalledTimes(1)
  })

  it('rejects arguments on the no-argument diagnostics channels', async () => {
    const h = makeHarness()
    await expect(h.handlers.getDebugLog([{ unexpected: true }])).rejects.toThrow()
  })
})

// --- Batch ------------------------------------------------------------------

describe('batchInstall', () => {
  it('installs each item, emits progress and reports results', async () => {
    const app = trackedApp()
    const h = makeHarness({ apps: [app] })
    vi.mocked(h.github.getLatestReleaseWithPackageInfo).mockResolvedValue({
      release: release('v5.0.0'),
      packageName: 'app.deb',
      downloadUrl: 'https://example.com/app.deb',
      releaseDate: null
    })
    vi.mocked(h.installer.identifyAssetType).mockReturnValue(InstallType.deb)
    vi.mocked(h.installer.downloadFile).mockResolvedValue('/tmp/app.deb')
    vi.mocked(h.installer.installPackage).mockResolvedValue({
      launchCommand: '/usr/bin/app',
      packageName: 'app'
    })

    const results = (await h.handlers.batchInstall([[app.toMap()], []])) as Array<
      Record<string, unknown>
    >

    expect(results).toHaveLength(1)
    expect(results[0]?.['success']).toBe(true)
    expect(results[0]?.['newVersion']).toBe('v5.0.0')
    expect(h.emit).toHaveBeenCalled()
    const lastEvent = vi.mocked(h.emit).mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(lastEvent['method']).toBe('batchInstall')
    expect(lastEvent['completed']).toBe(1)
    expect(lastEvent['total']).toBe(1)
  })

  it('reports a failed item without aborting the batch', async () => {
    const app = trackedApp()
    const h = makeHarness({ apps: [app] })
    vi.mocked(h.github.getLatestReleaseWithPackageInfo).mockRejectedValue(new Error('offline'))

    const results = (await h.handlers.batchInstall([[app.toMap()], []])) as Array<
      Record<string, unknown>
    >
    expect(results[0]?.['success']).toBe(false)
    expect(results[0]?.['error']).toBe('offline')
  })
})

describe('batchDelete', () => {
  it('deletes the requested ids and returns a summary', async () => {
    const h = makeHarness({
      apps: [trackedApp({ id: 1 }), trackedApp({ id: 2 })],
      debPackages: [trackedDeb({ id: 1 })]
    })

    const summary = await h.handlers.batchDelete([[1, 99], [1]])

    expect(summary).toEqual({ succeeded: 2, failed: 1 })
    expect(h.getApps().map((app) => app.id)).toEqual([2])
    expect(h.getDebs()).toHaveLength(0)
    expect(h.emit).toHaveBeenCalled()
  })
})

describe('batchUpdate', () => {
  it('checks each item and reports the new version', async () => {
    const app = trackedApp()
    const h = makeHarness({ apps: [app] })
    vi.mocked(h.github.getLatestReleaseWithPackageInfo).mockResolvedValue({
      release: release('v6.0.0'),
      packageName: 'app.deb',
      downloadUrl: 'https://example.com/app.deb',
      releaseDate: null
    })
    vi.mocked(h.external.getExternalVersion).mockResolvedValue('1.0.0')

    const results = (await h.handlers.batchUpdate([[app.toMap()], []])) as Array<
      Record<string, unknown>
    >

    expect(results[0]?.['newVersion']).toBe('v6.0.0')
    const event = vi.mocked(h.emit).mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(event['method']).toBe('batchUpdate')
  })
})

// --- maskSettings -----------------------------------------------------------

describe('maskSettings', () => {
  it('removes both token keys and adds the flag', () => {
    const masked = maskSettings({ theme: 'dark', github_token: 'a', github_token_enc: 'b' }, true)
    expect(masked).toEqual({ theme: 'dark', hasGithubToken: true })
  })
})
