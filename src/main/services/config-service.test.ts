// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppConfig, TrackedAppData } from '@core/models/app-config'
import { TrackedApp } from '@core/models/tracked-app'
import { JsonStore } from '../store/json-store'
import { ConfigService, IMPORT_FILE_NAME } from './config-service'

describe('ConfigService', () => {
  let directory: string
  let store: JsonStore
  let service: ConfigService

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'autonex-config-'))
    store = new JsonStore(directory)
    service = new ConfigService(store, '1.2.3')
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('exports the tracked apps and returns the file path', async () => {
    await store.writeApps([
      new TrackedApp({
        id: 1,
        repoOwner: 'owner',
        repoName: 'repo',
        displayName: 'App',
        createdAt: new Date('2026-01-01T00:00:00Z')
      })
    ])

    const path = await service.exportConfig()

    expect(path.startsWith(join(directory, 'autonex-export-'))).toBe(true)
    const written = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(written['schemaVersion']).toBe('1.0')
    expect(written['appVersion']).toBe('1.2.3')
    expect(Array.isArray(written['apps'])).toBe(true)
    expect((written['apps'] as unknown[]).length).toBe(1)
  })

  it('imports new apps from the fixed import file and skips duplicates', async () => {
    await store.writeApps([
      new TrackedApp({
        id: 1,
        repoOwner: 'owner',
        repoName: 'existing',
        displayName: 'Existing',
        createdAt: new Date('2026-01-01T00:00:00Z')
      })
    ])

    const config = new AppConfig({
      schemaVersion: '1.0',
      exportedAt: new Date('2026-01-01T00:00:00Z'),
      appName: 'Autonex',
      appVersion: '1.2.3',
      apps: [
        new TrackedAppData({ repoOwner: 'owner', repoName: 'existing', displayName: 'Existing' }),
        new TrackedAppData({ repoOwner: 'owner', repoName: 'fresh', displayName: 'Fresh' })
      ]
    })
    await writeFile(join(directory, IMPORT_FILE_NAME), JSON.stringify(config.toJson()), 'utf8')

    const count = await service.importConfig()

    expect(count).toBe(1)
    const apps = await store.readApps()
    expect(apps.map((app) => app.repoName).sort()).toEqual(['existing', 'fresh'])
    // The imported app gets an id above the existing maximum.
    expect(apps.find((app) => app.repoName === 'fresh')?.id).toBe(2)
  })

  it('reports a clear error when the import file is missing', async () => {
    await expect(service.importConfig()).rejects.toThrow(/No import file found/)
  })
})
