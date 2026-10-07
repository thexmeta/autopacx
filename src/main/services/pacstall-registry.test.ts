// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HttpClient, HttpRequestInit, HttpResponse } from './http'
import { PacstallRegistry, REGISTRY_INDEX_CACHE_FILE, parseNameList } from './pacstall-registry'

/** A stub transport that records calls and answers through `handler`. */
function stubHttp(handler: (url: string, init?: HttpRequestInit) => Promise<HttpResponse>) {
  const request = vi.fn<(url: string, init?: HttpRequestInit) => Promise<HttpResponse>>(handler)
  const client: HttpClient = { request }
  return { request, client }
}

function response(
  status: number,
  body: string,
  headers: Record<string, string> = {}
): HttpResponse {
  return { status, headers, body, url: 'https://raw.githubusercontent.com/x/y/master/z' }
}

const PACKAGELIST_URL =
  'https://raw.githubusercontent.com/pacstall/pacstall-programs/master/packagelist'
const SRCLIST_URL = 'https://raw.githubusercontent.com/pacstall/pacstall-programs/master/srclist'
const SRCINFO_URL =
  'https://raw.githubusercontent.com/pacstall/pacstall-programs/master/packages/neovim/.SRCINFO'

const SAMPLE_SRCINFO = `pkgname = neovim
pkgver = 0.10.0
pkgdesc = Vim-fork focused on extensibility and usability
maintainer = Test <t@example.com>
arch = amd64
`

describe('PacstallRegistry', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'autopacx-registry-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function makeRegistry(
    client: HttpClient,
    settings: Record<string, unknown> = {}
  ): PacstallRegistry {
    return new PacstallRegistry({
      httpClient: client,
      appSupportDirectory: async () => dir,
      getSettings: async () => settings
    })
  }

  describe('fetchIndex', () => {
    it('parses names, writes the cache, and serves the second call from cache', async () => {
      const { request, client } = stubHttp(async () =>
        response(200, 'alpha\nbeta\n\n# a comment\n', { etag: '"v1"' })
      )
      const registry = makeRegistry(client, { pacstall_index_ttl_hours: 24 })

      const first = await registry.fetchIndex()
      expect(first.fromCache).toBe(false)
      expect(first.names).toEqual(['alpha', 'beta'])
      expect(request).toHaveBeenCalledTimes(1)
      expect(request.mock.calls[0][0]).toBe(PACKAGELIST_URL)

      const second = await registry.fetchIndex()
      expect(second.fromCache).toBe(true)
      expect(second.names).toEqual(['alpha', 'beta'])
      // The fresh cache avoided a second request.
      expect(request).toHaveBeenCalledTimes(1)

      const cached = JSON.parse(
        await readFile(join(dir, REGISTRY_INDEX_CACHE_FILE), 'utf8')
      ) as Record<string, unknown>
      expect(cached['names']).toEqual(['alpha', 'beta'])
      expect(cached['etag']).toBe('"v1"')
    })

    it('bypasses a fresh cache when force is set', async () => {
      const { request, client } = stubHttp(async () => response(200, 'alpha\n'))
      const registry = makeRegistry(client)

      await registry.fetchIndex()
      await registry.fetchIndex({ force: true })

      expect(request).toHaveBeenCalledTimes(2)
    })

    it('revalidates with If-None-Match and refreshes fetchedAt on 304', async () => {
      const request = vi
        .fn<(url: string, init?: HttpRequestInit) => Promise<HttpResponse>>()
        .mockResolvedValueOnce(response(200, 'alpha\n', { etag: '"v1"' }))
        .mockResolvedValueOnce(response(304, ''))
      const registry = makeRegistry({ request })

      const first = await registry.fetchIndex()
      const second = await registry.fetchIndex({ force: true })

      expect(second.fromCache).toBe(true)
      expect(second.names).toEqual(['alpha'])
      expect(second.fetchedAt >= first.fetchedAt).toBe(true)
      expect(request.mock.calls[1][1]?.headers?.['If-None-Match']).toBe('"v1"')
    })

    it('refetches when the cache TTL has elapsed', async () => {
      const { request, client } = stubHttp(async () => response(200, 'alpha\n'))
      const registry = makeRegistry(client, { pacstall_index_ttl_hours: 0 })

      await registry.fetchIndex()
      await registry.fetchIndex()

      expect(request).toHaveBeenCalledTimes(2)
    })

    it('throws on an unexpected status', async () => {
      const { client } = stubHttp(async () => response(500, 'boom'))
      const registry = makeRegistry(client)

      await expect(registry.fetchIndex()).rejects.toThrow(
        'Failed to fetch pacstall registry index: 500'
      )
    })
  })

  describe('fetchSrcList', () => {
    it('returns the raw srclist content and caches it', async () => {
      const { request, client } = stubHttp(async () => response(200, 'pkgbase = neovim\n'))
      const registry = makeRegistry(client)

      const first = await registry.fetchSrcList()
      expect(first.content).toBe('pkgbase = neovim\n')
      expect(first.fromCache).toBe(false)

      const second = await registry.fetchSrcList()
      expect(second.fromCache).toBe(true)
      expect(request).toHaveBeenCalledTimes(1)
      expect(request.mock.calls[0][0]).toBe(SRCLIST_URL)
    })
  })

  describe('fetchPackageInfo', () => {
    it('parses the .SRCINFO and serves the second call from the in-memory cache', async () => {
      const { request, client } = stubHttp(async () => response(200, SAMPLE_SRCINFO))
      const registry = makeRegistry(client)

      const info = await registry.fetchPackageInfo('neovim')
      expect(info.pkgname).toBe('neovim')
      expect(info.pkgver).toBe('0.10.0')
      expect(request.mock.calls[0][0]).toBe(SRCINFO_URL)

      await registry.fetchPackageInfo('neovim')
      expect(request).toHaveBeenCalledTimes(1)
    })

    it('rejects an invalid package name before any request', async () => {
      const { request, client } = stubHttp(async () => response(200, SAMPLE_SRCINFO))
      const registry = makeRegistry(client)

      await expect(registry.fetchPackageInfo('../etc/passwd')).rejects.toThrow(
        'Invalid pacstall package name'
      )
      expect(request).not.toHaveBeenCalled()
    })

    it('throws on a non-200 response', async () => {
      const { client } = stubHttp(async () => response(404, 'Not Found'))
      const registry = makeRegistry(client)

      await expect(registry.fetchPackageInfo('neovim')).rejects.toThrow(
        'Failed to fetch pacstall package info for neovim: 404'
      )
    })
  })

  it('parses a newline list, dropping blanks and comments', () => {
    expect(parseNameList('a\n\n b \n#c\n')).toEqual(['a', 'b'])
  })

  describe('registry configuration', () => {
    it('uses the configured registry repo and branch from settings', async () => {
      const { request, client } = stubHttp(async () => response(200, 'alpha\n'))
      const registry = makeRegistry(client, {
        pacstall_registry_repo: 'me/mirror',
        pacstall_registry_branch: 'dev'
      })

      await registry.fetchIndex()

      expect(request.mock.calls[0][0]).toBe(
        'https://raw.githubusercontent.com/me/mirror/dev/packagelist'
      )
    })

    it('reflects a mirror change from settings without reconstruction', async () => {
      let settings: Record<string, unknown> = {
        pacstall_registry_repo: 'a/one',
        pacstall_registry_branch: 'main',
        pacstall_index_ttl_hours: 0
      }
      const { request, client } = stubHttp(async () => response(200, 'alpha\n'))
      const registry = new PacstallRegistry({
        httpClient: client,
        appSupportDirectory: async () => dir,
        getSettings: async () => settings
      })

      await registry.fetchIndex()
      settings = { ...settings, pacstall_registry_repo: 'b/two' }
      await registry.fetchIndex()

      expect(request.mock.calls[0][0]).toContain('/a/one/main/packagelist')
      expect(request.mock.calls[1][0]).toContain('/b/two/main/packagelist')
    })

    it('falls back to the constructor repo/branch when settings omit them', async () => {
      const { request, client } = stubHttp(async () => response(200, 'alpha\n'))
      const registry = new PacstallRegistry({
        httpClient: client,
        appSupportDirectory: async () => dir,
        registryRepo: 'fallback/repo',
        registryBranch: 'stable',
        getSettings: async () => ({})
      })

      await registry.fetchIndex()

      expect(request.mock.calls[0][0]).toBe(
        'https://raw.githubusercontent.com/fallback/repo/stable/packagelist'
      )
    })
  })
})
