// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TrackedApp } from '@core/models/tracked-app'
import { InstallLocationResolver, suggestInstallTargets } from './install-location'

/**
 * Ported from `test/services/install_location_test.dart` (9 tests).
 *
 * The resolver drives real `stat`, `dpkg` and `rpm` processes; the tests place
 * real executables in a temp tree and assert on the discovered candidates.
 */

const resolver = new InstallLocationResolver()

/** Restores 0o755 on every entry so a read-only directory can be removed. */
async function chmodRecursive(root: string, mode: number): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) await chmodRecursive(full, mode)
    await chmod(full, mode)
  }
  await chmod(root, mode)
}

function app(
  init: {
    launchCommand?: string | null
    packageName?: string | null
    repoName?: string
    displayName?: string
  } = {}
): TrackedApp {
  return new TrackedApp({
    repoOwner: 'owner',
    repoName: init.repoName ?? 'myrepo',
    displayName: init.displayName ?? 'My App',
    launchCommand: init.launchCommand ?? null,
    packageName: init.packageName ?? null,
    createdAt: new Date(2024, 0, 1)
  })
}

async function makeExecutable(dir: string, name: string): Promise<string> {
  const file = join(dir, name)
  await writeFile(file, '#!/bin/sh\n')
  await chmod(file, 0o755)
  return file
}

describe('InstallLocationResolver', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'autopacx-loc-test-'))
  })

  afterEach(async () => {
    try {
      await chmodRecursive(tmp, 0o755)
    } catch {
      // Best effort: a chmod failure must not mask the test result.
    }
    try {
      await rm(tmp, { recursive: true, force: true })
    } catch {
      // Best effort cleanup.
    }
  })

  it('resolve finds an executable placed on the injected PATH', async () => {
    const binDir = join(tmp, 'bin')
    await mkdir(binDir)
    await makeExecutable(binDir, 'mytool')

    const results = await resolver.resolve(app({ repoName: 'mytool' }), {
      pathDirs: [binDir],
      home: join(tmp, 'home')
    })

    expect(results).toHaveLength(1)
    expect(results[0].path).toBe(await realpath(join(binDir, 'mytool')))
    expect(results[0].source).toBe('PATH')
  }, 15_000)

  it('resolve dedupes PATH entries that reach the same file via a symlink', async () => {
    const realDir = join(tmp, 'real')
    const linkDir = join(tmp, 'link')
    await mkdir(realDir)
    await mkdir(linkDir)
    await makeExecutable(realDir, 'mytool')
    await symlink(join(realDir, 'mytool'), join(linkDir, 'mytool'))

    const results = await resolver.resolve(app({ repoName: 'mytool' }), {
      pathDirs: [realDir, linkDir],
      home: join(tmp, 'home')
    })

    expect(results).toHaveLength(1)
  }, 15_000)

  it('resolve reports writable == true for a normal directory', async () => {
    const binDir = join(tmp, 'bin')
    await mkdir(binDir)
    await makeExecutable(binDir, 'mytool')

    const results = await resolver.resolve(app({ repoName: 'mytool' }), {
      pathDirs: [binDir],
      home: join(tmp, 'home')
    })

    expect(results).toHaveLength(1)
    expect(results[0].writable).toBe(true)
  }, 15_000)

  it('resolve reports writable == false for a read-only directory', async () => {
    const readOnlyDir = join(tmp, 'ro')
    await mkdir(readOnlyDir)
    await makeExecutable(readOnlyDir, 'mytool')
    await chmod(readOnlyDir, 0o555)

    const results = await resolver.resolve(app({ repoName: 'mytool' }), {
      pathDirs: [readOnlyDir],
      home: join(tmp, 'home')
    })

    expect(results).toHaveLength(1)
    expect(results[0].writable).toBe(false)
  }, 15_000)

  it('resolve marks a binary dropped in a temp dir as not package-owned', async () => {
    const binDir = join(tmp, 'bin')
    await mkdir(binDir)
    await makeExecutable(binDir, 'mytool')

    const results = await resolver.resolve(app({ repoName: 'mytool' }), {
      pathDirs: [binDir],
      home: join(tmp, 'home')
    })

    expect(results).toHaveLength(1)
    // `dpkg -S`/`rpm -qf` must run and report no owning package, rather than
    // the field being hardcoded or the tool being skipped.
    expect(results[0].ownedByPackage).toBe(false)
  }, 15_000)

  it('resolve prefers the launch command entry first when it exists', async () => {
    const pathDir = join(tmp, 'bin')
    await mkdir(pathDir)
    await makeExecutable(pathDir, 'mytool')
    const explicit = await makeExecutable(tmp, 'explicit-tool')

    const results = await resolver.resolve(app({ launchCommand: explicit, repoName: 'mytool' }), {
      pathDirs: [pathDir],
      home: join(tmp, 'home')
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].source).toBe('launch command')
    expect(results[0].path).toBe(await realpath(explicit))
  }, 15_000)

  it('resolve returns an empty list when nothing matches', async () => {
    const emptyDir = join(tmp, 'empty')
    await mkdir(emptyDir)

    const results = await resolver.resolve(app({ repoName: 'does-not-exist-xyz' }), {
      pathDirs: [emptyDir],
      home: join(tmp, 'home')
    })

    expect(results).toEqual([])
  }, 15_000)

  it('isDirWritable answers without writing so probing leaves no stray file behind', async () => {
    const dir = join(tmp, 'probe')
    await mkdir(dir)
    const before = (await readdir(dir)).sort()
    // A create-then-delete probe bumps the directory mtime even though it
    // removes the file again, so this detects a transient write too.
    const modifiedBefore = (await stat(dir)).mtimeMs

    expect(await InstallLocationResolver.isDirWritable(dir)).toBe(true)
    // Called twice to catch a probe that creates and removes a file.
    expect(await InstallLocationResolver.isDirWritable(dir)).toBe(true)

    const after = (await readdir(dir)).sort()
    expect(after).toEqual(before)
    expect((await stat(dir)).mtimeMs).toBe(modifiedBefore)
  }, 15_000)

  it('isDirWritable reports a chmod 555 directory as not writable', async () => {
    const readOnly = join(tmp, 'ro2')
    await mkdir(readOnly)
    await chmod(readOnly, 0o555)

    expect(await InstallLocationResolver.isDirWritable(readOnly)).toBe(false)
  })
})

describe('suggestInstallTargets', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'autopacx-targets-test-'))
  })

  afterEach(async () => {
    try {
      await chmodRecursive(tmp, 0o755)
    } catch {
      // Best effort: a chmod failure must not mask the test result.
    }
    try {
      await rm(tmp, { recursive: true, force: true })
    } catch {
      // Best effort cleanup.
    }
  })

  it('enumerates PATH dirs plus the well-known directories, deduped', async () => {
    const binDir = join(tmp, 'bin')
    const home = join(tmp, 'home')
    const localBin = join(home, '.local', 'bin')
    await mkdir(binDir, { recursive: true })
    await mkdir(localBin, { recursive: true })

    const targets = await suggestInstallTargets(app({ repoName: 'myrepo' }), {
      pathDirs: [binDir, localBin],
      home
    })

    const paths = targets.map((target) => target.path)
    expect(paths).toContain(binDir)
    expect(paths).toContain(localBin)
    expect(paths).toContain('/usr/local/bin')
    // `~/.local/bin` is both a PATH entry and a well-known dir: it must appear
    // exactly once after dedupe.
    expect(paths.filter((entry) => entry === localBin)).toHaveLength(1)
  }, 15_000)

  it('includes the app-specific /opt/<name>/bin directory', async () => {
    const targets = await suggestInstallTargets(app({ repoName: 'myrepo' }), {
      pathDirs: [join(tmp, 'bin')],
      home: join(tmp, 'home')
    })

    expect(targets.map((target) => target.path)).toContain('/opt/myrepo/bin')
  }, 15_000)

  it('marks onPath for a PATH entry and reports its writability', async () => {
    const binDir = join(tmp, 'bin')
    await mkdir(binDir, { recursive: true })

    const targets = await suggestInstallTargets(app({ repoName: 'myrepo' }), {
      pathDirs: [binDir],
      home: join(tmp, 'home')
    })

    const entry = targets.find((target) => target.path === binDir)
    expect(entry).toBeDefined()
    expect(entry?.onPath).toBe(true)
    expect(entry?.writable).toBe(true)
    expect(entry?.ownedByPackage).toBe(false)
  }, 15_000)

  it('reports writable == false for a read-only directory', async () => {
    const readOnly = join(tmp, 'ro')
    await mkdir(readOnly)
    await chmod(readOnly, 0o555)

    const targets = await suggestInstallTargets(app({ repoName: 'myrepo' }), {
      pathDirs: [readOnly],
      home: join(tmp, 'home')
    })

    expect(targets.find((target) => target.path === readOnly)?.writable).toBe(false)
  }, 15_000)

  it('recommends a writable ~/.local/bin over the other candidates', async () => {
    const home = join(tmp, 'home')
    const localBin = join(home, '.local', 'bin')
    await mkdir(localBin, { recursive: true })

    const targets = await suggestInstallTargets(app({ repoName: 'myrepo' }), {
      pathDirs: [join(tmp, 'bin')],
      home
    })

    const recommended = targets.filter((target) => target.recommended)
    expect(recommended).toHaveLength(1)
    expect(recommended[0].path).toBe(localBin)
  }, 15_000)

  it('never recommends a non-writable candidate', async () => {
    const home = join(tmp, 'home')
    const localBin = join(home, '.local', 'bin')
    await mkdir(localBin, { recursive: true })
    await chmod(localBin, 0o555)

    const targets = await suggestInstallTargets(app({ repoName: 'myrepo' }), {
      pathDirs: [join(tmp, 'bin')],
      home
    })

    const recommended = targets.filter((target) => target.recommended)
    expect(recommended.every((target) => target.writable)).toBe(true)
    expect(recommended.some((target) => target.path === localBin)).toBe(false)
  }, 15_000)
})
