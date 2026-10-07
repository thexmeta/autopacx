// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it, vi } from 'vitest'
import type { Settings } from '@core/api'
import { InstallType } from '@core/models/install-type'
import { Release } from '@core/models/release'
import { TrackedApp } from '@core/models/tracked-app'
import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { TrackedPacstallPackage } from '@core/models/tracked-pacstall-package'
import {
  createHandlers,
  maskSettings,
  SETTINGS_DEFAULTS,
  type ConfigLike,
  type DatabaseLike,
  type DebugLogLike,
  type ExternalCheckerLike,
  type ExternalLinkLike,
  type GitHubLike,
  type InstallLocationLike,
  type InstallerLike,
  type IpcDependencies,
  type PacstallLike,
  type PacstallRegistryPort,
  type StoreLike,
  type TokenLike
} from './ipc-handlers'

// The main-process clipboard is the only Electron surface `createHandlers`
// touches. Stub it so this suite stays Node-only and can drive the value.
const { clipboardReadText } = vi.hoisted(() => ({
  clipboardReadText: vi.fn<() => string>(() => 'clipboard text')
}))
vi.mock('electron', () => ({ clipboard: { readText: clipboardReadText } }))

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

function trackedPacstall(
  overrides: Partial<ConstructorParameters<typeof TrackedPacstallPackage>[0]> = {}
): TrackedPacstallPackage {
  return new TrackedPacstallPackage({
    id: 1,
    name: 'neovim',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    registryRepo: 'pacstall/pacstall-programs',
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
  pacstallPackages?: TrackedPacstallPackage[]
  settings?: Settings
}

function makeHarness(init: HarnessInit = {}) {
  let apps = [...(init.apps ?? [])]
  let debPackages = [...(init.debPackages ?? [])]
  let pacstallPackages = [...(init.pacstallPackages ?? [])]
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
    readPacstallPackages: vi.fn(async () => [...pacstallPackages]),
    writePacstallPackages: vi.fn(async (next: readonly TrackedPacstallPackage[]) => {
      pacstallPackages = [...next]
    }),
    readSettings: vi.fn(async () => ({ ...settings })),
    writeSettings: vi.fn(async (next: Settings) => {
      settings = { ...next }
    })
  }

  const github: GitHubLike = {
    getLatestRelease: vi.fn(),
    getLatestReleaseWithPackageInfo: vi.fn(),
    getGithubReleaseAssets: vi.fn(),
    searchRepositories: vi.fn()
  }
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
  const pacstall: PacstallLike = {
    status: vi.fn(async () => ({
      installed: false,
      version: null,
      path: null,
      pathUnexpected: false
    })),
    install: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    upgrade: vi.fn(async () => undefined),
    upgradeAll: vi.fn(async () => undefined),
    checkUpdate: vi.fn(async () => null),
    readInstalledVersion: vi.fn(async () => 'unknown'),
    launch: vi.fn(async () => undefined)
  }
  const pacstallRegistry: PacstallRegistryPort = {
    fetchIndex: vi.fn(async () => ({
      names: [],
      fetchedAt: new Date().toISOString(),
      fromCache: false
    })),
    fetchPackageInfo: vi.fn(async () => ({
      pkgname: '',
      pkgver: '',
      pkgdesc: '',
      arch: [],
      depends: [],
      optdepends: [],
      makedepends: [],
      maintainer: '',
      url: '',
      license: [],
      source: [],
      sha256sums: []
    }))
  }
  const emit = vi.fn()
  const installLocation: InstallLocationLike = { suggestTargets: vi.fn(async () => []) }

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
    pacstall,
    pacstallRegistry,
    installLocation,
    appVersion: '1.2.3',
    emit
  }

  return {
    handlers: createHandlers(deps),
    store,
    github,
    installer,
    database,
    external,
    token,
    config,
    debugLog,
    externalLink,
    pacstall,
    pacstallRegistry,
    installLocation,
    emit,
    getApps: () => apps,
    getDebs: () => debPackages,
    getPacstall: () => pacstallPackages,
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

  it('reads the clipboard text via the main-process clipboard', async () => {
    const h = makeHarness()
    clipboardReadText.mockReturnValue('https://github.com/owner/repo')

    expect(await h.handlers.readClipboardText([])).toBe('https://github.com/owner/repo')
    expect(clipboardReadText).toHaveBeenCalledTimes(1)
  })

  it('rejects arguments on the no-argument clipboard read', async () => {
    const h = makeHarness()
    await expect(h.handlers.readClipboardText([{ unexpected: true }])).rejects.toThrow()
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
  it('uninstalls an app through the installer and clears its persisted install state', async () => {
    const app = trackedApp({
      installedVersion: 'v1.0.0',
      installType: InstallType.deb,
      launchCommand: '/usr/bin/app',
      packageName: 'app'
    })
    const h = makeHarness({ apps: [app] })

    await h.handlers.uninstallApp([app.toMap()])

    expect(h.installer.uninstallPackage).toHaveBeenCalledTimes(1)
    const passed = vi.mocked(h.installer.uninstallPackage).mock.calls[0]?.[0]
    expect(passed).toBeInstanceOf(TrackedApp)

    const stored = h.getApps()[0]
    expect(stored?.installedVersion).toBeNull()
    expect(stored?.installType).toBeNull()
    expect(stored?.launchCommand).toBeNull()
    expect(stored?.packageName).toBeNull()
    expect(stored?.lastChecked).toBeInstanceOf(Date)
  })

  it('propagates a store-write failure from uninstallApp', async () => {
    const h = makeHarness({ apps: [trackedApp({ installedVersion: 'v1.0.0' })] })
    vi.mocked(h.store.writeApps).mockRejectedValueOnce(new Error('disk full'))

    await expect(h.handlers.uninstallApp([trackedApp().toMap()])).rejects.toThrow(/disk full/)
  })

  it('uninstalls a deb package through the installer and clears its persisted state', async () => {
    const pkg = trackedDeb({
      installedVersion: '1.2.3',
      launchCommand: '/usr/bin/thing',
      packageName: 'thing'
    })
    const h = makeHarness({ debPackages: [pkg] })

    await h.handlers.uninstallDebPackage([pkg.toMap()])

    expect(h.installer.uninstallDebPackage).toHaveBeenCalledTimes(1)
    const passed = vi.mocked(h.installer.uninstallDebPackage).mock.calls[0]?.[0]
    expect(passed).toBeInstanceOf(TrackedDebPackage)

    const stored = h.getDebs()[0]
    expect(stored?.installedVersion).toBeNull()
    expect(stored?.launchCommand).toBeNull()
    expect(stored?.packageName).toBeNull()
    expect(stored?.lastChecked).toBeInstanceOf(Date)
  })
})

describe('getInstallTargets', () => {
  it('returns candidates and derives defaultPath from the recommended entry', async () => {
    const h = makeHarness()
    const candidates = [
      {
        path: '/usr/local/bin',
        writable: true,
        onPath: true,
        ownedByPackage: false,
        recommended: false
      },
      {
        path: '/home/u/.local/bin',
        writable: true,
        onPath: true,
        ownedByPackage: false,
        recommended: true
      }
    ]
    vi.mocked(h.installLocation.suggestTargets).mockResolvedValue(candidates)

    const result = (await h.handlers.getInstallTargets([{ name: 'myapp' }])) as {
      candidates: unknown[]
      defaultPath: string | null
    }

    const passedApp = vi.mocked(h.installLocation.suggestTargets).mock.calls[0]?.[0]
    expect(passedApp).toBeInstanceOf(TrackedApp)
    expect(passedApp?.repoName).toBe('myapp')
    expect(result.candidates).toEqual(candidates)
    expect(result.defaultPath).toBe('/home/u/.local/bin')
  })

  it('returns a null defaultPath when no candidate is recommended', async () => {
    const h = makeHarness()
    vi.mocked(h.installLocation.suggestTargets).mockResolvedValue([
      {
        path: '/usr/local/bin',
        writable: true,
        onPath: true,
        ownedByPackage: false,
        recommended: false
      }
    ])

    const result = (await h.handlers.getInstallTargets([{ name: 'myapp' }])) as {
      defaultPath: string | null
    }
    expect(result.defaultPath).toBeNull()
  })

  it('rejects a blank name before reaching the location service', async () => {
    const h = makeHarness()
    await expect(h.handlers.getInstallTargets([{ name: '' }])).rejects.toThrow()
    expect(h.installLocation.suggestTargets).not.toHaveBeenCalled()
  })
})

describe('operation progress events', () => {
  it('emits starting then done around a successful install', async () => {
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

    await h.handlers.installApp([trackedApp().toMap()])

    const events = vi
      .mocked(h.emit)
      .mock.calls.map((call) => call[0] as Record<string, unknown>)
      .filter((event) => event['kind'] === 'operation' && event['method'] === 'installApp')

    expect(events.map((event) => event['phase'])).toEqual(['starting', 'done'])
    expect(events[0]).toMatchObject({
      kind: 'operation',
      method: 'installApp',
      name: 'App',
      completed: 0,
      total: 1
    })
    expect(events[1]).toMatchObject({ phase: 'done', completed: 1, total: 1 })
  })

  it('emits starting then failed (with detail) and rethrows on a failing install', async () => {
    const h = makeHarness({ apps: [trackedApp()] })
    vi.mocked(h.github.getLatestReleaseWithPackageInfo).mockRejectedValue(new Error('offline'))

    await expect(h.handlers.installApp([trackedApp().toMap()])).rejects.toThrow('offline')

    const events = vi
      .mocked(h.emit)
      .mock.calls.map((call) => call[0] as Record<string, unknown>)
      .filter((event) => event['kind'] === 'operation' && event['method'] === 'installApp')

    expect(events.map((event) => event['phase'])).toEqual(['starting', 'failed'])
    expect(events[1]).toMatchObject({
      phase: 'failed',
      completed: 1,
      total: 1,
      detail: 'offline'
    })
  })

  it('does not emit operation events for batch handlers', async () => {
    const app = trackedApp()
    const h = makeHarness({ apps: [app] })
    vi.mocked(h.github.getLatestReleaseWithPackageInfo).mockResolvedValue(null)
    vi.mocked(h.external.getExternalVersion).mockResolvedValue(null)

    await h.handlers.batchUpdate([[app.toMap()], [], []])

    const operationEvents = vi
      .mocked(h.emit)
      .mock.calls.map((call) => call[0] as Record<string, unknown>)
      .filter((event) => event['kind'] === 'operation')
    expect(operationEvents).toEqual([])
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

  it('sweeps pacstall packages too, returning the refreshed list', async () => {
    const pkg = trackedPacstall()
    const h = makeHarness({ pacstallPackages: [pkg] })
    vi.mocked(h.pacstall.checkUpdate).mockResolvedValue('0.12.0')

    const result = (await h.handlers.checkAllUpdates([])) as {
      pacstallPackages: Array<Record<string, unknown>>
      failures: Array<{ name: string; error: string }>
    }

    expect(h.pacstall.checkUpdate).toHaveBeenCalledTimes(1)
    expect(result.pacstallPackages[0]?.['latest_version']).toBe('0.12.0')
    expect(result.failures).toEqual([])
  })

  it('collects a pacstall failure without aborting the sweep', async () => {
    const pkg = trackedPacstall({ displayName: 'Neovim' })
    const h = makeHarness({ pacstallPackages: [pkg] })
    vi.mocked(h.pacstall.checkUpdate).mockRejectedValue(new Error('registry offline'))

    const result = (await h.handlers.checkAllUpdates([])) as {
      failures: Array<{ name: string; error: string }>
    }

    expect(result.failures).toEqual([{ name: 'Neovim', error: 'registry offline' }])
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
    vi.mocked(h.config.exportConfig).mockResolvedValue('/data/autopacx-export.json')
    expect(await h.handlers.exportData([])).toEqual({ path: '/data/autopacx-export.json' })
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

    const results = (await h.handlers.batchInstall([[app.toMap()], [], []])) as Array<
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

    const results = (await h.handlers.batchInstall([[app.toMap()], [], []])) as Array<
      Record<string, unknown>
    >
    expect(results[0]?.['success']).toBe(false)
    expect(results[0]?.['error']).toBe('offline')
  })

  it('installs a pacstall package from the third array', async () => {
    const pkg = trackedPacstall()
    const h = makeHarness({ pacstallPackages: [pkg] })
    vi.mocked(h.pacstall.readInstalledVersion).mockResolvedValue('0.10.0')

    const results = (await h.handlers.batchInstall([[], [], [pkg.toMap()]])) as Array<
      Record<string, unknown>
    >

    expect(h.pacstall.install).toHaveBeenCalledWith('neovim')
    expect(results).toHaveLength(1)
    expect(results[0]?.['appName']).toBe('neovim')
    expect(results[0]?.['newVersion']).toBe('0.10.0')
    expect(h.getPacstall()[0]?.installedVersion).toBe('0.10.0')
    const lastEvent = vi.mocked(h.emit).mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(lastEvent['total']).toBe(1)
    expect(lastEvent['completed']).toBe(1)
  })
})

describe('batchDelete', () => {
  it('deletes the requested ids and returns a summary', async () => {
    const h = makeHarness({
      apps: [trackedApp({ id: 1 }), trackedApp({ id: 2 })],
      debPackages: [trackedDeb({ id: 1 })]
    })

    const summary = await h.handlers.batchDelete([[1, 99], [1], []])

    expect(summary).toEqual({ succeeded: 2, failed: 1 })
    expect(h.getApps().map((app) => app.id)).toEqual([2])
    expect(h.getDebs()).toHaveLength(0)
    expect(h.emit).toHaveBeenCalled()
  })

  it('deletes pacstall ids from the third list', async () => {
    const h = makeHarness({
      pacstallPackages: [trackedPacstall({ id: 1 }), trackedPacstall({ id: 2 })]
    })

    const summary = await h.handlers.batchDelete([[], [], [1, 7]])

    expect(summary).toEqual({ succeeded: 1, failed: 1 })
    expect(h.getPacstall().map((pkg) => pkg.id)).toEqual([2])
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

    const results = (await h.handlers.batchUpdate([[app.toMap()], [], []])) as Array<
      Record<string, unknown>
    >

    expect(results[0]?.['newVersion']).toBe('v6.0.0')
    const event = vi.mocked(h.emit).mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(event['method']).toBe('batchUpdate')
  })

  it('checks a pacstall package from the third array and persists the update', async () => {
    const pkg = trackedPacstall()
    const h = makeHarness({ pacstallPackages: [pkg] })
    vi.mocked(h.pacstall.checkUpdate).mockResolvedValue('0.11.0')

    const results = (await h.handlers.batchUpdate([[], [], [pkg.toMap()]])) as Array<
      Record<string, unknown>
    >

    expect(h.pacstall.checkUpdate).toHaveBeenCalledTimes(1)
    expect(results[0]?.['appName']).toBe('neovim')
    expect(results[0]?.['newVersion']).toBe('0.11.0')
    expect(h.getPacstall()[0]?.latestVersion).toBe('0.11.0')
  })
})

// --- GitHub repository search -----------------------------------------------

describe('searchGithubRepositories', () => {
  it('forwards query, page, perPage and sort to the GitHub service', async () => {
    const h = makeHarness()
    const result = { total_count: 0, incomplete_results: false, items: [] }
    vi.mocked(h.github.searchRepositories).mockResolvedValue(result)

    const returned = await h.handlers.searchGithubRepositories([
      { query: 'pacstall', page: 2, perPage: 10, sort: 'stars' }
    ])

    expect(h.github.searchRepositories).toHaveBeenCalledWith('pacstall', {
      sort: 'stars',
      perPage: 10,
      page: 2
    })
    expect(returned).toBe(result)
  })

  it("maps 'best-match' to a null sort and applies defaults", async () => {
    const h = makeHarness()
    vi.mocked(h.github.searchRepositories).mockResolvedValue({
      total_count: 0,
      incomplete_results: false,
      items: []
    })

    await h.handlers.searchGithubRepositories([{ query: 'neovim', sort: 'best-match' }])

    expect(h.github.searchRepositories).toHaveBeenCalledWith('neovim', {
      sort: null,
      perPage: null,
      page: null
    })
  })

  it('rejects a blank query', async () => {
    const h = makeHarness()
    await expect(h.handlers.searchGithubRepositories([{ query: '' }])).rejects.toThrow()
    expect(h.github.searchRepositories).not.toHaveBeenCalled()
  })
})

describe('getGithubReleaseAssets', () => {
  it('forwards the repo and prerelease flag to the GitHub service', async () => {
    const h = makeHarness()
    const result = {
      tagName: 'v1.0.0',
      assets: [
        {
          name: 'app-amd64.deb',
          size: 42,
          downloadUrl: 'https://example.com/app-amd64.deb',
          installType: 'deb'
        }
      ],
      publishedAt: '2026-01-01T00:00:00Z'
    }
    vi.mocked(h.github.getGithubReleaseAssets).mockResolvedValue(result)

    const returned = await h.handlers.getGithubReleaseAssets([
      { repoOwner: 'o', repoName: 'r', includePrerelease: true }
    ])

    expect(h.github.getGithubReleaseAssets).toHaveBeenCalledWith('o', 'r', {
      includePrerelease: true
    })
    expect(returned).toBe(result)
  })

  it('defaults includePrerelease to false', async () => {
    const h = makeHarness()
    vi.mocked(h.github.getGithubReleaseAssets).mockResolvedValue({
      tagName: null,
      assets: [],
      publishedAt: null
    })

    await h.handlers.getGithubReleaseAssets([{ repoOwner: 'o', repoName: 'r' }])

    expect(h.github.getGithubReleaseAssets).toHaveBeenCalledWith('o', 'r', {
      includePrerelease: false
    })
  })

  it('rejects a blank repo owner before calling the service', async () => {
    const h = makeHarness()
    await expect(
      h.handlers.getGithubReleaseAssets([{ repoOwner: '', repoName: 'r' }])
    ).rejects.toThrow()
    expect(h.github.getGithubReleaseAssets).not.toHaveBeenCalled()
  })
})

// --- Pacstall ---------------------------------------------------------------

describe('pacstall read handlers', () => {
  it('getPacstallStatus merges the settings enabled flag', async () => {
    const h = makeHarness({ settings: { pacstall_enabled: true } })
    vi.mocked(h.pacstall.status).mockResolvedValue({
      installed: true,
      version: '6.2.0',
      path: '/usr/bin/pacstall',
      pathUnexpected: false
    })

    const status = (await h.handlers.getPacstallStatus([])) as Record<string, unknown>

    expect(status).toEqual({
      installed: true,
      version: '6.2.0',
      path: '/usr/bin/pacstall',
      pathUnexpected: false,
      enabled: true
    })
  })

  it('getPacstallStatus defaults enabled to false', async () => {
    const h = makeHarness()
    const status = (await h.handlers.getPacstallStatus([])) as Record<string, unknown>
    expect(status['enabled']).toBe(false)
  })

  it('getPacstallIndex forwards the force flag to the registry', async () => {
    const h = makeHarness()
    const index = { names: ['neovim'], fetchedAt: '2026-01-01T00:00:00Z', fromCache: false }
    vi.mocked(h.pacstallRegistry.fetchIndex).mockResolvedValue(index)

    expect(await h.handlers.getPacstallIndex([{ force: true }])).toBe(index)
    expect(h.pacstallRegistry.fetchIndex).toHaveBeenCalledWith({ force: true })
  })

  it('getPacstallIndex tolerates no arguments', async () => {
    const h = makeHarness()
    await h.handlers.getPacstallIndex([])
    expect(h.pacstallRegistry.fetchIndex).toHaveBeenCalledWith({ force: false })
  })

  it('getPacstallPackageInfo looks the package up by name', async () => {
    const h = makeHarness()
    await h.handlers.getPacstallPackageInfo([{ name: 'neovim' }])
    expect(h.pacstallRegistry.fetchPackageInfo).toHaveBeenCalledWith('neovim')
  })

  it('getPacstallPackages returns the tracked list as wire maps', async () => {
    const h = makeHarness({ pacstallPackages: [trackedPacstall()] })
    const packages = (await h.handlers.getPacstallPackages([])) as Array<Record<string, unknown>>
    expect(packages[0]?.['name']).toBe('neovim')
  })
})

describe('pacstall CRUD handlers', () => {
  it('addPacstallPackage assigns the next id and uses the configured registry repo', async () => {
    const h = makeHarness({
      pacstallPackages: [trackedPacstall({ id: 3 })],
      settings: { pacstall_registry_repo: 'me/mirror' }
    })

    const id = await h.handlers.addPacstallPackage([
      { name: 'htop', displayName: 'Htop', autoUpdate: true }
    ])

    expect(id).toBe(4)
    const added = h.getPacstall().find((pkg) => pkg.id === 4)
    expect(added?.name).toBe('htop')
    expect(added?.displayName).toBe('Htop')
    expect(added?.autoUpdate).toBe(true)
    expect(added?.registryRepo).toBe('me/mirror')
  })

  it('addPacstallPackage rejects a duplicate name', async () => {
    const h = makeHarness({ pacstallPackages: [trackedPacstall()] })
    await expect(h.handlers.addPacstallPackage([{ name: 'neovim' }])).rejects.toThrow(
      /already exists/
    )
  })

  it('installPacstallPackage installs, records the version and persists', async () => {
    const pkg = trackedPacstall()
    const h = makeHarness({ pacstallPackages: [pkg] })
    vi.mocked(h.pacstall.readInstalledVersion).mockResolvedValue('0.10.0-pacstall1')

    const result = (await h.handlers.installPacstallPackage([pkg.toMap()])) as Record<
      string,
      unknown
    >

    expect(h.pacstall.install).toHaveBeenCalledWith('neovim')
    expect(result['installed_version']).toBe('0.10.0-pacstall1')
    expect(h.getPacstall()[0]?.installedVersion).toBe('0.10.0-pacstall1')
  })

  it('uninstallPacstallPackage delegates to the pacstall remove verb', async () => {
    const h = makeHarness()
    await h.handlers.uninstallPacstallPackage([trackedPacstall().toMap()])
    expect(h.pacstall.remove).toHaveBeenCalledWith('neovim')
  })

  it('checkPacstallUpdate returns the new version and persists it', async () => {
    const pkg = trackedPacstall()
    const h = makeHarness({ pacstallPackages: [pkg] })
    vi.mocked(h.pacstall.checkUpdate).mockResolvedValue('0.11.0')

    const version = await h.handlers.checkPacstallUpdate([pkg.toMap()])

    expect(version).toBe('0.11.0')
    expect(h.getPacstall()[0]?.latestVersion).toBe('0.11.0')
  })

  it('updatePacstallPackage upgrades and refreshes the installed version', async () => {
    const pkg = trackedPacstall()
    const h = makeHarness({ pacstallPackages: [pkg] })
    vi.mocked(h.pacstall.readInstalledVersion).mockResolvedValue('0.11.0')

    await h.handlers.updatePacstallPackage([pkg.toMap()])

    expect(h.pacstall.upgrade).toHaveBeenCalledWith('neovim')
    expect(h.getPacstall()[0]?.installedVersion).toBe('0.11.0')
  })

  it('deletePacstallPackage removes the matching record', async () => {
    const h = makeHarness({
      pacstallPackages: [trackedPacstall({ id: 1 }), trackedPacstall({ id: 2 })]
    })
    await h.handlers.deletePacstallPackage([1])
    expect(h.getPacstall().map((pkg) => pkg.id)).toEqual([2])
  })

  it('launchPacstall delegates to the pacstall launcher', async () => {
    const h = makeHarness()
    await h.handlers.launchPacstall([trackedPacstall().toMap()])
    expect(h.pacstall.launch).toHaveBeenCalledTimes(1)
  })
})

describe('checkPacstallAllUpdates', () => {
  it('sweeps every pacstall package and returns the refreshed list', async () => {
    const h = makeHarness({
      pacstallPackages: [trackedPacstall({ id: 1 }), trackedPacstall({ id: 2, name: 'htop' })]
    })
    vi.mocked(h.pacstall.checkUpdate).mockResolvedValue('0.12.0')

    const result = (await h.handlers.checkPacstallAllUpdates([])) as {
      packages: Array<Record<string, unknown>>
      failures: Array<{ name: string; error: string }>
    }

    expect(h.pacstall.checkUpdate).toHaveBeenCalledTimes(2)
    expect(result.packages).toHaveLength(2)
    expect(result.failures).toEqual([])
  })

  it('collects failures without aborting', async () => {
    const h = makeHarness({ pacstallPackages: [trackedPacstall({ displayName: 'Broken' })] })
    vi.mocked(h.pacstall.checkUpdate).mockRejectedValue(new Error('offline'))

    const result = (await h.handlers.checkPacstallAllUpdates([])) as {
      failures: Array<{ name: string; error: string }>
    }

    expect(result.failures).toEqual([{ name: 'Broken', error: 'offline' }])
  })
})

describe('settings defaults', () => {
  it('applies documented defaults under persisted values', async () => {
    const h = makeHarness({ settings: { theme: 'dark', github_search_per_page: 50 } })

    const settings = (await h.handlers.getSettings([])) as Record<string, unknown>

    expect(settings['theme']).toBe('dark')
    expect(settings['github_search_per_page']).toBe(50)
    expect(settings['pacstall_registry_repo']).toBe(SETTINGS_DEFAULTS['pacstall_registry_repo'])
    expect(settings['pacstall_enabled']).toBe(false)
    expect(settings['github_search_sort']).toBe('best-match')
  })
})

// --- maskSettings -----------------------------------------------------------

describe('maskSettings', () => {
  it('removes both token keys and adds the flag', () => {
    const masked = maskSettings({ theme: 'dark', github_token: 'a', github_token_enc: 'b' }, true)
    expect(masked).toEqual({ theme: 'dark', hasGithubToken: true })
  })
})
