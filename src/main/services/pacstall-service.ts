// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { TrackedPacstallPackage } from '@core/models/tracked-pacstall-package'
import { isNewerVersion, normalizeVersion } from '@core/version'
import { AUTOPACX_HELPER_PATH, PACKAGE_NAME_PATTERN } from './privileged-helper'
import type { HelperVerb } from './privileged-helper'
import { runProcess as defaultRunProcess } from './process-runner'
import type { ProcessResult, ProcessRunner } from './process-runner'
import { defaultPrivilegedProcessRunner } from './installer-service'
import type { AppSupportDirectory, DebugLog, PrivilegedProcessRunner } from './installer-service'
import { PacstallRegistry } from './pacstall-registry'
import type { PacstallRegistryLike } from './pacstall-registry'

/**
 * pacstall lifecycle operations, ported from the pacstall counterpart of
 * `InstallerService`.
 *
 * The app never runs pacstall directly: every install/remove/upgrade goes
 * through the root-owned helper's `pacstall-*` verbs (`pkexec <helper> <verb>
 * <name>`), exactly like the deb/binary paths. Reads (`status`, installed
 * version, update checks) are unprivileged.
 *
 * Detection uses the same hardcoded binary path the helper uses
 * (`/usr/bin/pacstall`): if `which pacstall` resolves a DIFFERENT path the app
 * refuses to install through it (`pathUnexpected`), because the helper would
 * still invoke `/usr/bin/pacstall`.
 */

/** Where the helper invokes pacstall. */
export const PACSTALL_BINARY_PATH = '/usr/bin/pacstall'

/**
 * pacstall v6's metadata directory. Each installed package has a shell-style
 * file `<METADIR>/<name>` written by `build.sh:write_meta`, e.g.
 *
 *     _name="foo"
 *     _version="1.2.3-pacstall1"
 *     _date="..."
 *
 * The installed version is the `_version` field.
 */
export const PACSTALL_METADATA_DIR = '/var/lib/pacstall/metadata'

export interface PacstallStatus {
  /** `/usr/bin/pacstall` exists. */
  readonly installed: boolean
  /** pacstall's own version, or `null` when it cannot be read. */
  readonly version: string | null
  /** The path `which pacstall` resolved, or `null`. */
  readonly path: string | null
  /** `which` resolved a different binary than the one the helper invokes. */
  readonly pathUnexpected: boolean
}

export interface PacstallServiceOptions {
  /** Registry client for `.SRCINFO` lookups; defaults to a real one. */
  readonly registry?: PacstallRegistryLike
  /** App-data directory; passed to the default registry for its cache. */
  readonly appSupportDirectory?: AppSupportDirectory
  /** Executes the privileged helper; injectable so tests record the argv. */
  readonly privilegedProcessRunner?: PrivilegedProcessRunner
  /** Whether the helper is installed; injectable so tests need no root. */
  readonly helperInstalled?: () => Promise<boolean>
  /** Runs unprivileged commands (`which`, `pacstall -V`). */
  readonly runProcess?: ProcessRunner
  /** Debug sink; a no-op by default so tests stay quiet. */
  readonly debugLog?: DebugLog
  /** Absolute path of the root-owned helper; defaults to the installed path. */
  readonly privilegedHelperPath?: string
  /** The pacstall binary the helper invokes; overridable for tests. */
  readonly pacstallPath?: string
  /** The metadata directory; overridable so tests can point at a fixture. */
  readonly metadataDirectory?: string
  /** Launches a command detached; injectable so tests can record the argv. */
  readonly launchDetached?: (command: string) => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate)
    return true
  } catch {
    return false
  }
}

/**
 * Spawns a command detached and resolves immediately, draining both streams so
 * a chatty child cannot deadlock once a pipe buffer fills. The command string
 * is split into executable + arguments on whitespace (argv arrays only — never
 * a shell string).
 */
function defaultLaunchDetached(command: string): Promise<void> {
  const parts = command.trim().split(/\s+/)
  const executable = parts[0]
  const child = spawn(executable, parts.slice(1), {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout?.on('data', () => {})
  child.stderr?.on('data', () => {})
  child.unref()
  return Promise.resolve()
}

/** Matches ANSI SGR colour escapes, e.g. the bold wrapper around `pacstall -V`. */
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

/** Strips ANSI colour escapes from pacstall's `-V` output. */
function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, '')
}

/** The first version-shaped token in `pacstall -V` output, or `null`. */
export function parsePacstallVersion(output: string): string | null {
  const firstLine = stripAnsi(output).split('\n')[0] ?? ''
  for (const token of firstLine.trim().split(/\s+/)) {
    if (/^\d+(\.\d+)*/.test(token)) return token
  }
  return null
}

/**
 * Extracts the installed version from a metadata file's contents.
 *
 * pacstall writes `_version="..."`; the reader also accepts a bare `version=`
 * line and an unquoted value, so a slightly different layout still resolves.
 */
export function extractMetadataVersion(content: string): string | null {
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const match = /^(?:_version|version)\s*=\s*(.*)$/.exec(line)
    if (match == null) continue
    const value = match[1].trim().replace(/^["']|["']$/g, '')
    if (value.length > 0) return value
  }
  return null
}

export class PacstallService {
  private readonly registry: PacstallRegistryLike
  private readonly privilegedProcessRunner: PrivilegedProcessRunner
  private readonly helperInstalled: () => Promise<boolean>
  private readonly runProcess: ProcessRunner
  private readonly debugLog: DebugLog
  private readonly privilegedHelperPath: string
  private readonly pacstallPath: string
  private readonly metadataDirectory: string
  private readonly launchDetached: (command: string) => Promise<void>

  constructor(options: PacstallServiceOptions = {}) {
    this.registry =
      options.registry ?? new PacstallRegistry({ appSupportDirectory: options.appSupportDirectory })
    this.privilegedProcessRunner = options.privilegedProcessRunner ?? defaultPrivilegedProcessRunner
    this.privilegedHelperPath = options.privilegedHelperPath ?? AUTOPACX_HELPER_PATH
    this.helperInstalled = options.helperInstalled ?? (() => fileExists(this.privilegedHelperPath))
    this.runProcess = options.runProcess ?? defaultRunProcess
    this.debugLog = options.debugLog ?? (() => {})
    this.pacstallPath = options.pacstallPath ?? PACSTALL_BINARY_PATH
    this.metadataDirectory = options.metadataDirectory ?? PACSTALL_METADATA_DIR
    this.launchDetached = options.launchDetached ?? defaultLaunchDetached
  }

  private async log(
    category: string,
    message: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    await this.debugLog(category, message, data)
  }

  /** Whether pacstall is installed, where it resolved, and its version. */
  async status(): Promise<PacstallStatus> {
    const resolved = await this.resolveWhich()
    const installed = existsSync(this.pacstallPath)
    const pathUnexpected = resolved !== null && resolved !== this.pacstallPath
    const version = installed ? await this.readPacstallVersion() : null
    return { installed, version, path: resolved, pathUnexpected }
  }

  /** Installs `name` through the helper's `pacstall-install` verb. */
  async install(name: string): Promise<void> {
    this.assertValidName(name)
    await this.runPrivileged('pacstall-install', [name])
  }

  /** Removes `name` through the helper's `pacstall-remove` verb. */
  async remove(name: string): Promise<void> {
    this.assertValidName(name)
    await this.runPrivileged('pacstall-remove', [name])
  }

  /** Upgrades `name` through the helper's `pacstall-upgrade` verb. */
  async upgrade(name: string): Promise<void> {
    this.assertValidName(name)
    await this.runPrivileged('pacstall-upgrade', [name])
  }

  /** Upgrades every package through the helper's `pacstall-upgrade-all` verb. */
  async upgradeAll(): Promise<void> {
    await this.runPrivileged('pacstall-upgrade-all', [])
  }

  /**
   * Launches a package detached: the stored launch command when present,
   * otherwise the package name (which pacstall installs as an executable on
   * `PATH`). Unprivileged and fire-and-forget.
   */
  async launch(pkg: TrackedPacstallPackage): Promise<void> {
    const command = (pkg.launchCommand ?? pkg.name).trim()
    if (command.length === 0) {
      throw new Error(`Cannot launch ${pkg.effectiveDisplayName}: empty launch command`)
    }
    await this.launchDetached(command)
  }

  /**
   * Returns the registry version when it is newer than the installed version,
   * or `null` when there is no update (or no comparable version).
   */
  async checkUpdate(pkg: TrackedPacstallPackage): Promise<string | null> {
    const name = pkg.name
    if (!PACKAGE_NAME_PATTERN.test(name)) return null

    const info = await this.registry.fetchPackageInfo(name)
    const remote = info.pkgver.trim()
    if (remote.length === 0) return null

    const metadataVersion = await this.readInstalledVersion(name)
    const installed = metadataVersion !== 'unknown' ? metadataVersion : pkg.installedVersion
    if (installed == null || installed.trim().length === 0) return null

    return isNewerVersion(normalizeVersion(remote), normalizeVersion(installed)) ? remote : null
  }

  /**
   * Reads the installed version of `name` from pacstall's metadata directory,
   * returning the literal `"unknown"` when it cannot be read. Never throws:
   * a missing or malformed metadata file must not break a status/update sweep.
   *
   * The canonical layout is a file `<METADIR>/<name>` with a `_version` field;
   * a directory holding a `version`/`_version`/`metadata` file is also accepted
   * tolerantly.
   */
  async readInstalledVersion(name: string): Promise<string> {
    if (!PACKAGE_NAME_PATTERN.test(name)) return 'unknown'

    const base = path.join(this.metadataDirectory, name)

    // Canonical layout: a metadata file whose `_version` field holds the version.
    const baseContent = await readFileIfPresent(base)
    if (baseContent !== null) {
      const version = extractMetadataVersion(baseContent)
      if (version !== null) return version
    }

    // Tolerant fallback: a directory holding a bare version file, or a nested
    // metadata file with a `_version` field.
    for (const candidate of [path.join(base, 'version'), path.join(base, '_version')]) {
      const content = await readFileIfPresent(candidate)
      const version = content?.trim() ?? ''
      if (version.length > 0) return version
    }
    const nested = await readFileIfPresent(path.join(base, 'metadata'))
    if (nested !== null) {
      const version = extractMetadataVersion(nested)
      if (version !== null) return version
    }

    return 'unknown'
  }

  /** The path `which pacstall` resolves, or `null` when it is not on PATH. */
  private async resolveWhich(): Promise<string | null> {
    try {
      const result = await this.runProcess('which', ['pacstall'])
      if (result.exitCode !== 0) return null
      const first = result.stdout.split('\n')[0]?.trim() ?? ''
      return first.length > 0 ? first : null
    } catch (error) {
      await this.log('PacstallService', `which pacstall failed: ${errorMessage(error)}`)
      return null
    }
  }

  /** pacstall's own version from `pacstall -V`, or `null`. */
  private async readPacstallVersion(): Promise<string | null> {
    try {
      const result = await this.runProcess(this.pacstallPath, ['-V'])
      if (result.exitCode !== 0) return null
      return parsePacstallVersion(result.stdout)
    } catch (error) {
      await this.log('PacstallService', `pacstall -V failed: ${errorMessage(error)}`)
      return null
    }
  }

  /** Rejects a name that is not a valid package name before any privileged call. */
  private assertValidName(name: string): void {
    if (!PACKAGE_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid pacstall package name: ${name}`)
    }
  }

  /**
   * Runs one helper verb as root. Mirrors `InstallerService.runPrivileged`:
   * the argv is `pkexec <helper> <verb> <args...>` (never a shell string), the
   * helper must be installed, and a non-zero exit is surfaced with both streams.
   */
  private async runPrivileged(verb: HelperVerb, args: readonly string[]): Promise<void> {
    const helper = this.privilegedHelperPath
    if (!(await this.helperInstalled())) {
      throw new Error(
        `Privileged helper not found at ${helper}. AutoPacX must be installed ` +
          'from its package so the root-owned helper and polkit policy are present; ' +
          'running from a source checkout cannot perform privileged installs.'
      )
    }

    const printable = `pkexec ${helper} ${verb} ${args.join(' ')}`
    await this.log('PacstallService', `Running privileged command: ${printable}`)

    let result: ProcessResult
    try {
      result = await this.privilegedProcessRunner('pkexec', [helper, verb, ...args])
    } catch (error) {
      await this.log('PacstallService', `Failed to run privileged command: ${errorMessage(error)}`)
      throw new Error(`Failed to run privileged command: ${errorMessage(error)}`, { cause: error })
    }

    if (result.exitCode !== 0) {
      const stdout = result.stdout.trim()
      const stderr = result.stderr.trim()
      const details = [stdout, stderr].filter((part) => part.length > 0).join('\n')
      await this.log(
        'PacstallService',
        `Privileged command failed (exit code ${result.exitCode}): ${printable}`,
        { stdout, stderr }
      )
      throw new Error(
        `Command failed (exit code ${result.exitCode})${details.length > 0 ? `: ${details}` : ''}`
      )
    }

    await this.log('PacstallService', `Privileged command succeeded: ${printable}`)
  }
}

/** Reads a regular file as UTF-8, or `null` when it is missing/not a file. */
async function readFileIfPresent(candidate: string): Promise<string | null> {
  try {
    return await fs.readFile(candidate, 'utf8')
  } catch {
    return null
  }
}
