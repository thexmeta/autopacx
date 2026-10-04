// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it, vi } from 'vitest'
import { InstallType } from '@core/models/install-type'
import { Release } from '@core/models/release'
import { TrackedApp } from '@core/models/tracked-app'
import { AppService } from './app-service'
import type { ExternalCheckerLike, GitHubLike, InstallerLike, TrackedStoreLike } from './ports'
import { TrackedRepository } from './tracked-repository'

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

function release(tagName = 'v2.0.0'): Release {
  return new Release({
    tagName,
    prerelease: false,
    draft: false,
    assets: [],
    publishedAt: new Date('2026-02-01T00:00:00Z')
  })
}

function makeService(init: { apps?: TrackedApp[] } = {}) {
  let apps = [...(init.apps ?? [])]
  const store: TrackedStoreLike = {
    readApps: async () => [...apps],
    writeApps: async (next) => {
      apps = [...next]
    },
    readDebPackages: async () => [],
    writeDebPackages: async () => undefined
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
  const external: ExternalCheckerLike = {
    getExternalVersion: vi.fn(),
    getExternalDebVersion: vi.fn()
  }
  const service = new AppService({
    github,
    installer,
    external,
    repo: new TrackedRepository(store)
  })
  return { service, github, installer, external, getApps: () => apps }
}

describe('AppService.install', () => {
  it('resolves, downloads, installs and persists the app', async () => {
    const h = makeService({ apps: [trackedApp()] })
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

    const updated = await h.service.install(trackedApp(), {})

    expect(updated.installedVersion).toBe('v2.0.0')
    expect(updated.launchCommand).toBe('/usr/bin/app')
    expect(h.getApps()[0]?.installedVersion).toBe('v2.0.0')
  })

  it('throws when no installable asset is found', async () => {
    const h = makeService({ apps: [trackedApp()] })
    vi.mocked(h.github.getLatestReleaseWithPackageInfo).mockResolvedValue(null)

    await expect(h.service.install(trackedApp(), {})).rejects.toThrow(/No installable asset/)
  })
})

describe('AppService.check', () => {
  it('persists the latest release and the detected installed version', async () => {
    const h = makeService({ apps: [trackedApp()] })
    vi.mocked(h.github.getLatestReleaseWithPackageInfo).mockResolvedValue({
      release: release('v3.0.0'),
      packageName: 'app.deb',
      downloadUrl: 'https://example.com/app.deb',
      releaseDate: null
    })
    vi.mocked(h.external.getExternalVersion).mockResolvedValue('2.5.0')

    const updated = await h.service.check(trackedApp())

    expect(updated.latestVersion).toBe('v3.0.0')
    expect(updated.installedVersion).toBe('2.5.0')
  })

  it('returns the app unchanged when there is nothing new', async () => {
    const h = makeService({ apps: [trackedApp()] })
    vi.mocked(h.github.getLatestReleaseWithPackageInfo).mockResolvedValue(null)
    vi.mocked(h.external.getExternalVersion).mockResolvedValue(null)

    const updated = await h.service.check(trackedApp())
    expect(updated.latestVersion).toBeNull()
  })
})

describe('AppService.add / update / remove', () => {
  it('assigns the next id and stores the install type', async () => {
    const h = makeService({ apps: [trackedApp({ id: 4 })] })

    const id = await h.service.add({
      repoOwner: 'owner',
      repoName: 'new-repo',
      displayName: 'New',
      installType: 'binary'
    })

    expect(id).toBe(5)
    const added = h.getApps().find((app) => app.repoName === 'new-repo')
    expect(added?.installType).toBe(InstallType.binary)
  })

  it('rejects a duplicate owner/name pair', async () => {
    const h = makeService({ apps: [trackedApp()] })
    await expect(
      h.service.add({ repoOwner: 'owner', repoName: 'repo', displayName: 'Dup' })
    ).rejects.toThrow(/already exists/)
  })

  it('updates and removes records', async () => {
    const h = makeService({ apps: [trackedApp({ id: 1 }), trackedApp({ id: 2 })] })

    await h.service.update(trackedApp({ id: 1, displayName: 'Renamed' }))
    await h.service.remove(2)

    expect(h.getApps().map((app) => app.id)).toEqual([1])
    expect(h.getApps()[0]?.displayName).toBe('Renamed')
  })
})
