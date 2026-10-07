// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

// Ported 1:1 from `test/models/app_config_test.dart`.

import { describe, expect, it } from 'vitest'
import { AppConfig, TrackedAppData } from './app-config'
import { InstallType } from './install-type'

describe('TrackedAppData', () => {
  it('constructor initializes with defaults', () => {
    const data = new TrackedAppData({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Test App'
    })

    expect(data.repoOwner).toBe('owner')
    expect(data.repoName).toBe('repo')
    expect(data.displayName).toBe('Test App')
    expect(data.assetFilterPattern).toBeNull()
    expect(data.tagPrefix).toBeNull()
    expect(data.architectures).toEqual([])
    expect(data.includePrerelease).toBe(false)
  })

  it('constructor accepts optional fields', () => {
    const data = new TrackedAppData({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Test App',
      assetFilterPattern: '*.deb',
      tagPrefix: 'v',
      architectures: ['amd64', 'arm64'],
      includePrerelease: true
    })

    expect(data.assetFilterPattern).toBe('*.deb')
    expect(data.tagPrefix).toBe('v')
    expect(data.architectures).toEqual(['amd64', 'arm64'])
    expect(data.includePrerelease).toBe(true)
  })

  it('toMap serializes correctly', () => {
    const data = new TrackedAppData({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Test App',
      assetFilterPattern: '*.deb',
      tagPrefix: 'v',
      architectures: ['amd64'],
      includePrerelease: true
    })

    const map = data.toMap()
    expect(map['repoOwner']).toBe('owner')
    expect(map['repoName']).toBe('repo')
    expect(map['displayName']).toBe('Test App')
    expect(map['assetFilterPattern']).toBe('*.deb')
    expect(map['tagPrefix']).toBe('v')
    expect(map['architectures']).toEqual(['amd64'])
    expect(map['includePrerelease']).toBe(true)
  })

  it('fromMap deserializes correctly', () => {
    const map: Record<string, unknown> = {
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Test App',
      assetFilterPattern: '*.deb',
      tagPrefix: 'v',
      architectures: ['amd64', 'arm64'],
      includePrerelease: true
    }

    const data = TrackedAppData.fromMap(map)
    expect(data.repoOwner).toBe('owner')
    expect(data.repoName).toBe('repo')
    expect(data.displayName).toBe('Test App')
    expect(data.assetFilterPattern).toBe('*.deb')
    expect(data.tagPrefix).toBe('v')
    expect(data.architectures).toEqual(['amd64', 'arm64'])
    expect(data.includePrerelease).toBe(true)
  })

  it('fromMap handles missing optional fields', () => {
    const map: Record<string, unknown> = {
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Test App'
    }

    const data = TrackedAppData.fromMap(map)
    expect(data.assetFilterPattern).toBeNull()
    expect(data.tagPrefix).toBeNull()
    expect(data.architectures).toEqual([])
    expect(data.includePrerelease).toBe(false)
  })

  it('toTrackedApp creates TrackedApp with correct fields', () => {
    const lastChecked = new Date('2026-02-03T04:05:06Z')
    const latestReleaseDate = new Date('2026-02-01T00:00:00Z')
    const data = new TrackedAppData({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Test App',
      assetFilterPattern: '*.deb',
      tagPrefix: 'v',
      architectures: ['amd64'],
      includePrerelease: true,
      installedVersion: '1.2.3',
      latestVersion: '1.3.0',
      installType: InstallType.deb,
      launchCommand: '/usr/bin/testapp',
      packageName: 'test-app',
      lastChecked,
      latestReleaseDate,
      fetchedPackage: 'testapp_1.3.0_amd64.deb'
    })

    const app = data.toTrackedApp(1)
    expect(app.id).toBe(1)
    expect(app.repoOwner).toBe('owner')
    expect(app.repoName).toBe('repo')
    expect(app.displayName).toBe('Test App')
    expect(app.assetFilterPattern).toBe('*.deb')
    expect(app.tagPrefix).toBe('v')
    expect(app.architectures).toEqual(['amd64'])
    expect(app.includePrerelease).toBe(true)
    // Install state must survive the export/import round trip.
    expect(app.installedVersion).toBe('1.2.3')
    expect(app.latestVersion).toBe('1.3.0')
    expect(app.installType).toBe(InstallType.deb)
    expect(app.launchCommand).toBe('/usr/bin/testapp')
    expect(app.packageName).toBe('test-app')
    expect(app.lastChecked).toEqual(lastChecked)
    expect(app.latestReleaseDate).toEqual(latestReleaseDate)
    expect(app.fetchedPackage).toBe('testapp_1.3.0_amd64.deb')
  })

  it('toTrackedApp uses provided createdAt', () => {
    const data = new TrackedAppData({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Test App'
    })

    const createdAt = new Date('2026-01-01T00:00:00Z')
    const app = data.toTrackedApp(1, { createdAt })
    expect(app.createdAt).toEqual(createdAt)
  })

  it('round-trip serialization', () => {
    const lastChecked = new Date('2026-02-03T04:05:06Z')
    const latestReleaseDate = new Date('2026-02-01T00:00:00Z')
    const original = new TrackedAppData({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Test App',
      assetFilterPattern: '*.deb',
      tagPrefix: 'v',
      architectures: ['amd64', 'arm64'],
      includePrerelease: true,
      installedVersion: '1.2.3',
      latestVersion: '1.3.0',
      installType: InstallType.appImage,
      launchCommand: 'testapp',
      packageName: 'test-app',
      lastChecked,
      latestReleaseDate,
      fetchedPackage: 'testapp_1.3.0_amd64.deb'
    })

    const map = original.toMap()
    const deserialized = TrackedAppData.fromMap(map)

    expect(deserialized.repoOwner).toBe(original.repoOwner)
    expect(deserialized.repoName).toBe(original.repoName)
    expect(deserialized.displayName).toBe(original.displayName)
    expect(deserialized.assetFilterPattern).toBe(original.assetFilterPattern)
    expect(deserialized.tagPrefix).toBe(original.tagPrefix)
    expect(deserialized.architectures).toEqual(original.architectures)
    expect(deserialized.includePrerelease).toBe(original.includePrerelease)
    expect(deserialized.installedVersion).toBe('1.2.3')
    expect(deserialized.latestVersion).toBe('1.3.0')
    expect(deserialized.installType).toBe(InstallType.appImage)
    expect(deserialized.launchCommand).toBe('testapp')
    expect(deserialized.packageName).toBe('test-app')
    expect(deserialized.lastChecked).toEqual(lastChecked)
    expect(deserialized.latestReleaseDate).toEqual(latestReleaseDate)
    expect(deserialized.fetchedPackage).toBe('testapp_1.3.0_amd64.deb')
  })
})

describe('AppConfig', () => {
  it('constructor initializes correctly', () => {
    const config = new AppConfig({
      schemaVersion: '1.0',
      exportedAt: new Date('2026-01-01T00:00:00Z'),
      appName: 'Autopacx',
      appVersion: '0.3.4',
      apps: []
    })

    expect(config.schemaVersion).toBe('1.0')
    expect(config.exportedAt).toEqual(new Date('2026-01-01T00:00:00Z'))
    expect(config.appName).toBe('Autopacx')
    expect(config.appVersion).toBe('0.3.4')
    expect(config.apps).toEqual([])
  })

  it('toJson serializes correctly', () => {
    const config = new AppConfig({
      schemaVersion: '1.0',
      exportedAt: new Date('2026-01-01T00:00:00Z'),
      appName: 'Autopacx',
      appVersion: '0.3.4',
      apps: [
        new TrackedAppData({
          repoOwner: 'owner',
          repoName: 'repo',
          displayName: 'Test App'
        })
      ]
    })

    const json = config.toJson()
    expect(json['schemaVersion']).toBe('1.0')
    expect(json['exportedAt']).toBe('2026-01-01T00:00:00.000Z')
    expect(json['appName']).toBe('Autopacx')
    expect(json['appVersion']).toBe('0.3.4')
    expect(Array.isArray(json['apps'])).toBe(true)
    expect((json['apps'] as unknown[]).length).toBe(1)
  })

  it('fromJson deserializes correctly', () => {
    const json: Record<string, unknown> = {
      schemaVersion: '1.0',
      exportedAt: '2026-01-01T00:00:00.000Z',
      appName: 'Autopacx',
      appVersion: '0.3.4',
      apps: [
        {
          repoOwner: 'owner',
          repoName: 'repo',
          displayName: 'Test App'
        }
      ]
    }

    const config = AppConfig.fromJson(json)
    expect(config.schemaVersion).toBe('1.0')
    expect(config.exportedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'))
    expect(config.appName).toBe('Autopacx')
    expect(config.appVersion).toBe('0.3.4')
    expect(config.apps.length).toBe(1)
    expect(config.apps[0].repoOwner).toBe('owner')
    expect(config.apps[0].repoName).toBe('repo')
  })

  it('fromJson handles missing optional fields', () => {
    const json: Record<string, unknown> = {
      schemaVersion: '1.0',
      exportedAt: '2026-01-01T00:00:00.000Z',
      apps: []
    }

    const config = AppConfig.fromJson(json)
    expect(config.schemaVersion).toBe('1.0')
    expect(config.appName).toBeNull()
    expect(config.appVersion).toBeNull()
    expect(config.apps).toEqual([])
  })

  it('round-trip serialization', () => {
    const lastChecked = new Date('2026-02-03T04:05:06Z')
    const original = new AppConfig({
      schemaVersion: '1.0',
      exportedAt: new Date('2026-01-01T00:00:00Z'),
      appName: 'Autopacx',
      appVersion: '0.3.4',
      apps: [
        new TrackedAppData({
          repoOwner: 'owner',
          repoName: 'repo',
          displayName: 'Test App',
          assetFilterPattern: '*.deb',
          tagPrefix: 'v',
          architectures: ['amd64'],
          includePrerelease: true,
          installedVersion: '1.2.3',
          latestVersion: '1.3.0',
          installType: InstallType.deb,
          launchCommand: '/usr/bin/testapp',
          packageName: 'test-app',
          lastChecked,
          latestReleaseDate: new Date('2026-02-01T00:00:00Z'),
          fetchedPackage: 'testapp_1.3.0_amd64.deb'
        })
      ]
    })

    const json = original.toJson()
    const deserialized = AppConfig.fromJson(json)

    expect(deserialized.schemaVersion).toBe(original.schemaVersion)
    expect(deserialized.exportedAt).toEqual(original.exportedAt)
    expect(deserialized.appName).toBe(original.appName)
    expect(deserialized.appVersion).toBe(original.appVersion)
    expect(deserialized.apps.length).toBe(original.apps.length)
    expect(deserialized.apps[0].repoOwner).toBe(original.apps[0].repoOwner)
    expect(deserialized.apps[0].displayName).toBe(original.apps[0].displayName)
    // Install state must survive the config-level round trip.
    expect(deserialized.apps[0].installedVersion).toBe('1.2.3')
    expect(deserialized.apps[0].latestVersion).toBe('1.3.0')
    expect(deserialized.apps[0].installType).toBe(InstallType.deb)
    expect(deserialized.apps[0].launchCommand).toBe('/usr/bin/testapp')
    expect(deserialized.apps[0].packageName).toBe('test-app')
    expect(deserialized.apps[0].lastChecked).toEqual(lastChecked)
    expect(deserialized.apps[0].latestReleaseDate).toEqual(new Date('2026-02-01T00:00:00Z'))
    expect(deserialized.apps[0].fetchedPackage).toBe('testapp_1.3.0_amd64.deb')
  })
})

describe('AppConfig export/import scenarios', () => {
  it('empty config exports correctly', () => {
    const config = new AppConfig({
      schemaVersion: '1.0',
      exportedAt: new Date(),
      appName: 'Autopacx',
      appVersion: '0.3.4',
      apps: []
    })

    const json = config.toJson()
    expect(Array.isArray(json['apps'])).toBe(true)
    expect((json['apps'] as unknown[]).length).toBe(0)
  })

  it('config with multiple apps', () => {
    const apps = Array.from(
      { length: 5 },
      (_, index) =>
        new TrackedAppData({
          repoOwner: `owner${index}`,
          repoName: `repo${index}`,
          displayName: `App ${index}`
        })
    )

    const config = new AppConfig({
      schemaVersion: '1.0',
      exportedAt: new Date(),
      appName: 'Autopacx',
      appVersion: '0.3.4',
      apps
    })

    const json = config.toJson()
    expect((json['apps'] as unknown[]).length).toBe(5)

    const deserialized = AppConfig.fromJson(json)
    expect(deserialized.apps.length).toBe(5)
  })

  it('config preserves filter settings', () => {
    const config = new AppConfig({
      schemaVersion: '1.0',
      exportedAt: new Date(),
      appName: 'Autopacx',
      appVersion: '0.3.4',
      apps: [
        new TrackedAppData({
          repoOwner: 'owner',
          repoName: 'repo',
          displayName: 'Test App',
          assetFilterPattern: '*.deb',
          tagPrefix: 'v',
          architectures: ['amd64', 'arm64'],
          includePrerelease: true
        })
      ]
    })

    const json = config.toJson()
    const deserialized = AppConfig.fromJson(json)

    expect(deserialized.apps[0].assetFilterPattern).toBe('*.deb')
    expect(deserialized.apps[0].tagPrefix).toBe('v')
    expect(deserialized.apps[0].architectures).toEqual(['amd64', 'arm64'])
    expect(deserialized.apps[0].includePrerelease).toBe(true)
  })
})
