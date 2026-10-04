// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it, vi } from 'vitest'
import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { DebService } from './deb-service'
import type { DatabaseLike, ExternalCheckerLike, InstallerLike, TrackedStoreLike } from './ports'
import { TrackedRepository } from './tracked-repository'

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

function makeService(init: { debs?: TrackedDebPackage[] } = {}) {
  let debs = [...(init.debs ?? [])]
  const store: TrackedStoreLike = {
    readApps: async () => [],
    writeApps: async () => undefined,
    readDebPackages: async () => [...debs],
    writeDebPackages: async (next) => {
      debs = [...next]
    }
  }
  const database: DatabaseLike = { fetchDebInfo: vi.fn() }
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
  const service = new DebService({
    database,
    installer,
    external,
    repo: new TrackedRepository(store)
  })
  return { service, database, installer, external, getDebs: () => debs }
}

describe('DebService.install', () => {
  it('downloads and installs the package, recording the derived version', async () => {
    const h = makeService({ debs: [trackedDeb()] })
    vi.mocked(h.installer.downloadFile).mockResolvedValue('/tmp/thing_1.2.3_amd64.deb')
    vi.mocked(h.installer.installPackage).mockResolvedValue({
      launchCommand: '/usr/bin/thing',
      packageName: 'thing'
    })

    const updated = await h.service.install(trackedDeb())

    expect(h.installer.downloadFile).toHaveBeenCalledWith(
      'https://example.com/thing.deb',
      'thing.deb'
    )
    expect(updated.installedVersion).toBe('1.2.3')
  })
})

describe('DebService.check', () => {
  it('returns the new version and refreshes metadata', async () => {
    const h = makeService({ debs: [trackedDeb()] })
    vi.mocked(h.database.fetchDebInfo).mockResolvedValue({
      version: '2.0.0',
      fileSize: '123',
      fileDate: new Date('2026-03-01T00:00:00Z')
    })
    vi.mocked(h.external.getExternalDebVersion).mockResolvedValue('1.0.0')

    const version = await h.service.check(trackedDeb())

    expect(version).toBe('2.0.0')
    expect(h.getDebs()[0]?.latestVersion).toBe('2.0.0')
  })

  it('returns null when neither probe yields a version', async () => {
    const h = makeService({ debs: [trackedDeb()] })
    vi.mocked(h.database.fetchDebInfo).mockResolvedValue({
      version: null,
      fileSize: null,
      fileDate: null
    })
    vi.mocked(h.external.getExternalDebVersion).mockResolvedValue(null)

    expect(await h.service.check(trackedDeb())).toBeNull()
  })
})

describe('DebService.add / update / remove / launch', () => {
  it('probes metadata, assigns the next id and rejects a duplicate URL', async () => {
    const h = makeService({ debs: [trackedDeb({ id: 3 })] })
    vi.mocked(h.database.fetchDebInfo).mockResolvedValue({
      version: '1.0.0',
      fileSize: '99',
      fileDate: new Date('2026-01-01T00:00:00Z')
    })

    const id = await h.service.add({ name: 'new', packageUrl: 'https://example.com/new.deb' })
    expect(id).toBe(4)
    expect(h.getDebs().find((pkg) => pkg.id === 4)?.fileSize).toBe('99')

    await expect(
      h.service.add({ name: 'dup', packageUrl: 'https://example.com/thing.deb' })
    ).rejects.toThrow(/already exists/)
  })

  it('updates and removes packages', async () => {
    const h = makeService({ debs: [trackedDeb({ id: 1 }), trackedDeb({ id: 2 })] })
    await h.service.update(trackedDeb({ id: 1, displayName: 'Renamed' }))
    await h.service.remove(2)

    expect(h.getDebs().map((pkg) => pkg.id)).toEqual([1])
    expect(h.getDebs()[0]?.displayName).toBe('Renamed')
  })

  it('delegates launch to the installer', async () => {
    const h = makeService()
    await h.service.launch(trackedDeb())
    expect(h.installer.launchDebPackage).toHaveBeenCalledTimes(1)
  })
})
