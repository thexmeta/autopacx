// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Settings } from '@core/api'
import { formatDartLocalIso } from '@core/internal/date'
import { TrackedApp } from '@core/models/tracked-app'
import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { TrackedPacstallPackage } from '@core/models/tracked-pacstall-package'
import { compareByName } from '@core/tracked-order'

export const APPS_FILE = 'apps.json'
export const DEB_PACKAGES_FILE = 'deb_packages.json'
export const PACSTALL_PACKAGES_FILE = 'pacstall_packages.json'
export const SETTINGS_FILE = 'settings.json'

/** Date fields serialised as Dart-local ISO strings, per file. */
const APP_DATE_KEYS = ['created_at', 'last_checked', 'latest_release_date'] as const
const DEB_DATE_KEYS = ['created_at', 'last_checked', 'file_date'] as const
const PACSTALL_DATE_KEYS = ['created_at', 'last_checked'] as const

interface CorruptRecord {
  readonly backupPath: string | null
}

/**
 * File-backed persistence for the three JSON databases, ported from
 * `lib/services/database_service.dart` and `lib/services/settings_service.dart`.
 *
 * The directory is injected so the store is testable without Electron; the
 * main process passes `app.getPath('userData')`.
 *
 * Two invariants from the Dart original are load bearing:
 *
 * - Writes are atomic (temp file + `rename`), so an interrupted write can never
 *   truncate a database.
 * - A file that exists but cannot be parsed is copied aside as
 *   `<name>.corrupt-<ms>` and every later write is refused, so damaged data is
 *   never silently replaced with an empty database.
 */
export class JsonStore {
  readonly directory: string

  private readonly corrupt = new Map<string, CorruptRecord>()

  /**
   * Serializes every mutation, so two concurrent writers can never interleave
   * (which would otherwise lose an update and share one temp path). The chain
   * always advances, even after a task rejects, so one failed write cannot
   * wedge later ones.
   */
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(directory: string) {
    this.directory = directory
  }

  // --- Apps -----------------------------------------------------------------

  async readApps(): Promise<TrackedApp[]> {
    const apps = await this.readList(APPS_FILE, (item) => TrackedApp.fromMap(item))
    // Case-insensitive so capitals do not split the list into two sections
    // (the raw `<`/`>` UTF-16 comparison placed every capitalised name first).
    return apps.sort(compareByName)
  }

  async writeApps(apps: readonly TrackedApp[]): Promise<void> {
    await this.writeJson(
      APPS_FILE,
      apps.map((app) => toDartWire(app.toMap(), APP_DATE_KEYS))
    )
  }

  // --- Deb packages ---------------------------------------------------------

  async readDebPackages(): Promise<TrackedDebPackage[]> {
    return this.readList(DEB_PACKAGES_FILE, (item) => TrackedDebPackage.fromMap(item))
  }

  async writeDebPackages(packages: readonly TrackedDebPackage[]): Promise<void> {
    await this.writeJson(
      DEB_PACKAGES_FILE,
      packages.map((pkg) => toDartWire(pkg.toMap(), DEB_DATE_KEYS))
    )
  }

  // --- Pacstall packages ----------------------------------------------------

  async readPacstallPackages(): Promise<TrackedPacstallPackage[]> {
    return this.readList(PACSTALL_PACKAGES_FILE, (item) => TrackedPacstallPackage.fromMap(item))
  }

  async writePacstallPackages(packages: readonly TrackedPacstallPackage[]): Promise<void> {
    await this.writeJson(
      PACSTALL_PACKAGES_FILE,
      packages.map((pkg) => toDartWire(pkg.toMap(), PACSTALL_DATE_KEYS))
    )
  }

  // --- Settings -------------------------------------------------------------

  async readSettings(): Promise<Settings> {
    const file = join(this.directory, SETTINGS_FILE)
    if (!existsSync(file)) return {}

    const content = await this.readContent(file, SETTINGS_FILE)
    if (content === null || content.trim() === '') return {}

    try {
      const parsed: unknown = JSON.parse(content)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('expected a JSON object')
      }
      return parsed as Settings
    } catch {
      await this.flagCorrupt(SETTINGS_FILE, file)
      return {}
    }
  }

  async writeSettings(settings: Settings): Promise<void> {
    await this.writeJson(SETTINGS_FILE, settings)
  }

  // --- Internals ------------------------------------------------------------

  private async readList<T>(
    fileName: string,
    parse: (item: Record<string, unknown>) => T
  ): Promise<T[]> {
    const file = join(this.directory, fileName)
    if (!existsSync(file)) return []

    const content = await this.readContent(file, fileName)
    if (content === null || content.trim() === '') return []

    try {
      const parsed: unknown = JSON.parse(content)
      if (!Array.isArray(parsed)) throw new Error('expected a JSON array')
      return parsed.map((item) => parse(asRecord(item)))
    } catch {
      await this.flagCorrupt(fileName, file)
      return []
    }
  }

  /** Reads a file, flagging (and backing up) it when the read itself fails. */
  private async readContent(file: string, fileName: string): Promise<string | null> {
    try {
      return await readFile(file, 'utf8')
    } catch {
      await this.flagCorrupt(fileName, file)
      return null
    }
  }

  private async writeJson(fileName: string, value: unknown): Promise<void> {
    return this.enqueue(() => this.writeJsonSerialized(fileName, value))
  }

  /** Runs `task` after every previously enqueued mutation has settled. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(task, task)
    this.writeQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async writeJsonSerialized(fileName: string, value: unknown): Promise<void> {
    const record = this.corrupt.get(fileName)
    if (record !== undefined) {
      const suffix = record.backupPath === null ? '' : `; a copy is kept at ${record.backupPath}`
      throw new Error(
        `Refusing to overwrite unreadable database (${join(this.directory, fileName)})${suffix}`
      )
    }

    await mkdir(this.directory, { recursive: true })
    const target = join(this.directory, fileName)
    // A UNIQUE temp path per write: even if the queue were ever bypassed, two
    // writers could not clobber each other's temp file.
    const tmp = `${target}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    await writeFile(tmp, JSON.stringify(value), 'utf8')
    try {
      await rename(tmp, target)
    } catch (error) {
      await rm(tmp, { force: true })
      throw error
    }
  }

  private async flagCorrupt(fileName: string, file: string): Promise<void> {
    this.corrupt.set(fileName, { backupPath: await this.backup(file) })
  }

  private async backup(file: string): Promise<string | null> {
    try {
      const backup = `${file}.corrupt-${Date.now()}`
      await copyFile(file, backup)
      return backup
    } catch {
      return null
    }
  }
}

/** Narrows an arbitrary JSON element to a record, or throws like Dart's casts. */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected a JSON object element')
  }
  return value as Record<string, unknown>
}

/**
 * Rewrites the given date fields of a `toMap()` result into the Dart-local ISO
 * form. `toMap()` uses `Date.toISOString()` (UTC, `Z`), which is correct for
 * the in-memory model and the export format but wrong for the on-disk database.
 */
function toDartWire(
  map: Record<string, unknown>,
  dateKeys: readonly string[]
): Record<string, unknown> {
  const wire: Record<string, unknown> = { ...map }
  for (const key of dateKeys) {
    const value = wire[key]
    if (typeof value !== 'string' || value.length === 0) continue
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      wire[key] = formatDartLocalIso(date)
    }
  }
  return wire
}
