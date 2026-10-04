// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  flutterDataHome,
  migrateFromFlutter,
  resolveFlutterAppSupportDir
} from '../main/store/migrate'

describe('flutterDataHome', () => {
  it('prefers an absolute XDG_DATA_HOME', () => {
    expect(flutterDataHome({ env: { XDG_DATA_HOME: '/custom/data' }, homeDir: '/home/u' })).toBe(
      '/custom/data'
    )
  })

  it('falls back to ~/.local/share', () => {
    expect(flutterDataHome({ env: {}, homeDir: '/home/u' })).toBe('/home/u/.local/share')
  })
})

describe('resolveFlutterAppSupportDir', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'autonex-migrate-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('uses the application-id directory when present', () => {
    const appIdDir = join(root, 'com.autonex')
    mkdirSync(appIdDir, { recursive: true })

    expect(resolveFlutterAppSupportDir({ env: { XDG_DATA_HOME: root }, homeDir: root })).toBe(
      appIdDir
    )
  })

  it('falls back to the legacy executable-name directory', () => {
    const legacyDir = join(root, 'autonex')
    mkdirSync(legacyDir, { recursive: true })

    expect(resolveFlutterAppSupportDir({ env: { XDG_DATA_HOME: root }, homeDir: root })).toBe(
      legacyDir
    )
  })

  it('defaults to the application-id directory when neither exists', () => {
    expect(resolveFlutterAppSupportDir({ env: { XDG_DATA_HOME: root }, homeDir: root })).toBe(
      join(root, 'com.autonex')
    )
  })
})

describe('migrateFromFlutter', () => {
  let root: string
  let userDataDir: string
  let appSupportDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'autonex-migrate-'))
    userDataDir = join(root, 'electron-user-data')
    appSupportDir = join(root, 'flutter-support', 'com.autonex')
    mkdirSync(appSupportDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('imports every present database on first run', async () => {
    writeFileSync(join(appSupportDir, 'apps.json'), '[{"id":1}]')
    writeFileSync(join(appSupportDir, 'deb_packages.json'), '[]')
    writeFileSync(join(appSupportDir, 'settings.json'), '{"theme":"dark"}')

    const imported = await migrateFromFlutter({ userDataDir, appSupportDir })

    expect(imported.sort()).toEqual(['apps.json', 'deb_packages.json', 'settings.json'])
    expect(readFileSync(join(userDataDir, 'apps.json'), 'utf8')).toBe('[{"id":1}]')
    expect(readFileSync(join(userDataDir, 'settings.json'), 'utf8')).toBe('{"theme":"dark"}')
  })

  it('imports only the files that are present', async () => {
    writeFileSync(join(appSupportDir, 'settings.json'), '{"theme":"light"}')

    const imported = await migrateFromFlutter({ userDataDir, appSupportDir })

    expect(imported).toEqual(['settings.json'])
    expect(existsSync(join(userDataDir, 'apps.json'))).toBe(false)
  })

  it('never overwrites existing Electron data', async () => {
    mkdirSync(userDataDir, { recursive: true })
    writeFileSync(join(userDataDir, 'apps.json'), '[{"id":99}]')
    writeFileSync(join(appSupportDir, 'apps.json'), '[{"id":1}]')
    writeFileSync(join(appSupportDir, 'settings.json'), '{"theme":"dark"}')

    const imported = await migrateFromFlutter({ userDataDir, appSupportDir })

    expect(imported).toEqual([])
    expect(readFileSync(join(userDataDir, 'apps.json'), 'utf8')).toBe('[{"id":99}]')
    expect(existsSync(join(userDataDir, 'settings.json'))).toBe(false)
  })

  it('does nothing when the Flutter directory has no databases', async () => {
    const imported = await migrateFromFlutter({ userDataDir, appSupportDir })

    expect(imported).toEqual([])
  })
})
