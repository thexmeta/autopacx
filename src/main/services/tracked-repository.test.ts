// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it } from 'vitest'
import { TrackedApp } from '@core/models/tracked-app'
import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { TrackedPacstallPackage } from '@core/models/tracked-pacstall-package'
import type { TrackedStoreLike } from './ports'
import { TrackedRepository } from './tracked-repository'

function app(id: number, displayName = `App ${id}`): TrackedApp {
  return new TrackedApp({
    id,
    repoOwner: 'owner',
    repoName: `repo-${id}`,
    displayName,
    createdAt: new Date('2026-01-01T00:00:00Z')
  })
}

function deb(id: number): TrackedDebPackage {
  return new TrackedDebPackage({
    id,
    name: `thing-${id}`,
    packageUrl: `https://example.com/thing-${id}.deb`,
    createdAt: new Date('2026-01-01T00:00:00Z')
  })
}

function pacstall(id: number, name = `pkg-${id}`): TrackedPacstallPackage {
  return new TrackedPacstallPackage({
    id,
    name,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    registryRepo: 'pacstall/pacstall-programs'
  })
}

function makeStore(
  init: {
    apps?: TrackedApp[]
    debs?: TrackedDebPackage[]
    pacstall?: TrackedPacstallPackage[]
  } = {}
): {
  store: TrackedStoreLike
  apps: () => TrackedApp[]
  debs: () => TrackedDebPackage[]
  pacstall: () => TrackedPacstallPackage[]
} {
  let apps = [...(init.apps ?? [])]
  let debs = [...(init.debs ?? [])]
  let pacstall = [...(init.pacstall ?? [])]
  return {
    store: {
      readApps: async () => [...apps],
      writeApps: async (next) => {
        apps = [...next]
      },
      readDebPackages: async () => [...debs],
      writeDebPackages: async (next) => {
        debs = [...next]
      },
      readPacstallPackages: async () => [...pacstall],
      writePacstallPackages: async (next) => {
        pacstall = [...next]
      }
    },
    apps: () => apps,
    debs: () => debs,
    pacstall: () => pacstall
  }
}

describe('TrackedRepository apps', () => {
  it('appends with the next free id', async () => {
    const harness = makeStore({ apps: [app(3)] })
    const repo = new TrackedRepository(harness.store)

    const id = await repo.appendApp(app(0, 'New'))

    expect(id).toBe(4)
    expect(harness.apps().map((entry) => entry.id)).toEqual([3, 4])
  })

  it('updates the record with the matching id and rejects an unknown id', async () => {
    const harness = makeStore({ apps: [app(1)] })
    const repo = new TrackedRepository(harness.store)

    await repo.updateApp(app(1, 'Renamed'))
    expect(harness.apps()[0]?.displayName).toBe('Renamed')

    await expect(repo.updateApp(app(9))).rejects.toThrow(/not found/)
  })

  it('rejects an update without an id', async () => {
    const harness = makeStore()
    const repo = new TrackedRepository(harness.store)
    const noId = new TrackedApp({
      repoOwner: 'o',
      repoName: 'r',
      displayName: 'D',
      createdAt: new Date('2026-01-01T00:00:00Z')
    })

    await expect(repo.updateApp(noId)).rejects.toThrow(/without an id/)
  })

  it('deletes by id and reports how many of a set were removed', async () => {
    const harness = makeStore({ apps: [app(1), app(2), app(3)] })
    const repo = new TrackedRepository(harness.store)

    await repo.deleteApp(2)
    expect(harness.apps().map((entry) => entry.id)).toEqual([1, 3])

    const removed = await repo.deleteApps([1, 99])
    expect(removed).toBe(1)
    expect(harness.apps().map((entry) => entry.id)).toEqual([3])
  })
})

describe('TrackedRepository debs', () => {
  it('appends, updates and deletes packages', async () => {
    const harness = makeStore({ debs: [deb(2)] })
    const repo = new TrackedRepository(harness.store)

    const id = await repo.appendDeb(deb(0))
    expect(id).toBe(3)

    await repo.updateDeb(deb(3).copyWith({ displayName: 'Renamed' }))
    expect(harness.debs().find((entry) => entry.id === 3)?.displayName).toBe('Renamed')

    const removed = await repo.deleteDebs([2, 3])
    expect(removed).toBe(2)
    expect(harness.debs()).toHaveLength(0)
  })

  it('rejects an update for a missing package', async () => {
    const harness = makeStore()
    const repo = new TrackedRepository(harness.store)
    await expect(repo.updateDeb(deb(9))).rejects.toThrow(/not found/)
  })
})

describe('TrackedRepository pacstall packages', () => {
  it('appends with the next free id, updates and deletes', async () => {
    const harness = makeStore({ pacstall: [pacstall(2)] })
    const repo = new TrackedRepository(harness.store)

    const id = await repo.appendPacstallPackage(pacstall(0))
    expect(id).toBe(3)

    await repo.updatePacstallPackage(pacstall(3, 'renamed'))
    expect(harness.pacstall().find((entry) => entry.id === 3)?.name).toBe('renamed')

    const removed = await repo.deletePacstallPackages([2, 3])
    expect(removed).toBe(2)
    expect(harness.pacstall()).toHaveLength(0)
  })

  it('rejects an update without an id or for a missing package', async () => {
    const harness = makeStore()
    const repo = new TrackedRepository(harness.store)

    const noId = new TrackedPacstallPackage({
      name: 'x',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      registryRepo: 'pacstall/pacstall-programs'
    })
    await expect(repo.updatePacstallPackage(noId)).rejects.toThrow(/without an id/)
    await expect(repo.updatePacstallPackage(pacstall(9))).rejects.toThrow(/not found/)
  })
})
