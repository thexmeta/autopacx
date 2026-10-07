// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { TrackedApp } from '@core/models/tracked-app'
import { runProcess } from './process-runner'

export interface InstallLocationInit {
  readonly path: string
  readonly source: string
  readonly writable: boolean
  readonly ownedByPackage: boolean
}

/**
 * A single candidate location where an app's executable may live.
 *
 * `path` is absolute with symlinks resolved so that two entries pointing at the
 * same file (via different PATH entries or a symlink) compare equal.
 */
export class InstallLocation {
  readonly path: string
  readonly source: string
  readonly writable: boolean
  readonly ownedByPackage: boolean

  constructor(init: InstallLocationInit) {
    this.path = init.path
    this.source = init.source
    this.writable = init.writable
    this.ownedByPackage = init.ownedByPackage
  }
}

export interface ResolveOptions {
  /** Overrides the real `PATH`; defaults to `process.env.PATH`. */
  readonly pathDirs?: readonly string[]
  /** Overrides the real `HOME`; defaults to `process.env.HOME`. */
  readonly home?: string
}

/** A candidate directory a raw-binary install could target. */
export interface InstallTargetSuggestion {
  readonly path: string
  /** Whether the current user can write into the directory. */
  readonly writable: boolean
  /** Whether the directory is already on the process `PATH`. */
  readonly onPath: boolean
  /** Whether the directory belongs to an installed system package. */
  readonly ownedByPackage: boolean
  /** Whether this is the top-ranked candidate the UI should pre-select. */
  readonly recommended: boolean
}

export interface SuggestInstallTargetsOptions {
  /** Overrides the real `PATH`; defaults to `process.env.PATH`. */
  readonly pathDirs?: readonly string[]
  /** Overrides the real `HOME`; defaults to `process.env.HOME`. */
  readonly home?: string
}

/**
 * Discovers where an already-installed binary for a `TrackedApp` lives.
 *
 * Detection never guesses a fixed directory: it returns every candidate it can
 * prove exists so the UI can ask the user when there is more than one. Ported
 * from `lib/services/install_location.dart`.
 */
export class InstallLocationResolver {
  /**
   * `pathDirs` and `home` are injectable for tests; they default to the real
   * `PATH` and `HOME`, so production callers pass nothing.
   */
  async resolve(app: TrackedApp, options: ResolveOptions = {}): Promise<InstallLocation[]> {
    const dirs =
      options.pathDirs ?? (process.env.PATH ?? '').split(':').filter((dir) => dir.length > 0)
    const homeDir = options.home ?? process.env.HOME

    const results: InstallLocation[] = []
    const seen = new Set<string>()

    const launchToken = firstToken(app.launchCommand)

    // 1. An explicit launch command is the strongest signal: if it is an
    //    absolute path to a real file, that is where the app runs from.
    if (launchToken !== null && path.isAbsolute(launchToken)) {
      if (await isRegularFile(launchToken)) {
        const loc = await this.build(launchToken, 'launch command', seen)
        if (loc !== null) results.push(loc)
      }
    }

    // 2. Derive the executable name we should look for.
    const name = executableName(app, launchToken)

    // 3. Walk PATH in order.
    for (const dir of dirs) {
      const candidate = path.join(dir, name)
      if (await isExecutableFile(candidate)) {
        const loc = await this.build(candidate, 'PATH', seen)
        if (loc !== null) results.push(loc)
      }
    }

    // 4. Probe well-known install directories not already covered.
    for (const dir of await wellKnownDirs(homeDir)) {
      const candidate = path.join(dir, name)
      if (await isExecutableFile(candidate)) {
        const loc = await this.build(candidate, 'well-known', seen)
        if (loc !== null) results.push(loc)
      }
    }

    return results
  }

  /**
   * Builds an `InstallLocation` for a path already confirmed to exist,
   * returning null when an equivalent location was seen before.
   */
  private async build(
    candidate: string,
    source: string,
    seen: Set<string>
  ): Promise<InstallLocation | null> {
    // `fs.realpath` throws for a missing path; callers only pass
    // confirmed-existing paths, and we fall back to the absolute path on any
    // other failure.
    let key: string
    try {
      key = await fs.realpath(candidate)
    } catch {
      key = path.resolve(candidate)
    }
    if (seen.has(key)) return null
    seen.add(key)

    return new InstallLocation({
      path: key,
      source,
      writable: await InstallLocationResolver.isDirWritable(path.dirname(candidate)),
      ownedByPackage: await InstallLocationResolver.isDirOwnedByPackage(candidate)
    })
  }

  /**
   * Whether `dirPath` is writable by the current user.
   *
   * This is a pure read. Ownership and mode come from `stat`; the effective
   * uid/gid and the supplementary group set come from `/proc/self/status`. A
   * directory is writable when the effective uid is 0, or the owner uid matches
   * and the owner-write bit is set, or the owning gid is one of our groups and
   * the group-write bit is set, or the other-write bit is set.
   *
   * POSIX ACLs are not considered: evaluating them needs libacl, so a directory
   * granted write access only through an ACL reports false. The computation is
   * conservative (it never reports writable for a directory we cannot write),
   * which is the safe direction.
   *
   * Returns false when the path is missing or any lookup fails.
   */
  static async isDirWritable(dirPath: string): Promise<boolean> {
    try {
      const stat = await runProcess('stat', ['-c', '%u %g %a', dirPath])
      if (stat.exitCode !== 0) return false
      const fields = stat.stdout.trim().split(/\s+/)
      if (fields.length < 3) return false
      const ownerUid = Number.parseInt(fields[0], 10)
      const ownerGid = Number.parseInt(fields[1], 10)
      const mode = Number.parseInt(fields[2], 8)
      if (Number.isNaN(ownerUid) || Number.isNaN(ownerGid) || Number.isNaN(mode)) return false

      const ids = await processIds()
      if (ids === null) return false
      if (ids.uid === 0) return true
      if (ownerUid === ids.uid && (mode & 0o200) !== 0) return true
      if (ids.groups.has(ownerGid) && (mode & 0o020) !== 0) return true
      if ((mode & 0o002) !== 0) return true
      return false
    } catch {
      return false
    }
  }

  /**
   * Whether `candidate` belongs to an installed package, via `dpkg -S`
   * (Debian) falling back to `rpm -qf` (RPM). Never throws: a missing package
   * tool or a non-zero exit simply means "not known to be package-owned".
   *
   * The rpm probe runs only when `dpkg` itself is unavailable (the Dart original
   * wraps `Process.run` in try/catch, which throws when the binary is absent).
   * A `dpkg -S` that ran and exited non-zero means "not owned", so it must not
   * fall through to rpm.
   */
  static async isDirOwnedByPackage(candidate: string): Promise<boolean> {
    try {
      const res = await runProcess('dpkg', ['-S', candidate])
      return res.exitCode === 0
    } catch {
      // dpkg is unavailable — fall through to rpm.
    }
    try {
      const res = await runProcess('rpm', ['-qf', candidate])
      return res.exitCode === 0
    } catch {
      return false
    }
  }
}

/**
 * Suggests directories a raw-binary install could target.
 *
 * Enumerates the process `PATH` followed by the well-known install directories
 * (`~/.local/bin`, `/usr/local/bin`, `/usr/bin`, every `/opt/<name>/bin`) plus
 * the app-specific `/opt/<app>/bin`, deduplicating on the resolved path. Each
 * candidate is marked writable / on-PATH / package-owned, and the best
 * user-writable candidate is flagged `recommended`: `~/.local/bin` wins, then
 * `/usr/local/bin`, then the first remaining writable directory. Restores the
 * Dart `chooseInstallTarget` behaviour.
 *
 * `pathDirs` and `home` are injectable for tests; they default to the real
 * `PATH` and `HOME`.
 */
export async function suggestInstallTargets(
  app: TrackedApp,
  options: SuggestInstallTargetsOptions = {}
): Promise<InstallTargetSuggestion[]> {
  const pathDirs =
    options.pathDirs ?? (process.env.PATH ?? '').split(':').filter((dir) => dir.length > 0)
  const homeDir = options.home ?? process.env.HOME

  const onPath = new Set(pathDirs.map((dir) => path.resolve(dir)))

  const ordered: string[] = []
  const seen = new Set<string>()
  const add = (dir: string): void => {
    const resolved = path.resolve(dir)
    if (seen.has(resolved)) return
    seen.add(resolved)
    ordered.push(resolved)
  }

  for (const dir of pathDirs) add(dir)
  for (const dir of await wellKnownDirs(homeDir)) add(dir)
  for (const dir of appSpecificDirs(app)) add(dir)

  const candidates: InstallTargetSuggestion[] = await Promise.all(
    ordered.map(async (dir) => ({
      path: dir,
      writable: await InstallLocationResolver.isDirWritable(dir),
      onPath: onPath.has(dir),
      // Only probe the (slow) package-manager lookup for directories that
      // actually exist; a missing directory cannot be package-owned.
      ownedByPackage: (await isDirectory(dir))
        ? await InstallLocationResolver.isDirOwnedByPackage(dir)
        : false,
      recommended: false
    }))
  )

  const recommendedPath = chooseRecommendedPath(candidates, homeDir)
  return candidates.map((candidate) =>
    candidate.path === recommendedPath ? { ...candidate, recommended: true } : candidate
  )
}

/** The app-specific `/opt/<name>/bin` directory, or none when the name is blank. */
function appSpecificDirs(app: TrackedApp): string[] {
  const name = [app.packageName, app.repoName, app.displayName]
    .map((value) => value?.trim() ?? '')
    .find((value) => value.length > 0)
  if (name === undefined) return []
  return [path.join('/opt', name, 'bin')]
}

/**
 * Picks the path to mark `recommended`: a writable `~/.local/bin` first, then a
 * writable `/usr/local/bin`, then the first remaining writable candidate.
 * Returns `null` when no candidate is writable.
 */
function chooseRecommendedPath(
  candidates: readonly InstallTargetSuggestion[],
  home: string | undefined
): string | null {
  const writable = candidates.filter((candidate) => candidate.writable)
  if (writable.length === 0) return null

  if (home !== undefined && home.length > 0) {
    const homeLocalBin = path.resolve(path.join(home, '.local', 'bin'))
    const match = writable.find((candidate) => candidate.path === homeLocalBin)
    if (match !== undefined) return match.path
  }

  const usrLocalBin = writable.find(
    (candidate) => candidate.path === path.resolve('/usr/local/bin')
  )
  if (usrLocalBin !== undefined) return usrLocalBin.path

  return writable[0].path
}

/** Returns the first whitespace-separated token of `command`, or null. */
function firstToken(command: string | null): string | null {
  if (command === null) return null
  const trimmed = command.trim()
  if (trimmed.length === 0) return null
  return trimmed.split(/\s+/)[0]
}

function executableName(app: TrackedApp, launchToken: string | null): string {
  if (launchToken !== null && launchToken.length > 0) {
    return path.basename(launchToken)
  }
  if (app.packageName !== null && app.packageName.length > 0) {
    return app.packageName
  }
  if (app.repoName.length > 0) {
    return app.repoName.toLowerCase()
  }
  return app.displayName.toLowerCase()
}

/**
 * Well-known directories, in probe order. Home-relative probes are skipped when
 * `home` is undefined.
 */
async function wellKnownDirs(home: string | undefined): Promise<string[]> {
  const dirs: string[] = []
  if (home !== undefined && home.length > 0) {
    dirs.push(path.join(home, '.local', 'bin'))
  }
  dirs.push('/usr/local/bin')
  dirs.push('/usr/bin')

  // Each `/opt/<app>/bin` is a common layout for self-contained bundles.
  try {
    const entries = await fs.readdir('/opt', { withFileTypes: true })
    for (const entity of entries) {
      if (entity.isDirectory()) {
        dirs.push(path.join('/opt', entity.name, 'bin'))
      }
    }
  } catch {
    // A missing or unreadable /opt simply yields no extra candidates.
  }
  return dirs
}

async function isRegularFile(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate)
    return stat.isFile()
  } catch {
    return false
  }
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate)
    return stat.isDirectory()
  } catch {
    return false
  }
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  if (!(await isRegularFile(candidate))) return false
  // Any execute bit (owner/group/other) is enough. The mode check is only used
  // to decide *whether the file looks like a program*; the real writability
  // question is answered by an actual write probe elsewhere.
  try {
    const stat = await fs.stat(candidate)
    return (stat.mode & 0o111) !== 0
  } catch {
    return false
  }
}

/**
 * The process's effective uid and its group set (effective gid plus the
 * supplementary groups), read from `/proc/self/status`. Null when the file is
 * unreadable or malformed.
 */
async function processIds(): Promise<{ uid: number; groups: Set<number> } | null> {
  try {
    const status = await fs.readFile('/proc/self/status', 'utf8')
    let uid: number | null = null
    let gid: number | null = null
    const groups = new Set<number>()
    for (const line of status.split('\n')) {
      if (line.startsWith('Uid:')) {
        // real, effective, saved, filesystem — effective is the second.
        const fields = line.slice(4).trim().split(/\s+/)
        if (fields.length >= 2) {
          const parsed = Number.parseInt(fields[1], 10)
          uid = Number.isNaN(parsed) ? null : parsed
        }
      } else if (line.startsWith('Gid:')) {
        const fields = line.slice(4).trim().split(/\s+/)
        if (fields.length >= 2) {
          const parsed = Number.parseInt(fields[1], 10)
          gid = Number.isNaN(parsed) ? null : parsed
        }
      } else if (line.startsWith('Groups:')) {
        for (const group of line.slice(7).trim().split(/\s+/)) {
          const value = Number.parseInt(group, 10)
          if (!Number.isNaN(value)) groups.add(value)
        }
      }
    }
    if (uid === null) return null
    // The effective gid is itself one of the groups the process holds.
    if (gid !== null) groups.add(gid)
    return { uid, groups }
  } catch {
    return null
  }
}
