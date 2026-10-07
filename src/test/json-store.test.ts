// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TrackedApp } from '@core/models/tracked-app'
import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { TrackedPacstallPackage } from '@core/models/tracked-pacstall-package'

// Intercept `rename` so the atomic-write failure path can be exercised, and
// `writeFile` so the concurrency test can observe whether writes overlap. Every
// call delegates to the real implementation unless a test arms it.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename), writeFile: vi.fn(actual.writeFile) }
})

import { JsonStore } from '../main/store/json-store'

/** A real `apps.json` entry as written by the Dart app (local ISO, no `Z`). */
const DART_SAMPLE_APPS = `[
  {
    "id": 2,
    "repo_owner": "zeta",
    "repo_name": "zapp",
    "display_name": "Zeta",
    "installed_version": null,
    "latest_version": null,
    "install_type": null,
    "launch_command": null,
    "package_name": null,
    "last_checked": null,
    "created_at": "2026-10-04T00:17:23.456",
    "latest_release_date": "2026-10-01T12:00:00.000Z",
    "fetched_package": null,
    "asset_filter_pattern": null,
    "tag_prefix": null,
    "architectures": [],
    "include_prerelease": false
  },
  {
    "id": 1,
    "repo_owner": "alpha",
    "repo_name": "aapp",
    "display_name": "Alpha",
    "installed_version": "1.2.3",
    "latest_version": "1.3.0",
    "install_type": "deb",
    "launch_command": null,
    "package_name": null,
    "last_checked": "2026-10-04T00:17:23.456",
    "created_at": "2026-10-03T08:00:00.000",
    "latest_release_date": null,
    "fetched_package": null,
    "asset_filter_pattern": null,
    "tag_prefix": null,
    "architectures": ["amd64"],
    "include_prerelease": true
  }
]
`

function sampleApp(overrides: { displayName?: string } = {}): TrackedApp {
  return new TrackedApp({
    id: 1,
    repoOwner: 'owner',
    repoName: 'repo',
    displayName: overrides.displayName ?? 'App',
    createdAt: new Date(2026, 9, 4, 0, 17, 23, 456)
  })
}

describe('JsonStore', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'autopacx-store-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('atomic write', () => {
    it('writes through a temp file and leaves no .tmp behind', async () => {
      const store = new JsonStore(dir)

      await store.writeApps([sampleApp()])

      const raw = readFileSync(join(dir, 'apps.json'), 'utf8')
      expect(JSON.parse(raw)).toHaveLength(1)
      expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
    })

    it('keeps the previous file and removes the temp file when rename fails', async () => {
      const store = new JsonStore(dir)
      await store.writeApps([sampleApp({ displayName: 'Original' })])
      const before = readFileSync(join(dir, 'apps.json'), 'utf8')

      vi.mocked(rename).mockRejectedValueOnce(new Error('disk full'))

      await expect(store.writeApps([sampleApp({ displayName: 'Replacement' })])).rejects.toThrow(
        'disk full'
      )

      expect(readFileSync(join(dir, 'apps.json'), 'utf8')).toBe(before)
      expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
    })

    it('serializes overlapping writes with unique temp names so no update is lost and no .tmp remains', async () => {
      const store = new JsonStore(dir)
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')

      const tempPaths: string[] = []
      let active = 0
      let maxActive = 0
      vi.mocked(writeFile).mockImplementation(async (...args) => {
        tempPaths.push(String(args[0]))
        active++
        maxActive = Math.max(maxActive, active)
        // Widen the window: without the mutex the two writes would overlap here.
        await new Promise((resolve) => setTimeout(resolve, 10))
        try {
          return await actual.writeFile(...args)
        } finally {
          active--
        }
      })

      try {
        await Promise.all([
          store.writeApps([sampleApp({ displayName: 'First' })]),
          store.writeApps([sampleApp({ displayName: 'Second' })])
        ])
      } finally {
        vi.mocked(writeFile).mockImplementation(actual.writeFile)
      }

      // The writes never ran at the same time: the mutation queue serialized them.
      expect(maxActive).toBe(1)
      // Each write used its own temp path, so two writers cannot clobber one file.
      expect(tempPaths).toHaveLength(2)
      expect(new Set(tempPaths).size).toBe(2)
      // The result is one complete, intact document (last enqueued wins), not a mix.
      const parsed = JSON.parse(readFileSync(join(dir, 'apps.json'), 'utf8')) as Array<{
        display_name: string
      }>
      expect(parsed).toHaveLength(1)
      expect(['First', 'Second']).toContain(parsed[0].display_name)
      // No temp residue.
      expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
    })
  })

  describe('corrupt-file protection', () => {
    it('backs up malformed JSON, returns [], and refuses to overwrite it', async () => {
      writeFileSync(join(dir, 'apps.json'), '{ not valid json')
      const store = new JsonStore(dir)

      expect(await store.readApps()).toEqual([])

      const backups = readdirSync(dir).filter((name) => /^apps\.json\.corrupt-\d+$/.test(name))
      expect(backups).toHaveLength(1)
      expect(readFileSync(join(dir, backups[0]), 'utf8')).toBe('{ not valid json')

      await expect(store.writeApps([sampleApp()])).rejects.toThrow(/Refusing to overwrite/)
      expect(existsSync(join(dir, 'apps.json'))).toBe(true)
    })

    it('treats a missing file as a legitimate empty first run', async () => {
      const store = new JsonStore(dir)

      expect(await store.readApps()).toEqual([])
      expect(await store.readDebPackages()).toEqual([])
      expect(await store.readSettings()).toEqual({})
    })
  })

  describe('timestamp parity', () => {
    it('reads a real Dart sample written in local ISO and UTC forms', async () => {
      writeFileSync(join(dir, 'apps.json'), DART_SAMPLE_APPS)
      const store = new JsonStore(dir)

      const apps = await store.readApps()

      // Sorted by display name: [Alpha, Zeta].
      // Dart writes local wall-clock time with no `Z`; JS must read it as local.
      expect(apps[0].displayName).toBe('Alpha')
      expect(apps[0].createdAt.getTime()).toBe(new Date(2026, 9, 3, 8, 0, 0, 0).getTime())
      expect(apps[0].lastChecked?.getTime()).toBe(new Date(2026, 9, 4, 0, 17, 23, 456).getTime())
      // A UTC value (`Z`) must still parse as an instant.
      expect(apps[1].latestReleaseDate?.toISOString()).toBe('2026-10-01T12:00:00.000Z')
    })

    it('writes timestamps without a trailing Z and round-trips them', async () => {
      const store = new JsonStore(dir)
      const original = sampleApp()

      await store.writeApps([original])

      const raw = JSON.parse(readFileSync(join(dir, 'apps.json'), 'utf8')) as Array<
        Record<string, unknown>
      >
      expect(raw[0]['created_at']).toBe('2026-10-04T00:17:23.456')
      expect(String(raw[0]['created_at'])).not.toMatch(/Z$/)

      const [reloaded] = await store.readApps()
      expect(reloaded.createdAt.getTime()).toBe(original.createdAt.getTime())
    })
  })

  it('sorts apps by display name like the Dart database service', async () => {
    writeFileSync(join(dir, 'apps.json'), DART_SAMPLE_APPS)
    const store = new JsonStore(dir)

    const apps = await store.readApps()

    expect(apps.map((app) => app.displayName)).toEqual(['Alpha', 'Zeta'])
  })

  it('sorts apps case-insensitively so beekeeper-studio lands between AyuGram Desktop and Zettlr', async () => {
    const store = new JsonStore(dir)
    // Deliberately written out of order; the read must interleave cases instead
    // of grouping every capitalised name before the lower-case ones.
    await store.writeApps([
      sampleApp({ displayName: 'Zettlr' }),
      sampleApp({ displayName: 'beekeeper-studio' }),
      sampleApp({ displayName: 'AyuGram Desktop' })
    ])

    const names = (await store.readApps()).map((app) => app.displayName)
    const ayu = names.indexOf('AyuGram Desktop')
    const bee = names.indexOf('beekeeper-studio')
    const zettlr = names.indexOf('Zettlr')

    expect(ayu).toBeGreaterThanOrEqual(0)
    expect(bee).toBeGreaterThan(ayu)
    expect(zettlr).toBeGreaterThan(bee)
  })

  it('round-trips deb packages', async () => {
    const store = new JsonStore(dir)
    const pkg = new TrackedDebPackage({
      id: 1,
      name: 'thing',
      packageUrl: 'https://example.com/thing_1.0.0_amd64.deb',
      createdAt: new Date(2026, 9, 4, 0, 17, 23, 456)
    })

    await store.writeDebPackages([pkg])
    const [reloaded] = await store.readDebPackages()

    expect(reloaded.name).toBe('thing')
    expect(reloaded.createdAt.getTime()).toBe(pkg.createdAt.getTime())
  })

  it('round-trips pacstall packages through pacstall_packages.json', async () => {
    const store = new JsonStore(dir)
    const pkg = new TrackedPacstallPackage({
      id: 1,
      name: 'neovim',
      displayName: 'Neovim',
      installedVersion: '0.9.5',
      latestVersion: '0.10.0',
      autoUpdate: true,
      lastChecked: new Date(2026, 9, 4, 0, 17, 23, 456),
      createdAt: new Date(2026, 9, 4, 0, 17, 23, 456),
      registryRepo: 'pacstall/pacstall-programs'
    })

    await store.writePacstallPackages([pkg])

    const raw = JSON.parse(readFileSync(join(dir, 'pacstall_packages.json'), 'utf8')) as Array<
      Record<string, unknown>
    >
    expect(raw[0]['created_at']).toBe('2026-10-04T00:17:23.456')
    expect(String(raw[0]['created_at'])).not.toMatch(/Z$/)

    const [reloaded] = await store.readPacstallPackages()
    expect(reloaded.name).toBe('neovim')
    expect(reloaded.installedVersion).toBe('0.9.5')
    expect(reloaded.registryRepo).toBe('pacstall/pacstall-programs')
    expect(reloaded.createdAt.getTime()).toBe(pkg.createdAt.getTime())
    expect(reloaded.lastChecked?.getTime()).toBe(pkg.lastChecked?.getTime())
  })

  it('round-trips settings', async () => {
    const store = new JsonStore(dir)

    await store.writeSettings({ theme: 'dark', github_releases_per_page: 50 })
    const settings = await store.readSettings()

    expect(settings['theme']).toBe('dark')
    expect(settings['github_releases_per_page']).toBe(50)
  })
})
