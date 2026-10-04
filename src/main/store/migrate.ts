// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Databases imported from the Flutter app, in copy order. */
export const MIGRATED_FILES = ['apps.json', 'deb_packages.json', 'settings.json'] as const

/** GTK application id set by the Flutter runner (`linux/CMakeLists.txt`). */
export const FLUTTER_APP_ID = 'com.autonex'

/** Executable name used by path_provider_linux's backwards-compatibility path. */
export const FLUTTER_EXECUTABLE_NAME = 'autonex'

export interface FlutterDirOptions {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly homeDir: string
}

export interface MigrateOptions {
  readonly userDataDir: string
  readonly appSupportDir: string
  readonly files?: readonly string[]
}

/**
 * The XDG data home, matching path_provider_linux: an absolute `XDG_DATA_HOME`
 * wins, otherwise `~/.local/share`.
 */
export function flutterDataHome(options: FlutterDirOptions): string {
  const xdgDataHome = options.env['XDG_DATA_HOME']
  if (xdgDataHome !== undefined && xdgDataHome.startsWith('/')) return xdgDataHome
  return join(options.homeDir, '.local', 'share')
}

/**
 * Resolves the Flutter `getApplicationSupportDirectory()` path.
 *
 * path_provider_linux prefers `<dataHome>/<applicationId>` and falls back to the
 * legacy `<dataHome>/<executableName>` directory when only that one exists.
 */
export function resolveFlutterAppSupportDir(options: FlutterDirOptions): string {
  const dataHome = flutterDataHome(options)
  const appIdDir = join(dataHome, FLUTTER_APP_ID)
  if (existsSync(appIdDir)) return appIdDir

  const legacyDir = join(dataHome, FLUTTER_EXECUTABLE_NAME)
  if (existsSync(legacyDir)) return legacyDir

  return appIdDir
}

/**
 * Copies the Flutter databases into the Electron `userData` directory on first
 * run.
 *
 * Migration only happens when Electron has no `apps.json` yet, and a file is
 * copied only when it is present in the Flutter directory and absent from
 * `userData`, so existing Electron data is never overwritten. Returns the names
 * of the files that were copied.
 */
export async function migrateFromFlutter(options: MigrateOptions): Promise<string[]> {
  if (existsSync(join(options.userDataDir, 'apps.json'))) return []

  const files = options.files ?? MIGRATED_FILES
  await mkdir(options.userDataDir, { recursive: true })

  const imported: string[] = []
  for (const name of files) {
    const source = join(options.appSupportDir, name)
    const target = join(options.userDataDir, name)
    if (!existsSync(source) || existsSync(target)) continue
    await copyFile(source, target)
    imported.push(name)
  }
  return imported
}
