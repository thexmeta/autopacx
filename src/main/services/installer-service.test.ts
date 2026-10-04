// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { execFileSync } from 'node:child_process'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InstallType } from '@core/models/install-type'
import { TrackedApp } from '@core/models/tracked-app'
import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { InstallerService } from './installer-service'
import { AUTONEX_HELPER_PATH } from './privileged-helper'
import type {
  DetachedProcess,
  DetachedSpawner,
  DownloadHttpClient,
  DownloadStreamedResponse
} from './installer-service'

/**
 * Ported from `test/services/installer_service_test.dart` (41 tests) plus
 * extra coverage for the detached launch and the uninstall argv paths.
 *
 * The privileged runner, the HTTP transport and the app-support directory are
 * injected so no `pkexec` ever runs and no network is touched.
 */

/** The exact wording shown when an archive contains no executable. */
const noBinaryWarning = 'This entry cant be installable. It doesnt include binary/executable.'

/** The installed helper every privileged argv must go through. */
const HELPER = AUTONEX_HELPER_PATH

function emptyStream(): AsyncIterable<Uint8Array> {
  return Readable.from([]) as AsyncIterable<Uint8Array>
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await readFile(candidate)
    return true
  } catch {
    return false
  }
}

async function chmodRecursive(root: string, mode: number): Promise<void> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) await chmodRecursive(full, mode)
    try {
      await chmod(full, mode)
    } catch {
      // Best effort.
    }
  }
  try {
    await chmod(root, mode)
  } catch {
    // Best effort.
  }
}

/** Copies a real ELF executable into `dest` and marks it executable. */
async function makeElf(dest: string): Promise<string> {
  await copyFile('/usr/bin/true', dest)
  await chmod(dest, 0o755)
  return dest
}

/** An independent BigInt implementation of FNV-1a 32-bit over UTF-16 code units. */
function referenceFnv1a(input: string): string {
  let hash = 0x811c9dc5n
  for (let index = 0; index < input.length; index++) {
    hash ^= BigInt(input.charCodeAt(index))
    hash = (hash * 0x01000193n) & 0xffffffffn
  }
  return hash.toString(16).padStart(8, '0')
}

describe('InstallerService.identifyAssetType', () => {
  const service = new InstallerService()

  it('maps archive suffixes to binary because they carry an extractable payload', () => {
    for (const name of [
      'tool.tar.gz',
      'tool.tgz',
      'tool.tar.xz',
      'tool.txz',
      'tool.tar.bz2',
      'tool.tbz2',
      'tool.tar.zst',
      'tool.zip'
    ]) {
      expect(service.identifyAssetType(name), name).toBe(InstallType.binary)
    }
  })

  it('maps extension-less release asset names to binary', () => {
    expect(service.identifyAssetType('computer-use-linux-x86_64-unknown-linux-gnu')).toBe(
      InstallType.binary
    )
    expect(service.identifyAssetType('waza-linux-amd64')).toBe(InstallType.binary)
  })

  it('returns null for a script or json so they are never installed as executables', () => {
    expect(service.identifyAssetType('download_cli.sh')).toBeNull()
    expect(service.identifyAssetType('latest.json')).toBeNull()
  })

  it('keeps deb/rpm/appimage detection so package formats still win', () => {
    expect(service.identifyAssetType('tool.deb')).toBe(InstallType.deb)
    expect(service.identifyAssetType('tool.rpm')).toBe(InstallType.rpm)
    expect(service.identifyAssetType('Tool.AppImage')).toBe(InstallType.appImage)
  })

  it('rejects extension-less documentation and metadata so they are never offered as binaries', () => {
    for (const name of [
      'LICENSE',
      'README',
      'SHA256SUMS',
      'CHANGELOG',
      'latest',
      'checksums',
      '.gitignore'
    ]) {
      expect(service.identifyAssetType(name), name).toBeNull()
    }
    expect(service.identifyAssetType('computer-use-linux-x86_64-unknown-linux-gnu')).toBe(
      InstallType.binary
    )
    expect(service.identifyAssetType('waza-linux-amd64')).toBe(InstallType.binary)
  })

  it('refuses an unanticipated extension-less metadata name, which no denylist can enumerate in advance', () => {
    for (const name of [
      'checksums-2026',
      'SHA256SUMS-2026',
      'release-info',
      'build-3',
      'notes',
      'KEYS',
      'SOURCE'
    ]) {
      expect(service.identifyAssetType(name), name).toBeNull()
    }
  })

  it('still accepts an extension-less Linux binary because its name carries a platform token', () => {
    for (const name of [
      'waza-linux-amd64',
      'biome-linux-x64-musl',
      'computer-use-linux-x86_64-unknown-linux-gnu',
      'mytool-linux',
      'mytool-arm64',
      'mytool-musl'
    ]) {
      expect(service.identifyAssetType(name), name).toBe(InstallType.binary)
    }
  })

  it('recognises a bare extension-less asset as the app binary when the name matches the app', () => {
    const app = new TrackedApp({
      repoOwner: 'owner',
      repoName: 'mytool',
      displayName: 'My Tool',
      createdAt: new Date('2026-01-01T00:00:00Z')
    })

    expect(service.identifyAssetType('mytool', { app })).toBe(InstallType.binary)
    expect(service.identifyAssetType('Mytool', { app })).toBe(InstallType.binary)
    // With no app context there is nothing to match, so it stays unclassified.
    expect(service.identifyAssetType('mytool')).toBeNull()
    expect(service.identifyAssetType('othertool', { app })).toBeNull()
  })

  it('matches the expected executable through the launch command and package name', () => {
    const app = new TrackedApp({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Repo',
      launchCommand: '/usr/local/bin/launched-tool --flag',
      packageName: 'pkg-tool',
      createdAt: new Date('2026-01-01T00:00:00Z')
    })

    expect(service.identifyAssetType('launched-tool', { app })).toBe(InstallType.binary)
    expect(service.identifyAssetType('pkg-tool', { app })).toBe(InstallType.binary)
  })
})

describe('InstallerService.installPackage binary', () => {
  const service = new InstallerService()
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'autonex-inst-test-'))
  })

  afterEach(async () => {
    try {
      await chmodRecursive(tmp, 0o755)
      await rm(tmp, { recursive: true, force: true })
    } catch {
      // Best effort cleanup.
    }
  })

  async function systemTempEntries(): Promise<string[]> {
    return (await readdir(tmpdir())).map((entry) => basename(entry))
  }

  it('installs an executable from a .tar.gz and preserves the old target as .bak', async () => {
    const build = join(tmp, 'build')
    const binDir = join(build, 'bin')
    await mkdir(binDir, { recursive: true })
    const tool = await makeElf(join(binDir, 'mytool'))

    const archive = join(tmp, 'mytool.tar.gz')
    execFileSync('tar', ['-czf', archive, '-C', build, 'bin'])

    const outDir = join(tmp, 'out')
    await mkdir(outDir)
    const target = join(outDir, 'mytool')
    await writeFile(target, 'OLD-BYTES')
    await chmod(target, 0o755)

    const before = await systemTempEntries()

    const result = await service.installPackage(archive, InstallType.binary, {
      targetPath: target,
      binaryName: 'mytool'
    })

    expect(await exists(target)).toBe(true)
    expect((await readFile(target)).equals(await readFile(tool))).toBe(true)

    const backup = join(`${target}.bak`)
    expect(await exists(backup)).toBe(true)
    expect(await readFile(backup, 'utf8')).toBe('OLD-BYTES')

    expect(result.launchCommand).toBe(target)
    expect(result.packageName).toBe('mytool')

    // No staging file left behind on the success path.
    expect(await exists(`${target}.tmp`)).toBe(false)

    const leftovers = (await systemTempEntries()).filter(
      (entry) => entry.startsWith('autonex_binary_') && !before.includes(entry)
    )
    expect(leftovers).toEqual([])
  }, 20_000)

  it('installs an executable from a .zip', async () => {
    const build = join(tmp, 'zbuild')
    await mkdir(build)
    const tool = await makeElf(join(build, 'mytool'))

    const archive = join(tmp, 'mytool.zip')
    execFileSync('zip', ['-q', '-r', archive, 'mytool'], { cwd: build })

    const outDir = join(tmp, 'zout')
    await mkdir(outDir)
    const target = join(outDir, 'mytool')

    const result = await service.installPackage(archive, InstallType.binary, {
      targetPath: target,
      binaryName: 'mytool'
    })

    expect(await exists(target)).toBe(true)
    expect((await readFile(target)).equals(await readFile(tool))).toBe(true)
    expect(result.packageName).toBe('mytool')
  }, 20_000)

  it('installs a raw ELF binary that has no archive suffix', async () => {
    const raw = await makeElf(join(tmp, 'rawtool'))
    const outDir = join(tmp, 'rout')
    await mkdir(outDir)
    const target = join(outDir, 'rawtool')

    const result = await service.installPackage(raw, InstallType.binary, { targetPath: target })

    expect(await exists(target)).toBe(true)
    expect(result.packageName).toBe('rawtool')
  }, 20_000)

  it('refuses a non-ELF file and names it in the error', async () => {
    const text = join(tmp, 'notabinary')
    await writeFile(text, 'hello world')
    const outDir = join(tmp, 'tout')
    await mkdir(outDir)
    const target = join(outDir, 'notabinary')

    await expect(
      service.installPackage(text, InstallType.binary, { targetPath: target })
    ).rejects.toThrow('notabinary')
  })

  it('rejects an archive payload that is not ELF, so a README-like script is never installed', async () => {
    const build = join(tmp, 'sbuild')
    await mkdir(build)
    const script = join(build, 'mytool')
    await writeFile(script, '#!/bin/sh\necho not-a-binary\n')
    await chmod(script, 0o755)

    const archive = join(tmp, 'script.tar.gz')
    execFileSync('tar', ['-czf', archive, '-C', build, 'mytool'])

    const outDir = join(tmp, 'sout')
    await mkdir(outDir)
    const target = join(outDir, 'mytool')

    await expect(
      service.installPackage(archive, InstallType.binary, {
        targetPath: target,
        binaryName: 'mytool'
      })
    ).rejects.toThrow(noBinaryWarning)
    expect(await exists(target)).toBe(false)
  }, 20_000)

  it('refuses a source-only archive with the plain warning the user asked for', async () => {
    const build = join(tmp, 'pbuild')
    const pkgDir = join(build, 'src', 'mcp_server_analyzer')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(join(build, 'pyproject.toml'), '[project]\nname = "mcp-server-analyzer"\n')
    await writeFile(join(pkgDir, '__main__.py'), 'print("hi")\n')

    const archive = join(tmp, 'sdist.tar.gz')
    execFileSync('tar', ['-czf', archive, '-C', build, '.'])

    const outDir = join(tmp, 'pout')
    await mkdir(outDir)
    const target = join(outDir, '__main__.py')

    await expect(
      service.installPackage(archive, InstallType.binary, {
        targetPath: target,
        binaryName: '__main__.py'
      })
    ).rejects.toThrow(noBinaryWarning)
    expect(await exists(target)).toBe(false)
  }, 20_000)

  it('picks the executable-bit file from an archive, not the larger README', async () => {
    const build = join(tmp, 'abuild')
    await mkdir(build)
    await writeFile(join(build, 'README'), 'R'.repeat(5000))
    const tool = await makeElf(join(build, 'mytool'))

    const archive = join(tmp, 'app.tar.gz')
    execFileSync('tar', ['-czf', archive, '-C', build, '.'])

    const outDir = join(tmp, 'aout')
    await mkdir(outDir)
    const target = join(outDir, 'installed')

    await service.installPackage(archive, InstallType.binary, { targetPath: target })

    expect(await exists(target)).toBe(true)
    expect((await readFile(target)).length).toBe((await readFile(tool)).length)
    expect((await readFile(target)).length).not.toBe(5000)
  }, 20_000)

  it('selects the same executable from an archive on every run so the pick is deterministic', async () => {
    const build = join(tmp, 'dbuild')
    await mkdir(build)
    await writeFile(join(build, 'README'), 'R'.repeat(5000))
    await writeFile(join(build, 'libfoo.so'), 'L'.repeat(2000))
    const tool = await makeElf(join(build, 'mytool'))

    const archive = join(tmp, 'app.tar.gz')
    execFileSync('tar', ['-czf', archive, '-C', build, '.'])
    const archive2 = join(tmp, 'app2.tar.gz')
    await copyFile(archive, archive2)

    const out1 = join(tmp, 'out1', 'mytool')
    const out2 = join(tmp, 'out2', 'mytool')

    await service.installPackage(archive, InstallType.binary, { targetPath: out1 })
    await service.installPackage(archive2, InstallType.binary, { targetPath: out2 })

    const elfBytes = await readFile(tool)
    expect((await readFile(out1)).equals(elfBytes)).toBe(true)
    expect((await readFile(out2)).equals(elfBytes)).toBe(true)
  }, 20_000)

  it('rejects a target whose basename starts with "-" so install cannot treat it as an option', async () => {
    const raw = await makeElf(join(tmp, 'rawtool2'))
    const target = join(tmp, '-t')

    await expect(
      service.installPackage(raw, InstallType.binary, { targetPath: target })
    ).rejects.toThrow('must not start with "-"')
  }, 20_000)

  it('rejects a directory target, a symlink target, a /dev target and a relative target', async () => {
    const raw = await makeElf(join(tmp, 'rawtool3'))
    const outDir = join(tmp, 'vout')
    await mkdir(outDir)

    const directoryTarget = join(outDir, 'isdir')
    await mkdir(directoryTarget)
    await expect(
      service.installPackage(raw, InstallType.binary, { targetPath: directoryTarget })
    ).rejects.toThrow('is a directory')

    const realFile = join(outDir, 'real')
    await writeFile(realFile, 'x')
    const linkPath = join(outDir, 'alink')
    await symlink(realFile, linkPath)
    await expect(
      service.installPackage(raw, InstallType.binary, { targetPath: linkPath })
    ).rejects.toThrow('symbolic link')

    await expect(
      service.installPackage(raw, InstallType.binary, {
        targetPath: '/dev/autonex-not-a-device'
      })
    ).rejects.toThrow('Refusing to install into /dev')

    await expect(
      service.installPackage(raw, InstallType.binary, { targetPath: 'relative/tool' })
    ).rejects.toThrow('must be absolute')
  }, 20_000)

  it('keys the app-data backup by full path so same-named targets do not collide', () => {
    const first = InstallerService.appDataBackupName('/opt/a/tool')
    const second = InstallerService.appDataBackupName('/opt/b/tool')

    expect(first).not.toBe(second)
    expect(first.endsWith('.bak')).toBe(true)
    expect(second.endsWith('.bak')).toBe(true)
    expect(first.startsWith('tool.')).toBe(true)
    expect(second.startsWith('tool.')).toBe(true)
  })

  it('removes the staged .tmp and leaves the old target intact when backup fails', async () => {
    const raw = await makeElf(join(tmp, 'rawtool4'))
    const outDir = join(tmp, 'hout')
    await mkdir(outDir)
    const target = join(outDir, 'tool')
    await writeFile(target, 'OLD')
    // A directory at <target>.bak makes the backup copy fail after staging.
    await mkdir(`${target}.bak`)

    await expect(
      service.installPackage(raw, InstallType.binary, { targetPath: target })
    ).rejects.toThrow()

    expect(await readFile(target, 'utf8')).toBe('OLD')
    expect(await exists(`${target}.tmp`)).toBe(false)
  }, 20_000)
})

describe('InstallerService.downloadFile transport limits', () => {
  let service: InstallerService
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'autonex-dl-test-'))
    service = new InstallerService({ appSupportDirectory: async () => tmp, maxDownloadBytes: 1024 })
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  function downloaded(name: string): string {
    return join(tmp, 'downloads', name)
  }

  function clientReturning(
    handler: (url: string) => Promise<DownloadStreamedResponse>
  ): DownloadHttpClient {
    return { send: (url) => handler(url) }
  }

  function bodyResponse(
    body: Uint8Array,
    options: { statusCode?: number; contentLength?: number | null; chunkSize?: number } = {}
  ): DownloadStreamedResponse {
    const { statusCode = 200, chunkSize = 16 } = options
    const contentLength = options.contentLength === undefined ? body.length : options.contentLength
    async function* generate(): AsyncGenerator<Uint8Array> {
      for (let index = 0; index < body.length; index += chunkSize) {
        yield body.subarray(index, Math.min(index + chunkSize, body.length))
      }
    }
    return { statusCode, headers: {}, contentLength, isRedirect: false, stream: generate() }
  }

  it('refuses a plaintext url so the installed bytes cannot be chosen in transit', async () => {
    await expect(
      service.downloadFile('http://example.test/tool.tar.gz', 'tool.tar.gz')
    ).rejects.toThrow('Refusing to download over http')
    expect(await exists(downloaded('tool.tar.gz'))).toBe(false)
  })

  it('refuses a redirect that downgrades to plaintext so an on-path attacker cannot supply the binary', async () => {
    service.httpClientFactory = () =>
      clientReturning(async () => ({
        statusCode: 302,
        headers: { location: 'http://evil.test/tool.tar.gz' },
        contentLength: null,
        isRedirect: true,
        stream: emptyStream()
      }))

    await expect(
      service.downloadFile('https://good.test/tool.tar.gz', 'tool.tar.gz')
    ).rejects.toThrow('downgraded to http://evil.test')
  })

  it('refuses an oversized Content-Length before the disk is touched', async () => {
    service.httpClientFactory = () =>
      clientReturning(async () => bodyResponse(new Uint8Array(64).fill(7), { contentLength: 4096 }))

    await expect(
      service.downloadFile('https://good.test/tool.tar.gz', 'tool.tar.gz')
    ).rejects.toThrow('exceeds the 1024 byte limit')
    expect(await exists(downloaded('tool.tar.gz'))).toBe(false)
  })

  it('aborts a body that grows past the cap and deletes the partial file', async () => {
    service.httpClientFactory = () =>
      clientReturning(async () =>
        bodyResponse(new Uint8Array(4096).fill(7), { contentLength: null })
      )

    await expect(
      service.downloadFile('https://good.test/tool.tar.gz', 'tool.tar.gz')
    ).rejects.toThrow('exceeded the 1024 byte limit')
    // A truncated file must not survive to be installed.
    expect(await exists(downloaded('tool.tar.gz'))).toBe(false)
  })

  it('still writes a normal https body under the cap', async () => {
    service.httpClientFactory = () =>
      clientReturning(async () => bodyResponse(new Uint8Array(512).fill(7)))

    const file = await service.downloadFile('https://good.test/tool.tar.gz', 'tool.tar.gz')

    expect(await exists(file)).toBe(true)
    expect((await readFile(file)).length).toBe(512)
  })
})

describe('InstallerService privileged install path', () => {
  let service: InstallerService
  let tmp: string
  let appData: string
  let recorded: string[][]

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'autonex-priv-test-'))
    appData = join(tmp, 'appdata')
    await mkdir(appData)
    recorded = []
    service = new InstallerService({
      appSupportDirectory: async () => appData,
      helperInstalled: async () => true
    })
    // pkexec must never run in a test; record the argv instead.
    service.privilegedProcessRunner = async (executable, args) => {
      recorded.push([executable, ...args])
      return { exitCode: 0, stdout: '', stderr: '' }
    }
  })

  afterEach(async () => {
    try {
      await chmodRecursive(tmp, 0o755)
      await rm(tmp, { recursive: true, force: true })
    } catch {
      // Best effort cleanup.
    }
  })

  async function readOnlyTargetWith(name: string, content: string): Promise<string> {
    const dir = join(tmp, 'ro')
    await mkdir(dir, { recursive: true })
    const target = join(dir, name)
    await writeFile(target, content)
    await chmod(dir, 0o555)
    return target
  }

  it('backs up beside the target through the helper backup verb when the directory is not writable', async () => {
    const target = await readOnlyTargetWith('tool', 'OLD-BINARY')
    const payload = await makeElf(join(tmp, 'payload'))

    await service.installPackage(payload, InstallType.binary, {
      targetPath: target,
      binaryName: 'tool'
    })

    // The backup must land where the user can find it, not in app data.
    expect(recorded).toContainEqual(['pkexec', HELPER, 'backup', target])
  }, 20_000)

  it('stages into the private staging dir then installs in ONE helper call with positional paths', async () => {
    const target = await readOnlyTargetWith('tool', 'OLD-BINARY')
    const payload = await makeElf(join(tmp, 'payload'))

    await service.installPackage(payload, InstallType.binary, {
      targetPath: target,
      binaryName: 'tool'
    })

    // The only privileged call is `pkexec <helper> atomic-install <staged> <target>`:
    // no shell, no interpolated paths, and the source is the app's staging dir.
    const argv = recorded.at(-1)
    expect(argv?.[0]).toBe('pkexec')
    expect(argv?.[1]).toBe(HELPER)
    expect(argv?.[2]).toBe('atomic-install')
    expect(argv?.[4]).toBe(target)
    const staged = argv?.[3] ?? ''
    expect(staged.startsWith(join(appData, 'staging') + '/')).toBe(true)
    // The staged payload was cleaned up (staging dir is user-owned).
    expect(await exists(staged)).toBe(false)
  }, 20_000)

  it('falls back to an app-data backup keyed by full path when the privileged backup fails', async () => {
    const target = await readOnlyTargetWith('tool', 'OLD-BINARY')
    const payload = await makeElf(join(tmp, 'payload'))
    service.privilegedProcessRunner = async (executable, args) => {
      recorded.push([executable, ...args])
      if (args.length > 0 && args[1] === 'backup') {
        return { exitCode: 1, stdout: '', stderr: 'cp failed' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    await service.installPackage(payload, InstallType.binary, {
      targetPath: target,
      binaryName: 'tool'
    })

    const expected = join(appData, 'binary_backups', InstallerService.appDataBackupName(target))
    expect(await exists(expected)).toBe(true)
    expect(await readFile(expected, 'utf8')).toBe('OLD-BINARY')
    expect(basename(expected)).toMatch(/^tool\.[0-9a-f]{8}\.bak$/)
  }, 20_000)

  it('keys app-data backups by full path so same-named targets do not clobber each other', () => {
    const a = InstallerService.appDataBackupName('/opt/one/tool')
    const b = InstallerService.appDataBackupName('/opt/two/tool')

    expect(a).not.toBe(b)
    expect(basename(a).startsWith('tool.')).toBe(true)
  })

  it('computes the FNV-1a backup hash identically to an independent BigInt reference', () => {
    for (const target of ['/opt/a/tool', '/home/user/.local/bin/mytool', '/usr/bin/with space']) {
      const actual = InstallerService.appDataBackupName(target)
      expect(actual).toBe(`${basename(target)}.${referenceFnv1a(target)}.bak`)
    }
  })

  it('leaves the target untouched and throws when the privileged install fails', async () => {
    const target = await readOnlyTargetWith('tool', 'OLD-BINARY')
    const payload = await makeElf(join(tmp, 'payload'))
    service.privilegedProcessRunner = async (executable, args) => {
      recorded.push([executable, ...args])
      if (args.length > 0 && args[1] === 'atomic-install') {
        return { exitCode: 1, stdout: '', stderr: 'install failed' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    await expect(
      service.installPackage(payload, InstallType.binary, {
        targetPath: target,
        binaryName: 'tool'
      })
    ).rejects.toThrow()

    expect(await readFile(target, 'utf8')).toBe('OLD-BINARY')
  }, 20_000)

  it('removes the staged payload from the private staging dir after a failed install', async () => {
    const dir = join(tmp, 'ro2')
    await mkdir(dir, { recursive: true })
    const target = join(dir, 'tool')
    await writeFile(target, 'OLD-BINARY')
    await chmod(dir, 0o555)

    const payload = await makeElf(join(tmp, 'payload'))
    service.privilegedProcessRunner = async (executable, args) => {
      recorded.push([executable, ...args])
      if (args.length > 0 && args[1] === 'atomic-install') {
        return { exitCode: 1, stdout: '', stderr: 'install failed' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    await expect(
      service.installPackage(payload, InstallType.binary, {
        targetPath: target,
        binaryName: 'tool'
      })
    ).rejects.toThrow()

    // The failed atomic-install must not leave the staged payload behind.
    const staging = join(appData, 'staging')
    expect(await readdir(staging)).toEqual([])
    expect(await readFile(target, 'utf8')).toBe('OLD-BINARY')
  }, 20_000)

  it('installs a .deb through an ABSOLUTE path, because pkexec resets cwd', async () => {
    const downloads = join(tmp, 'downloads')
    await mkdir(downloads, { recursive: true })
    const deb = join(downloads, 'cliptoo_2.17.1-1_amd64.deb')
    await writeFile(deb, 'not-really-a-deb')

    await service.installPackage(deb, InstallType.deb)

    const argv = recorded[0]
    expect(argv.slice(0, 3)).toEqual(['pkexec', HELPER, 'apt-install'])
    const pathArg = argv[3]
    expect(pathArg).toBe(deb)
    expect(isAbsolute(pathArg)).toBe(true)
    expect(pathArg.startsWith('./')).toBe(false)
  }, 20_000)

  it('reports stdout before stderr so apt output reads in command order', async () => {
    const downloads = join(tmp, 'downloads')
    await mkdir(downloads, { recursive: true })
    const deb = join(downloads, 'cliptoo_2.17.1-1_amd64.deb')
    await writeFile(deb, 'not-really-a-deb')

    service.privilegedProcessRunner = async (executable, args) => {
      recorded.push([executable, ...args])
      return {
        exitCode: 100,
        stdout:
          'Reading package lists...\n' +
          'The following packages have unmet dependencies:\n' +
          ' cliptoo : Depends: libqt6gui6t64 (>= 6.1.2) but it is not installable',
        stderr: 'E: Unable to correct problems, you have held broken packages.'
      }
    }

    let thrown: unknown
    try {
      await service.installPackage(deb, InstallType.deb)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeDefined()
    const message = String(thrown)
    expect(message).toContain('exit code 100')
    expect(message).toContain('Reading package lists')
    expect(message).toContain('E: Unable to correct problems')
    expect(message.indexOf('Reading package lists')).toBeLessThan(
      message.indexOf('E: Unable to correct problems')
    )
  }, 20_000)

  it('installs an rpm through the exact privileged helper argv', async () => {
    const downloads = join(tmp, 'downloads')
    await mkdir(downloads, { recursive: true })
    const rpmPath = join(downloads, 'cliptoo.rpm')
    await writeFile(rpmPath, 'not-really-an-rpm')

    await service.installPackage(rpmPath, InstallType.rpm)

    expect(recorded[0]).toEqual(['pkexec', HELPER, 'rpm-install', rpmPath])
  }, 20_000)

  it('uninstalls a deb through the exact privileged helper argv', async () => {
    const app = new TrackedApp({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Repo',
      installType: InstallType.deb,
      packageName: 'cliptoo',
      createdAt: new Date('2026-01-01T00:00:00Z')
    })

    await service.uninstallPackage(app)

    expect(recorded).toEqual([['pkexec', HELPER, 'dpkg-remove', 'cliptoo']])
  })

  it('uninstalls an rpm through the exact privileged helper argv', async () => {
    const app = new TrackedApp({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Repo',
      installType: InstallType.rpm,
      packageName: 'cliptoo',
      createdAt: new Date('2026-01-01T00:00:00Z')
    })

    await service.uninstallPackage(app)

    expect(recorded).toEqual([['pkexec', HELPER, 'rpm-remove', 'cliptoo']])
  })

  it('uninstalls a tracked deb package through the exact privileged helper argv', async () => {
    const pkg = new TrackedDebPackage({
      name: 'cliptoo',
      packageUrl: 'https://example.test/cliptoo.deb',
      packageName: 'cliptoo',
      createdAt: new Date('2026-01-01T00:00:00Z')
    })

    await service.uninstallDebPackage(pkg)

    expect(recorded).toEqual([['pkexec', HELPER, 'dpkg-remove', 'cliptoo']])
  })

  it('refuses a flatpak uninstall with no stored application id, without running any process', async () => {
    const app = new TrackedApp({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Repo',
      installType: InstallType.flatpak,
      createdAt: new Date('2026-01-01T00:00:00Z')
    })

    await expect(service.uninstallPackage(app)).rejects.toThrow('no application ID is stored')
    expect(recorded).toEqual([])
  })

  it('fails with a clear error and runs nothing when the privileged helper is absent', async () => {
    const bare = new InstallerService({
      appSupportDirectory: async () => appData,
      helperInstalled: async () => false
    })
    const calls: string[][] = []
    bare.privilegedProcessRunner = async (executable, args) => {
      calls.push([executable, ...args])
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    const app = new TrackedApp({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'Repo',
      installType: InstallType.deb,
      packageName: 'cliptoo',
      createdAt: new Date('2026-01-01T00:00:00Z')
    })

    // No silent fallback to a generic root command; the error names the helper.
    await expect(bare.uninstallPackage(app)).rejects.toThrow('Privileged helper not found')
    expect(calls).toEqual([])
  })

  it('creates the downloads directory with mode 0700 so other users cannot tamper with it', async () => {
    service.httpClientFactory = () => ({
      send: async () => ({
        statusCode: 200,
        headers: {},
        contentLength: 5,
        isRedirect: false,
        stream: Readable.from([Buffer.from('hello')]) as AsyncIterable<Uint8Array>
      })
    })

    const file = await service.downloadFile('https://example.test/app.deb', 'app.deb')

    const dirStat = await stat(dirname(file))
    expect(dirStat.mode & 0o777).toBe(0o700)
  })

  it('refuses to install a downloaded deb that changed on disk after download (TOCTOU)', async () => {
    service.httpClientFactory = () => ({
      send: async () => ({
        statusCode: 200,
        headers: {},
        contentLength: 5,
        isRedirect: false,
        stream: Readable.from([Buffer.from('hello')]) as AsyncIterable<Uint8Array>
      })
    })
    const file = await service.downloadFile('https://example.test/app.deb', 'app_1.0.0_amd64.deb')

    // Same length, different bytes: only the recorded SHA-256 can catch this.
    await writeFile(file, 'evil!')

    await expect(service.installPackage(file, InstallType.deb)).rejects.toThrow('checksum re-check')
    // The tampered file must never reach a privileged command.
    expect(recorded).toEqual([])
  })

  it('refuses to install a downloaded deb whose size changed after download (TOCTOU)', async () => {
    service.httpClientFactory = () => ({
      send: async () => ({
        statusCode: 200,
        headers: {},
        contentLength: 5,
        isRedirect: false,
        stream: Readable.from([Buffer.from('hello')]) as AsyncIterable<Uint8Array>
      })
    })
    const file = await service.downloadFile('https://example.test/app.deb', 'app_1.0.0_amd64.deb')

    await writeFile(file, 'a much longer tampered payload')

    await expect(service.installPackage(file, InstallType.deb)).rejects.toThrow(
      'changed size after download'
    )
    expect(recorded).toEqual([])
  })
})

describe('InstallerService.chooseLaunchCommand', () => {
  it('prefers the desktop entry when a package ships several binaries', () => {
    const files = [
      '/usr/bin/fluxdown-agent',
      '/usr/bin/fluxdown-desktop',
      '/usr/share/applications/com.fluxdown.app.desktop'
    ]
    expect(
      InstallerService.chooseLaunchCommand(
        files,
        new Map([['/usr/share/applications/com.fluxdown.app.desktop', 'fluxdown-desktop %U']])
      )
    ).toBe('/usr/bin/fluxdown-desktop')
  })

  it('uses the only binary when the package name is not the executable', () => {
    expect(
      InstallerService.chooseLaunchCommand(
        ['/usr/bin/mq', '/usr/share/doc/mq-run/README.md'],
        new Map()
      )
    ).toBe('/usr/bin/mq')
  })

  it('refuses to guess between several binaries', () => {
    expect(
      InstallerService.chooseLaunchCommand(['/usr/bin/agent', '/usr/bin/desktop'], new Map())
    ).toBeNull()
  })

  it('ignores a desktop entry that names no shipped binary', () => {
    expect(
      InstallerService.chooseLaunchCommand(
        ['/usr/bin/agent', '/usr/bin/desktop', '/usr/share/applications/x.desktop'],
        new Map([['/usr/share/applications/x.desktop', 'not-shipped %U']])
      )
    ).toBeNull()
  })

  it('does not treat a bare bin directory as a binary', () => {
    expect(
      InstallerService.chooseLaunchCommand(['/usr/bin/', '/usr/share/doc/x/README'], new Map())
    ).toBeNull()
  })
})

describe('InstallerService deb launch command', () => {
  let service: InstallerService
  let tmp: string
  let appData: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'autonex-launch-test-'))
    appData = join(tmp, 'appdata')
    await mkdir(appData)
    service = new InstallerService({
      appSupportDirectory: async () => appData,
      helperInstalled: async () => true
    })
    service.privilegedProcessRunner = async () => ({ exitCode: 0, stdout: '', stderr: '' })
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  async function makeDeb(): Promise<string> {
    const downloads = join(tmp, 'downloads')
    await mkdir(downloads, { recursive: true })
    const deb = join(downloads, 'mq-x86_64-unknown-linux-gnu.deb')
    await writeFile(deb, 'not-really-a-deb')
    return deb
  }

  it('stores the launch command the installed package provides', async () => {
    service.packageLaunchCommandResolver = async () => '/usr/bin/mq'

    const result = await service.installPackage(await makeDeb(), InstallType.deb)

    expect(result.launchCommand).toBe('/usr/bin/mq')
  }, 20_000)

  it('leaves the launch command unset when the package name is unreadable', async () => {
    const result = await service.installPackage(await makeDeb(), InstallType.deb)

    expect(result.launchCommand).toBeNull()
  }, 20_000)
})

describe('InstallerService detached launch', () => {
  let tmp: string
  let appData: string
  let calls: Array<{ executable: string; args: string[]; options: { detached: boolean } }>
  let unref: () => void
  let stdoutOn: ReturnType<typeof vi.fn>
  let stderrOn: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'autonex-detach-test-'))
    appData = join(tmp, 'appdata')
    await mkdir(appData)
    calls = []
    unref = vi.fn<() => void>()
    stdoutOn = vi.fn()
    stderrOn = vi.fn()
  })

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  function buildService(): InstallerService {
    const spawnDetached: DetachedSpawner = (executable, args, options) => {
      calls.push({ executable, args: [...args], options })
      const stream = { on: stdoutOn } as unknown as NodeJS.ReadableStream
      const errStream = { on: stderrOn } as unknown as NodeJS.ReadableStream
      const child: DetachedProcess = { stdout: stream, stderr: errStream, unref }
      return child
    }
    return new InstallerService({ appSupportDirectory: async () => appData, spawnDetached })
  }

  function appWith(launchCommand: string): TrackedApp {
    return new TrackedApp({
      repoOwner: 'owner',
      repoName: 'mytool',
      displayName: 'My Tool',
      launchCommand,
      createdAt: new Date('2026-01-01T00:00:00Z')
    })
  }

  it('launches an existing path with spaces verbatim, detached, and drains both streams', async () => {
    const service = buildService()
    const spaced = join(tmp, 'My Tool')
    await writeFile(spaced, '#!/bin/sh\n')
    await chmod(spaced, 0o755)

    await service.launchApp(appWith(spaced))

    expect(calls).toHaveLength(1)
    expect(calls[0].executable).toBe(spaced)
    expect(calls[0].args).toEqual([])
    expect(calls[0].options.detached).toBe(true)
    // Both streams are drained and the child is detached from the parent.
    expect(stdoutOn).toHaveBeenCalled()
    expect(stderrOn).toHaveBeenCalled()
    expect(unref).toHaveBeenCalled()
  })

  it('splits a command with arguments when it is not a path to an existing file', async () => {
    const service = buildService()

    await service.launchApp(appWith('code --no-sandbox'))

    expect(calls[0].executable).toBe('code')
    expect(calls[0].args).toEqual(['--no-sandbox'])
  })

  it('refuses to launch an empty command', async () => {
    const service = buildService()

    await expect(service.launchApp(appWith('   '))).rejects.toThrow(
      'Cannot launch: empty launch command'
    )
    expect(calls).toEqual([])
  })
})
