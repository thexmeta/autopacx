// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSrcInfo } from '@core/index'
import type { PacstallPackageInfo } from '@core/index'
import { TrackedPacstallPackage } from '@core/models/tracked-pacstall-package'
import { AUTOPACX_HELPER_PATH } from './privileged-helper'
import type { ProcessResult, ProcessRunner } from './process-runner'
import type { PacstallRegistryLike } from './pacstall-registry'
import { PacstallService } from './pacstall-service'

function trackedPackage(
  overrides: Partial<ConstructorParameters<typeof TrackedPacstallPackage>[0]> = {}
): TrackedPacstallPackage {
  return new TrackedPacstallPackage({
    id: 1,
    name: 'neovim',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    registryRepo: 'pacstall/pacstall-programs',
    ...overrides
  })
}

function registryReturning(info: PacstallPackageInfo): PacstallRegistryLike {
  return { fetchPackageInfo: vi.fn(async () => info) }
}

function info(pkgver: string): PacstallPackageInfo {
  return parseSrcInfo(`pkgname = neovim\npkgver = ${pkgver}\n`)
}

function ok(stdout = ''): ProcessResult {
  return { exitCode: 0, stdout, stderr: '' }
}

describe('PacstallService', () => {
  let dir: string
  let metadataDirectory: string
  let recorded: string[][]

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'autopacx-pacstall-'))
    metadataDirectory = join(dir, 'metadata')
    await mkdir(metadataDirectory, { recursive: true })
    recorded = []
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function makeService(
    options: {
      runProcess?: ProcessRunner
      helperInstalled?: () => Promise<boolean>
      registry?: PacstallRegistryLike
      pacstallPath?: string
    } = {}
  ): PacstallService {
    return new PacstallService({
      privilegedProcessRunner: async (executable, args) => {
        recorded.push([executable, ...args])
        return ok()
      },
      helperInstalled: options.helperInstalled ?? (async () => true),
      runProcess:
        options.runProcess ??
        (async (executable: string) =>
          executable === 'which' ? { exitCode: 1, stdout: '', stderr: '' } : ok()),
      registry: options.registry,
      metadataDirectory,
      pacstallPath: options.pacstallPath,
      debugLog: () => {}
    })
  }

  describe('status', () => {
    it('reports not-installed when which finds nothing', async () => {
      // A controlled, non-existent binary path keeps the assertion independent
      // of whether pacstall happens to be installed on the host.
      const service = makeService({ pacstallPath: join(dir, 'pacstall-not-installed') })

      const status = await service.status()

      expect(status).toEqual({
        installed: false,
        version: null,
        path: null,
        pathUnexpected: false
      })
    })

    it('flags pathUnexpected when which resolves a different binary', async () => {
      const runProcess = vi.fn(async (executable: string) =>
        executable === 'which'
          ? ok('/usr/local/bin/pacstall\n')
          : ok('\u001b[1m6.2.0\u001b[0m Pacstall')
      )
      const service = makeService({
        runProcess,
        pacstallPath: join(dir, 'pacstall-not-installed')
      })

      const status = await service.status()

      expect(status.path).toBe('/usr/local/bin/pacstall')
      expect(status.pathUnexpected).toBe(true)
      // The controlled path does not exist, so it is not "installed" through it.
      expect(status.installed).toBe(false)
    })

    it('reports installed and the version when the hardcoded binary exists', async () => {
      const pacstallPath = join(dir, 'pacstall')
      await writeFile(pacstallPath, '#!/bin/sh\n')
      const runProcess = vi.fn(async (executable: string) =>
        executable === 'which' ? ok(`${pacstallPath}\n`) : ok('\u001b[1m6.2.0\u001b[0m Pacstall')
      )
      const service = makeService({ runProcess, pacstallPath })

      const status = await service.status()

      expect(status.installed).toBe(true)
      expect(status.path).toBe(pacstallPath)
      expect(status.pathUnexpected).toBe(false)
      expect(status.version).toBe('6.2.0')
    })
  })

  describe('privileged lifecycle', () => {
    it('invokes the pacstall helper verbs with argv arrays', async () => {
      const service = makeService()

      await service.install('neovim')
      await service.remove('neovim')
      await service.upgrade('neovim')
      await service.upgradeAll()

      expect(recorded).toEqual([
        ['pkexec', AUTOPACX_HELPER_PATH, 'pacstall-install', 'neovim'],
        ['pkexec', AUTOPACX_HELPER_PATH, 'pacstall-remove', 'neovim'],
        ['pkexec', AUTOPACX_HELPER_PATH, 'pacstall-upgrade', 'neovim'],
        ['pkexec', AUTOPACX_HELPER_PATH, 'pacstall-upgrade-all']
      ])
    })

    it('rejects an invalid package name before any privileged call', async () => {
      const service = makeService()

      await expect(service.install('../evil')).rejects.toThrow(/Invalid pacstall package name/)
      expect(recorded).toEqual([])
    })

    it('fails clearly when the helper is not installed', async () => {
      const service = makeService({ helperInstalled: async () => false })

      await expect(service.install('neovim')).rejects.toThrow(/Privileged helper not found/)
      expect(recorded).toEqual([])
    })

    it('surfaces a non-zero helper exit code', async () => {
      const service = new PacstallService({
        privilegedProcessRunner: async () => ({
          exitCode: 1,
          stdout: 'boom',
          stderr: 'E: failed'
        }),
        helperInstalled: async () => true,
        metadataDirectory,
        debugLog: () => {}
      })

      await expect(service.install('neovim')).rejects.toThrow(/Command failed \(exit code 1\)/)
    })
  })

  describe('readInstalledVersion', () => {
    it('reads the _version field from the metadata file', async () => {
      await writeFile(
        join(metadataDirectory, 'neovim'),
        '_name="neovim"\n_version="0.10.0-pacstall1"\n_date="now"\n'
      )
      const service = makeService()

      expect(await service.readInstalledVersion('neovim')).toBe('0.10.0-pacstall1')
    })

    it('returns "unknown" when the metadata file is missing', async () => {
      const service = makeService()

      expect(await service.readInstalledVersion('missing')).toBe('unknown')
    })

    it('tolerates a directory layout holding a version file', async () => {
      await mkdir(join(metadataDirectory, 'neovim'))
      await writeFile(join(metadataDirectory, 'neovim', 'version'), '0.9.5\n')
      const service = makeService()

      expect(await service.readInstalledVersion('neovim')).toBe('0.9.5')
    })

    it('rejects an invalid name without touching the filesystem', async () => {
      const service = makeService()
      expect(await service.readInstalledVersion('a/b')).toBe('unknown')
    })
  })

  describe('checkUpdate', () => {
    it('returns the registry version when it is newer than the installed one', async () => {
      await writeFile(join(metadataDirectory, 'neovim'), '_version="0.10.0"\n')
      const service = makeService({ registry: registryReturning(info('0.11.0')) })

      expect(await service.checkUpdate(trackedPackage())).toBe('0.11.0')
    })

    it('returns null when the versions are equal', async () => {
      await writeFile(join(metadataDirectory, 'neovim'), '_version="0.11.0"\n')
      const service = makeService({ registry: registryReturning(info('0.11.0')) })

      expect(await service.checkUpdate(trackedPackage())).toBeNull()
    })

    it('falls back to the stored installed version when metadata is unreadable', async () => {
      const service = makeService({ registry: registryReturning(info('0.12.0')) })

      expect(await service.checkUpdate(trackedPackage({ installedVersion: '0.11.0' }))).toBe(
        '0.12.0'
      )
    })

    it('returns null when no installed version is known', async () => {
      const service = makeService({ registry: registryReturning(info('0.12.0')) })

      expect(await service.checkUpdate(trackedPackage())).toBeNull()
    })
  })
})
