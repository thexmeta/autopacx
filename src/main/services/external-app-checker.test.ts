// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TrackedApp } from '@core/models/tracked-app'
import { ExternalAppChecker } from './external-app-checker'
import type { ProcessResult, ProcessRunner } from './process-runner'

/**
 * Ported from `test/services/external_app_checker_test.dart` (15 tests), plus
 * two additions: the exact argv arrays passed to `dpkg -S` / `rpm -qf`, and the
 * kill-timeout layering of the `--version` probe.
 */

function result(exitCode: number, stdout = '', stderr = ''): ProcessResult {
  return { exitCode, stdout, stderr }
}

/** The tracked app used by the version-probe tests below. */
function probeApp(): TrackedApp {
  return new TrackedApp({
    repoOwner: 'io',
    repoName: 'linsticky',
    displayName: 'Linsticky',
    launchCommand: 'linsticky',
    packageName: 'linsticky',
    createdAt: new Date(2026, 0, 1)
  })
}

/**
 * Installs a runner that answers only the commands the version probe issues:
 * `which` always resolves to `scriptPath`, `dpkg-query` never matches, and the
 * owning-package lookups return `dpkgS` / `rpm` verbatim.
 */
function installRunner(opts: {
  scriptPath: string
  dpkgS: ProcessResult
  rpm: ProcessResult
}): ProcessRunner {
  return async (executable, args) => {
    if (executable === 'dpkg-query') return result(1)
    if (executable === 'which') return result(0, opts.scriptPath)
    if (executable === 'dpkg' && args.length === 2 && args[0] === '-S') return opts.dpkgS
    if (executable === 'rpm' && args.length === 4 && args[0] === '-qf') return opts.rpm
    return result(1)
  }
}

describe('ExternalAppChecker.extractVersion', () => {
  it('extracts standard semantic versions', () => {
    expect(ExternalAppChecker.extractVersion('1.2.3')).toBe('1.2.3')
    expect(ExternalAppChecker.extractVersion('v1.2.3')).toBe('1.2.3')
    expect(ExternalAppChecker.extractVersion('Version 1.2.3')).toBe('1.2.3')
    expect(ExternalAppChecker.extractVersion('version 1.2.3')).toBe('1.2.3')
  })

  it('extracts versions with pre-release tags', () => {
    expect(ExternalAppChecker.extractVersion('1.2.3-beta.1')).toBe('1.2.3-beta.1')
    expect(ExternalAppChecker.extractVersion('v2.0.0-rc1')).toBe('2.0.0-rc1')
    expect(ExternalAppChecker.extractVersion('1.0.0-alpha')).toBe('1.0.0-alpha')
  })

  it('extracts versions from messy output', () => {
    expect(ExternalAppChecker.extractVersion('git version 2.34.1')).toBe('2.34.1')
    expect(ExternalAppChecker.extractVersion('Docker version 24.0.5, build ced0996')).toBe('24.0.5')
    expect(ExternalAppChecker.extractVersion('Python 3.10.12')).toBe('3.10.12')
    expect(ExternalAppChecker.extractVersion('autonex 0.3.5')).toBe('0.3.5')
  })

  it('extracts short versions', () => {
    expect(ExternalAppChecker.extractVersion('1.2')).toBe('1.2')
    expect(ExternalAppChecker.extractVersion('v1.2')).toBe('1.2')
  })

  it('returns null for unparseable output', () => {
    expect(ExternalAppChecker.extractVersion('command not found')).toBeNull()
    expect(ExternalAppChecker.extractVersion('No package found matching')).toBeNull()
  })
})

describe('ExternalAppChecker.getExternalVersion', () => {
  let tempDir: string
  let scriptPath: string
  let markerPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ext-app-checker-test-'))
    scriptPath = join(tempDir, 'linsticky')
    markerPath = join(tempDir, 'launched.marker')
    // A launcher that discards its arguments and starts a GUI. Writing the
    // marker is the observable side effect of it being run.
    await writeFile(scriptPath, `#!/bin/sh\ntouch "${markerPath}"\n`)
    await chmod(scriptPath, 0o755)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('a package-owned launcher that ignores arguments is never executed', async () => {
    const runner: ProcessRunner = async (executable, args) => {
      if (executable === 'which' && args.length === 1 && args[0] === 'linsticky') {
        return result(0, scriptPath)
      }
      if (
        executable === 'dpkg' &&
        args.length === 2 &&
        args[0] === '-S' &&
        args[1] === scriptPath
      ) {
        return result(0, `io.linsticky.app: ${scriptPath}`)
      }
      if (
        executable === 'dpkg-query' &&
        args.length === 3 &&
        args[0] === '-W' &&
        args[1] === '--showformat=${Version}' &&
        args[2] === 'io.linsticky.app'
      ) {
        return result(0, '2.0.3')
      }
      return result(1)
    }
    const checker = new ExternalAppChecker({ processRunner: runner })

    const version = await checker.getExternalVersion(probeApp())

    expect(version).toBe('2.0.3')
    // The launcher must not be executed by the version probe.
    await expect(fileExists(markerPath)).resolves.toBe(false)
  })

  it('falls back to rpm when no dpkg package owns the binary', async () => {
    const checker = new ExternalAppChecker({
      processRunner: installRunner({
        scriptPath,
        // Not owned by any dpkg package: dpkg -S exits non-zero.
        dpkgS: result(1, '', 'dpkg-query: no path found matching pattern'),
        rpm: result(0, '2.0.3\n')
      })
    })

    const version = await checker.getExternalVersion(probeApp())

    expect(version).toBe('2.0.3')
    await expect(fileExists(markerPath)).resolves.toBe(false)
  })

  it('falls back to rpm when dpkg -S names an owner with no version', async () => {
    const checker = new ExternalAppChecker({
      processRunner: installRunner({
        scriptPath,
        dpkgS: result(0, `io.linsticky.app: ${scriptPath}`),
        // dpkg-query for that owner yields nothing (exit 1 from the runner's
        // dpkg-query branch), so the probe must continue to rpm.
        rpm: result(0, '2.0.3\n')
      })
    })

    const version = await checker.getExternalVersion(probeApp())

    expect(version).toBe('2.0.3')
    await expect(fileExists(markerPath)).resolves.toBe(false)
  })

  it('returns the raw rpm output when it holds no parseable version', async () => {
    const checker = new ExternalAppChecker({
      processRunner: installRunner({
        scriptPath,
        dpkgS: result(1),
        rpm: result(0, 'unknown\n')
      })
    })

    const version = await checker.getExternalVersion(probeApp())

    expect(version).toBe('unknown')
    await expect(fileExists(markerPath)).resolves.toBe(false)
  })

  it('still executes the binary when no package owns it', async () => {
    const checker = new ExternalAppChecker({
      processRunner: installRunner({ scriptPath, dpkgS: result(1), rpm: result(1) })
    })

    const version = await checker.getExternalVersion(probeApp())

    // The canary prints nothing, so no version is discoverable...
    expect(version).toBeNull()
    // ...but the marker proves the --version probe still ran.
    await expect(fileExists(markerPath)).resolves.toBe(true)
  })

  it('waits out a slow package lookup instead of executing the binary', async () => {
    // `dpkg -S` scans the whole package file database rather than an index:
    // measured at ~1.8 s warm on a 3808-package system. The original 2 s budget
    // expired there and fell through to running the launcher, so the lookup must
    // tolerate well past that.
    const runner: ProcessRunner = async (executable, args) => {
      if (executable === 'which') return result(0, scriptPath)
      if (executable === 'dpkg' && args.length === 2 && args[0] === '-S') {
        await new Promise((resolve) => setTimeout(resolve, 2500))
        return result(0, `io.linsticky.app: ${scriptPath}`)
      }
      if (executable === 'dpkg-query' && args.length === 3 && args[2] === 'io.linsticky.app') {
        return result(0, '2.0.3')
      }
      return result(1)
    }
    const checker = new ExternalAppChecker({ processRunner: runner })

    const version = await checker.getExternalVersion(probeApp())

    expect(version).toBe('2.0.3')
    await expect(fileExists(markerPath)).resolves.toBe(false)
  })

  it('passes dpkg -S and rpm -qf exact argv arrays', async () => {
    const calls: Array<{ exe: string; args: readonly string[] }> = []
    const runner: ProcessRunner = async (executable, args) => {
      calls.push({ exe: executable, args })
      if (executable === 'which') return result(0, scriptPath)
      if (executable === 'dpkg' && args[0] === '-S') return result(1)
      if (executable === 'rpm') return result(0, '2.0.3\n')
      return result(1)
    }
    const checker = new ExternalAppChecker({ processRunner: runner })

    const version = await checker.getExternalVersion(probeApp())

    expect(version).toBe('2.0.3')
    const dpkgCall = calls.find((call) => call.exe === 'dpkg')
    expect(dpkgCall?.args).toEqual(['-S', scriptPath])
    const rpmCall = calls.find((call) => call.exe === 'rpm')
    expect(rpmCall?.args).toEqual(['-qf', '--queryformat', '%{VERSION}', scriptPath])
  })

  it('kills a hung --version probe at the kill timeout', async () => {
    const sleepyPath = join(tempDir, 'sleepy')
    // `exec` replaces the shell so the killed pid is the sleeping process
    // itself, leaving no orphan behind.
    await writeFile(sleepyPath, '#!/bin/sh\nexec sleep 30\n')
    await chmod(sleepyPath, 0o755)

    // Resolve only the first guess so exactly one `--version` and one `-v`
    // probe run; every later guess falls through without spawning.
    const runner: ProcessRunner = async (executable, args) => {
      if (executable === 'which' && args[0] === 'linsticky') return result(0, sleepyPath)
      return result(1)
    }
    const checker = new ExternalAppChecker({
      processRunner: runner,
      killTimeoutMs: 100,
      exitTimeoutMs: 5_000
    })

    const start = Date.now()
    const version = await checker.getExternalVersion(probeApp())
    const elapsed = Date.now() - start

    expect(version).toBeNull()
    // A kill at 100 ms resolves far sooner than the 5 s exit budget; if the kill
    // were ineffective the call would block until the exit timeout.
    expect(elapsed).toBeLessThan(2_000)
  })
})

describe('ExternalAppChecker.isExecutableOnPath', () => {
  it('true when which resolves a path', async () => {
    const checker = new ExternalAppChecker({
      processRunner: async () => result(0, '/usr/bin/mq\n')
    })
    expect(await checker.isExecutableOnPath('mq')).toBe(true)
  })

  it('false when nothing by that name runs', async () => {
    // FluxDown: the repository name is not the name of anything installed.
    const checker = new ExternalAppChecker({ processRunner: async () => result(1) })
    expect(await checker.isExecutableOnPath('fluxdown')).toBe(false)
  })

  it('false for an empty name, without running anything', async () => {
    let called = false
    const checker = new ExternalAppChecker({
      processRunner: async () => {
        called = true
        return result(0, '/usr/bin/x')
      }
    })
    expect(await checker.isExecutableOnPath('')).toBe(false)
    expect(called).toBe(false)
  })

  it('false when which succeeds but prints no path', async () => {
    const checker = new ExternalAppChecker({ processRunner: async () => result(0, '') })
    expect(await checker.isExecutableOnPath('mq')).toBe(false)
  })
})

/** Node's `fs.access` equivalent for a boolean existence check. */
async function fileExists(filePath: string): Promise<boolean> {
  const { access } = await import('node:fs/promises')
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}
