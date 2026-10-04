// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { spawn, type ChildProcess } from 'node:child_process'
import type { TrackedApp } from '@core/models/tracked-app'
import type { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { runProcess, type ProcessRunner } from './process-runner'
import type { DebugLogSink } from './debug-logger'

/** Resolves an app's externally installed version, or null when unknown. */
export type VersionProvider = (app: TrackedApp) => Promise<string | null>

/** Resolves a deb package's externally installed version, or null. */
export type DebVersionProvider = (pkg: TrackedDebPackage) => Promise<string | null>

export interface ExternalAppCheckerOptions {
  /** Low-level `Process.run` equivalent; overridable so tests can stub tools. */
  readonly processRunner?: ProcessRunner
  /** App version provider, overridable for testing. */
  readonly versionProvider?: VersionProvider
  /** Deb package version provider, overridable for testing. */
  readonly debVersionProvider?: DebVersionProvider
  /** Milliseconds before a hung probe binary is killed (default 2000). */
  readonly killTimeoutMs?: number
  /** Milliseconds before waiting for exit gives up (default 5000). */
  readonly exitTimeoutMs?: number
  /** Debug sink; a no-op by default so tests stay quiet. */
  readonly debugLog?: DebugLogSink
}

/**
 * Budget for `dpkg -S` / `rpm -qf`, which scan the whole package file database
 * rather than an index.
 *
 * Measured at ~1.8 s warm on a 3808-package Debian system, so the previous 2 s
 * budget left almost no headroom and expired on a cold cache. A timeout here is
 * not harmless: the caller falls through to executing the binary to read its
 * version, which is exactly what the package lookup exists to avoid.
 */
const PACKAGE_LOOKUP_TIMEOUT_MS = 10_000

const DEFAULT_KILL_TIMEOUT_MS = 2_000
const DEFAULT_EXIT_TIMEOUT_MS = 5_000

const VERSION_PATTERN = /(?:v|version\s+)?(\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.-]+)?)/i
const FALLBACK_VERSION_PATTERN = /^v?(\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.-]+)?)$/

const SUFFIX_PATTERN = /-(?:go|rust|desktop|linux|app|cli|gui|client|server|bin|bundle)$/g
const DOT_SUFFIX_PATTERN = /\.(?:go|rust|desktop|linux|app|cli|gui|client|server|bin|bundle)$/g
const NON_ALNUM_PATTERN = /[^a-z0-9]/g

/**
 * Checks whether an app or deb package is installed externally and reads its
 * version, ported from `lib/services/external_app_checker.dart`.
 *
 * The Dart original keeps its seams in mutable static fields; here they are
 * constructor-injected so tests can stub the runner and version providers
 * without touching global state.
 */
export class ExternalAppChecker {
  private readonly processRunner: ProcessRunner
  private readonly versionProvider: VersionProvider
  private readonly debVersionProvider: DebVersionProvider
  private readonly killTimeoutMs: number
  private readonly exitTimeoutMs: number
  private readonly debugLog: DebugLogSink

  constructor(options: ExternalAppCheckerOptions = {}) {
    this.processRunner = options.processRunner ?? runProcess
    this.killTimeoutMs = options.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS
    this.exitTimeoutMs = options.exitTimeoutMs ?? DEFAULT_EXIT_TIMEOUT_MS
    this.debugLog = options.debugLog ?? (() => {})
    this.versionProvider =
      options.versionProvider ?? ((app) => this.checkGuesses(app.repoName, generateAppGuesses(app)))
    this.debVersionProvider =
      options.debVersionProvider ?? ((pkg) => this.checkGuesses(pkg.name, generateDebGuesses(pkg)))
  }

  private async log(category: string, message: string): Promise<void> {
    await this.debugLog(category, message)
  }

  /** Checks if the app is installed externally and returns its version. */
  async getExternalVersion(app: TrackedApp): Promise<string | null> {
    return this.versionProvider(app)
  }

  /** Checks if the deb package is installed externally and returns its version. */
  async getExternalDebVersion(pkg: TrackedDebPackage): Promise<string | null> {
    return this.debVersionProvider(pkg)
  }

  /**
   * Looks up `guesses` against dpkg and PATH.
   *
   * Exact package-name matches are tried for every guess first; only if none of
   * them hit do we fall back to the fuzzy `*$name*` wildcard, which can
   * otherwise attribute an unrelated package's version to the app.
   */
  private async checkGuesses(identifier: string, guesses: string[]): Promise<string | null> {
    await this.log(
      'ExternalAppChecker',
      `Checking ${identifier} with guesses: [${guesses.join(', ')}]`
    )

    // 1. Exact dpkg-query match, then a PATH binary, per guess.
    for (const name of guesses) {
      const exact = await this.dpkgExactVersion(name)
      if (exact !== null) return exact

      const fromPath = await this.pathBinaryVersion(name)
      if (fromPath !== null) return fromPath
    }

    // 2. Wildcard fallback (last resort, only for reasonably long names).
    for (const name of guesses) {
      if (name.length < 4) continue
      const wildcard = await this.dpkgWildcardVersion(name)
      if (wildcard !== null) return wildcard
    }

    await this.log('ExternalAppChecker', `No version found for ${identifier}`)
    return null
  }

  private async dpkgExactVersion(name: string): Promise<string | null> {
    try {
      // Resolved through PATH: /usr/bin only exists on Debian-family systems.
      const res = await withTimeout(
        this.processRunner('dpkg-query', ['-W', '--showformat=${Version}', name]),
        2_000
      )
      if (res.exitCode !== 0) return null
      const out = res.stdout.trim()
      if (out.length === 0) return null
      await this.log('ExternalAppChecker', `dpkg-query found match for ${name}: ${out}`)
      const ver = ExternalAppChecker.extractVersion(out)
      if (ver !== null) {
        await this.log('ExternalAppChecker', `Extracted version from dpkg for ${name}: ${ver}`)
      }
      return ver
    } catch (error) {
      await this.log(
        'ExternalAppChecker',
        `Error in dpkg-query for ${name}: ${errorMessage(error)}`
      )
      return null
    }
  }

  /**
   * Fuzzy `*$name*` lookup. An exact package-name row always wins over any
   * other candidate the wildcard returned.
   */
  private async dpkgWildcardVersion(name: string): Promise<string | null> {
    try {
      const res = await withTimeout(
        this.processRunner('dpkg-query', [
          '-W',
          '--showformat=${Package}|${Version}\\n',
          `*${name}*`
        ]),
        2_000
      )
      if (res.exitCode !== 0) return null

      const candidates: Array<{ pkg: string; ver: string }> = []
      for (const line of res.stdout.trim().split('\n')) {
        const parts = line.split('|')
        if (parts.length !== 2) continue
        const pkg = parts[0].trim()
        const ver = ExternalAppChecker.extractVersion(parts[1])
        if (ver === null) continue
        await this.log('ExternalAppChecker', `dpkg wildcard match: ${pkg} -> ${parts[1]}`)
        candidates.push({ pkg, ver })
      }

      for (const candidate of candidates) {
        if (candidate.pkg.toLowerCase() === name.toLowerCase()) {
          await this.log(
            'ExternalAppChecker',
            `Using exact wildcard row ${candidate.pkg} for ${name}`
          )
          return candidate.ver
        }
      }
      if (candidates.length > 0) {
        await this.log(
          'ExternalAppChecker',
          `Extracted version from dpkg wildcard for ${name}: ${candidates[0].ver}`
        )
        return candidates[0].ver
      }
      return null
    } catch (error) {
      await this.log(
        'ExternalAppChecker',
        `Error in dpkg-query wildcard for ${name}: ${errorMessage(error)}`
      )
      return null
    }
  }

  /**
   * Whether `name` resolves to an executable on the current PATH.
   *
   * Decides whether a guessed launch command is worth storing. A repository
   * name is frequently not the executable its package ships, and a stored
   * command that cannot run also poisons version detection.
   */
  async isExecutableOnPath(name: string): Promise<boolean> {
    if (name.length === 0) return false
    try {
      const res = await withTimeout(this.processRunner('which', [name]), 1_000)
      return res.exitCode === 0 && res.stdout.trim().length > 0
    } catch {
      return false
    }
  }

  /** Runs `<name> --version` / `<name> -v` for a binary found on PATH. */
  private async pathBinaryVersion(name: string): Promise<string | null> {
    try {
      const whichRes = await withTimeout(this.processRunner('which', [name]), 1_000)
      if (whichRes.exitCode !== 0) return null
      const binaryPath = whichRes.stdout.trim()
      if (binaryPath.length === 0) return null

      await this.log('ExternalAppChecker', `which found binary for ${name} at ${binaryPath}`)

      // Prefer the owning package's version. A GUI launcher that ignores its
      // arguments would otherwise be launched by the `--version` probe below.
      const fromPackage = await this.packageVersionForPath(binaryPath)
      if (fromPackage !== null) {
        await this.log(
          'ExternalAppChecker',
          `Extracted version from owning package for ${name}: ${fromPackage}`
        )
        return fromPackage
      }

      const ver = await this.runWithTimeout(binaryPath, ['--version'])
      if (ver !== null) {
        await this.log('ExternalAppChecker', `Extracted version via --version for ${name}: ${ver}`)
        return ver
      }

      // Try -v if --version failed.
      const verShort = await this.runWithTimeout(binaryPath, ['-v'])
      if (verShort !== null) {
        await this.log('ExternalAppChecker', `Extracted version via -v for ${name}: ${verShort}`)
      }
      return verShort
    } catch (error) {
      await this.log('ExternalAppChecker', `Error in which/run for ${name}: ${errorMessage(error)}`)
      return null
    }
  }

  /**
   * Returns the version of the package that owns `path`, without executing the
   * binary itself.
   *
   * Debian-family systems are queried with `dpkg -S`, RPM-based ones with
   * `rpm -qf`. Returns null on any failure so callers fall back to probing the
   * binary directly.
   */
  private async packageVersionForPath(binaryPath: string): Promise<string | null> {
    // Debian: `dpkg -S <path>` prints `<package>: <path>`.
    try {
      const res = await withTimeout(
        this.processRunner('dpkg', ['-S', binaryPath]),
        PACKAGE_LOOKUP_TIMEOUT_MS
      )
      if (res.exitCode === 0) {
        const out = res.stdout.trim()
        const pkg = out.split(':')[0].trim()
        if (pkg.length > 0) {
          const ver = await this.dpkgExactVersion(pkg)
          if (ver !== null) return ver
        }
      }
    } catch (error) {
      await this.log(
        'ExternalAppChecker',
        `Error in dpkg -S for ${binaryPath}: ${errorMessage(error)}`
      )
      // Fall through to rpm.
    }

    // RPM fallback: `rpm -qf --queryformat %{VERSION} <path>` prints the owning
    // package's version directly.
    try {
      const res = await withTimeout(
        this.processRunner('rpm', ['-qf', '--queryformat', '%{VERSION}', binaryPath]),
        PACKAGE_LOOKUP_TIMEOUT_MS
      )
      if (res.exitCode === 0) {
        const out = res.stdout.trim()
        if (out.length > 0) return ExternalAppChecker.extractVersion(out) ?? out
      }
    } catch (error) {
      await this.log(
        'ExternalAppChecker',
        `Error in rpm -qf for ${binaryPath}: ${errorMessage(error)}`
      )
      // No owning package known.
    }

    return null
  }

  /**
   * Starts `cmd` with `args`, killing it after the kill timeout and giving up
   * after the exit timeout. Both output streams are drained so a chatty child
   * cannot deadlock; only stdout is parsed.
   */
  private runWithTimeout(cmd: string, args: string[]): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      let child: ChildProcess
      try {
        child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      } catch {
        resolve(null)
        return
      }

      const output: Buffer[] = []
      let settled = false
      const finish = (value: string | null): void => {
        if (settled) return
        settled = true
        resolve(value)
      }

      child.stdout?.on('data', (chunk: Buffer) => output.push(chunk))
      // Drain stderr: an unread pipe would block a child that writes enough.
      child.stderr?.resume()

      // Safety timer to kill the process if it hangs (e.g. GUI launches).
      const killTimer = setTimeout(() => {
        child.kill()
      }, this.killTimeoutMs)
      const exitTimer = setTimeout(() => {
        child.kill()
        finish(null)
      }, this.exitTimeoutMs)

      child.once('error', () => {
        clearTimeout(killTimer)
        clearTimeout(exitTimer)
        finish(null)
      })
      child.once('close', (code) => {
        clearTimeout(killTimer)
        clearTimeout(exitTimer)
        if (code === 0) {
          finish(ExternalAppChecker.extractVersion(Buffer.concat(output).toString('utf8')))
        } else {
          finish(null)
        }
      })
    })
  }

  static extractVersion(output: string): string | null {
    const trimmed = output.trim()
    if (trimmed.length === 0) return null

    const match = VERSION_PATTERN.exec(trimmed)
    if (match !== null && match[1] !== undefined && match[1].length > 0) {
      return match[1]
    }

    // Fallback: accept only output that is itself a plausible version, e.g.
    // "1.2.3" or "1.2.3-rc1". This avoids mistaking a bare year or build
    // number (e.g. "2024") for a version.
    const fallback = FALLBACK_VERSION_PATTERN.exec(trimmed)
    if (fallback !== null && fallback[1] !== undefined) return fallback[1]

    return null
  }
}

/**
 * Extracts potential package/app names from a filename.
 */
export function extractNameGuessesFromFilename(fileName: string): string[] {
  const guesses = new Set<string>()

  // Extract everything before first version-like part or first -/_
  const namePart = fileName.split(/[-_1-9]/)[0].toLowerCase()
  if (namePart.length > 1) {
    guesses.add(namePart)
    guesses.add(`${namePart}.io`)
  }

  const firstSegment = fileName.split(/[-_]/)[0].toLowerCase()
  if (firstSegment.length > 1) {
    guesses.add(firstSegment)
  }

  return [...guesses]
}

function generateAppGuesses(app: TrackedApp): string[] {
  const guesses = new Set<string>()

  // 1. Explicit package name or launch command.
  if (app.packageName !== null && app.packageName.length > 0) {
    guesses.add(app.packageName)
  }
  if (app.launchCommand !== null && app.launchCommand.length > 0) {
    // If it's a full path, get the basename.
    guesses.add(lastSegment(app.launchCommand))
    // Also try the whole command if it's just a name.
    if (!app.launchCommand.includes('/')) {
      guesses.add(app.launchCommand)
    }
  }

  // 2. Repo name and variations.
  const repoLower = app.repoName.toLowerCase()
  guesses.add(repoLower)

  // 3. Repo owner (often the package name for multi-repo projects).
  const ownerLower = app.repoOwner.toLowerCase()
  guesses.add(ownerLower)
  guesses.add(`${ownerLower}.io`)

  // Strip common suffixes like -go, -rust, -desktop.
  const cleanRepo = repoLower.replace(SUFFIX_PATTERN, '').replace(DOT_SUFFIX_PATTERN, '')
  if (cleanRepo !== repoLower) {
    guesses.add(cleanRepo)
  }

  // Also try adding .io (common for modern apps).
  guesses.add(`${cleanRepo}.io`)

  // 4. Extract name from fetched package filename.
  if (app.fetchedPackage !== null && app.fetchedPackage.length > 0) {
    const fileName = lastSegment(app.fetchedPackage)
    for (const guess of extractNameGuessesFromFilename(fileName)) {
      guesses.add(guess)
    }
  }

  // 5. Display name variations (first word).
  const displayFirst = app.displayName.split(' ')[0].toLowerCase().replace(NON_ALNUM_PATTERN, '')
  if (displayFirst.length > 2) {
    guesses.add(displayFirst)
    guesses.add(`${displayFirst}.io`)
  }

  return [...guesses]
}

function generateDebGuesses(pkg: TrackedDebPackage): string[] {
  const guesses = new Set<string>()

  // 1. The package's own name first — an exact match on it is the most
  //    trustworthy answer.
  guesses.add(pkg.name.toLowerCase())

  // 2. Explicit package name or launch command.
  if (pkg.packageName !== null && pkg.packageName.length > 0) {
    guesses.add(pkg.packageName)
  }
  if (pkg.launchCommand !== null && pkg.launchCommand.length > 0) {
    guesses.add(lastSegment(pkg.launchCommand))
    if (!pkg.launchCommand.includes('/')) {
      guesses.add(pkg.launchCommand)
    }
  }

  // Strip common suffixes.
  const cleanName = pkg.name.toLowerCase().replace(SUFFIX_PATTERN, '')
  if (cleanName !== pkg.name.toLowerCase()) {
    guesses.add(cleanName)
  }

  // 3. Display name variations.
  if (pkg.displayName !== null) {
    const displayFirst = pkg.displayName.split(' ')[0].toLowerCase().replace(NON_ALNUM_PATTERN, '')
    if (displayFirst.length > 2) {
      guesses.add(displayFirst)
    }
  }

  return [...guesses]
}

/** Dart's `s.split('/').last`. */
function lastSegment(value: string): string {
  const parts = value.split('/')
  return parts[parts.length - 1]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** `Promise.race` against a rejection timer; the loser's rejection is consumed. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
