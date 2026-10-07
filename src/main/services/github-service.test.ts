// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { describe, expect, it, vi } from 'vitest'
import { InstallType } from '@core/models/install-type'
import { Release, ReleaseAsset, parseReleases } from '@core/models/release'
import { GitHubRateLimitError, GitHubService } from './github-service'
import type { HttpClient, HttpRequestInit, HttpResponse } from './http'

/**
 * Ported from `test/services/github_service_filter_test.dart` (12 tests).
 *
 * The two `getLatestRelease` cases in the Dart file exercise a `MockGitHubService`;
 * here the *real* service is driven through a stubbed HTTP transport so the
 * filtering/selection logic under test is the production one.
 */

function createAsset(
  name: string,
  contentType = 'application/octet-stream',
  size = 1000
): ReleaseAsset {
  return new ReleaseAsset({
    name,
    browserDownloadUrl: `https://example.com/${name}`,
    contentType,
    size
  })
}

function createRelease({
  tagName = 'v1.0.0',
  assets = [] as ReleaseAsset[],
  prerelease = false
} = {}): Release {
  return new Release({
    tagName,
    name: 'Test Release',
    body: null,
    publishedAt: new Date(),
    prerelease,
    draft: false,
    assets
  })
}

/** A stub transport that records calls and always answers with `response`. */
function stubHttp(handler: (url: string, init?: HttpRequestInit) => Promise<HttpResponse>) {
  const request = vi.fn<(url: string, init?: HttpRequestInit) => Promise<HttpResponse>>(handler)
  const client: HttpClient = { request }
  return { request, client }
}

function jsonResponse(payload: unknown): HttpResponse {
  return {
    status: 200,
    headers: {},
    body: JSON.stringify(payload),
    url: 'https://api.github.com/repos/o/r/releases'
  }
}

function assetJson(name: string): Record<string, unknown> {
  return {
    name,
    browser_download_url: `https://example.com/${name}`,
    content_type: 'application/octet-stream',
    size: 0
  }
}

function releaseJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tag_name: 'v1.0.0',
    name: 'Test Release',
    body: null,
    published_at: null,
    prerelease: false,
    draft: false,
    assets: [],
    ...overrides
  }
}

/** A service whose transport is never expected to be called. */
function serviceWithoutHttp(): GitHubService {
  return new GitHubService({
    httpClient: stubHttp(async () => {
      throw new Error('HTTP must not be called by this test')
    }).client
  })
}

describe('GitHubService filterAssets', () => {
  it('returns all assets when no filters', () => {
    const release = createRelease({
      assets: [
        createAsset('app-amd64.deb'),
        createAsset('app-arm64.deb'),
        createAsset('app.tar.gz')
      ]
    })

    expect(serviceWithoutHttp().filterAssets(release)).toHaveLength(3)
  })

  it('filters by asset pattern', () => {
    const release = createRelease({
      assets: [
        createAsset('app-amd64.deb'),
        createAsset('app-arm64.deb'),
        createAsset('app.tar.gz')
      ]
    })

    const result = serviceWithoutHttp().filterAssets(release, { assetFilterPattern: '*.deb' })

    expect(result).toHaveLength(2)
    expect(result.every((asset) => asset.name.endsWith('.deb'))).toBe(true)
  })

  it('filters by architecture', () => {
    const release = createRelease({
      assets: [
        createAsset('app-amd64.deb'),
        createAsset('app-arm64.deb'),
        createAsset('app-armhf.deb')
      ]
    })

    const result = serviceWithoutHttp().filterAssets(release, { architectures: ['amd64'] })

    expect(result).toHaveLength(1)
    expect(result[0].name).toContain('amd64')
  })

  it('filters by multiple architectures', () => {
    const release = createRelease({
      assets: [
        createAsset('app-amd64.deb'),
        createAsset('app-arm64.deb'),
        createAsset('app-armhf.deb')
      ]
    })

    const result = serviceWithoutHttp().filterAssets(release, {
      architectures: ['amd64', 'arm64']
    })

    expect(result).toHaveLength(2)
  })

  it('filters by both pattern and architecture', () => {
    const release = createRelease({
      assets: [
        createAsset('app-amd64.deb'),
        createAsset('app-amd64.tar.gz'),
        createAsset('app-arm64.deb')
      ]
    })

    const result = serviceWithoutHttp().filterAssets(release, {
      assetFilterPattern: '*.deb',
      architectures: ['amd64']
    })

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('app-amd64.deb')
  })

  it('returns empty list when no matches', () => {
    const release = createRelease({
      assets: [createAsset('app-amd64.deb'), createAsset('app-arm64.deb')]
    })

    const result = serviceWithoutHttp().filterAssets(release, { assetFilterPattern: '*.rpm' })

    expect(result).toEqual([])
  })

  it('handles cross-architecture detection', () => {
    const release = createRelease({
      assets: [
        createAsset('app-x86_64.deb'),
        createAsset('app-x64.deb'),
        createAsset('app-64-bit.deb')
      ]
    })

    const result = serviceWithoutHttp().filterAssets(release, { architectures: ['amd64'] })

    expect(result).toHaveLength(3)
  })

  it('handles empty asset list', () => {
    const release = createRelease({ assets: [] })

    expect(serviceWithoutHttp().filterAssets(release)).toEqual([])
  })
})

describe('GitHubService getLatestRelease with filters', () => {
  it('filters releases by tag prefix', async () => {
    const { client } = stubHttp(async () =>
      jsonResponse([
        releaseJson({ tag_name: 'v1.0.0', assets: [assetJson('a.deb')] }),
        releaseJson({ tag_name: 'app-2.0.0', assets: [assetJson('b.deb')] })
      ])
    )
    const service = new GitHubService({ httpClient: client })

    // Match 'app' prefix.
    expect((await service.getLatestRelease('o', 'r', { tagPrefix: 'app' }))?.tagName).toBe(
      'app-2.0.0'
    )

    // Match 'v' prefix.
    expect((await service.getLatestRelease('o', 'r', { tagPrefix: 'v' }))?.tagName).toBe('v1.0.0')

    // Case-insensitive match.
    expect((await service.getLatestRelease('o', 'r', { tagPrefix: 'APP' }))?.tagName).toBe(
      'app-2.0.0'
    )
  })

  it('handles prerelease filtering', async () => {
    const { client } = stubHttp(async () =>
      jsonResponse([
        releaseJson({
          tag_name: 'v2.0.0-beta',
          prerelease: true,
          assets: [assetJson('a.deb')]
        }),
        releaseJson({ tag_name: 'v1.0.0', prerelease: false, assets: [assetJson('b.deb')] })
      ])
    )
    const service = new GitHubService({ httpClient: client })

    // Excludes prereleases by default.
    expect((await service.getLatestRelease('o', 'r', { includePrerelease: false }))?.tagName).toBe(
      'v1.0.0'
    )

    // Includes them when requested.
    expect((await service.getLatestRelease('o', 'r', { includePrerelease: true }))?.tagName).toBe(
      'v2.0.0-beta'
    )
  })
})

describe('GitHubService parseReleases', () => {
  it('skips non-object and wrong-typed entries but keeps valid ones', () => {
    const body = JSON.stringify([
      {
        tag_name: 'v1.0.0',
        name: 'Good Release',
        prerelease: false,
        draft: false,
        assets: []
      },
      'not-an-object',
      null,
      {
        // Wrong type: tag_name must be a String, not a number.
        tag_name: 12345,
        prerelease: false,
        draft: false,
        assets: []
      }
    ])

    const releases = parseReleases(body)

    expect(releases).toHaveLength(1)
    expect(releases[0].tagName).toBe('v1.0.0')
  })

  it('still throws when the response body is not a JSON list', () => {
    expect(() => parseReleases('<html>GitHub error</html>')).toThrow()
  })
})

describe('GitHubService request construction', () => {
  it('sends a descriptive User-Agent and the GitHub API headers', async () => {
    const { request, client } = stubHttp(async () => jsonResponse([]))
    const service = new GitHubService({ httpClient: client })

    await service.getReleases('owner', 'repo', { perPage: 42 })

    const [url, init] = request.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/owner/repo/releases?per_page=42')
    expect(init?.headers?.['User-Agent']).toMatch(/^autonex\/\d+\.\d+\.\d+ \(/)
    expect(init?.headers?.['Accept']).toBe('application/vnd.github+json')
    expect(init?.headers?.['X-GitHub-Api-Version']).toBe('2022-11-28')
    expect(init?.headers?.['Authorization']).toBeUndefined()
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('adds a bearer token when settings provide one', async () => {
    const { request, client } = stubHttp(async () => jsonResponse([]))
    const service = new GitHubService({
      httpClient: client,
      getSettings: async () => ({ github_token: 'secret-token' })
    })

    await service.getReleases('owner', 'repo')

    const [, init] = request.mock.calls[0]
    expect(init?.headers?.['Authorization']).toBe('Bearer secret-token')
  })

  it('uses github_releases_per_page from settings when perPage is omitted', async () => {
    const { request, client } = stubHttp(async () => jsonResponse([]))
    const service = new GitHubService({
      httpClient: client,
      getSettings: async () => ({ github_releases_per_page: '50' })
    })

    await service.getReleases('owner', 'repo')

    expect(request.mock.calls[0][0]).toContain('per_page=50')
  })
})

describe('GitHubService getRepository', () => {
  it('returns the decoded repository object from a 200 response', async () => {
    const { request, client } = stubHttp(async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ full_name: 'o/r', stargazers_count: 5 }),
      url: 'https://api.github.com/repos/o/r'
    }))
    const service = new GitHubService({ httpClient: client })

    const repo = await service.getRepository('o', 'r')

    expect(repo['full_name']).toBe('o/r')
    expect(repo['stargazers_count']).toBe(5)
    expect(request.mock.calls[0][0]).toBe('https://api.github.com/repos/o/r')
  })

  it('throws a load failure on a non-200 status', async () => {
    const { client } = stubHttp(async () => ({
      status: 404,
      headers: {},
      body: 'Not Found',
      url: 'https://api.github.com/repos/o/r'
    }))

    await expect(new GitHubService({ httpClient: client }).getRepository('o', 'r')).rejects.toThrow(
      'Failed to load repository: 404'
    )
  })

  it('reports a malformed-response error when the body is not a JSON object', async () => {
    const { client } = stubHttp(async () => ({
      status: 200,
      headers: {},
      body: '[1,2,3]',
      url: 'https://api.github.com/repos/o/r'
    }))

    await expect(new GitHubService({ httpClient: client }).getRepository('o', 'r')).rejects.toThrow(
      'malformed response'
    )
  })
})

describe('GitHubService getLatestReleaseWithPackageInfo', () => {
  it('returns null when no release matches', async () => {
    const { client } = stubHttp(async () => jsonResponse([]))
    const service = new GitHubService({ httpClient: client })

    expect(await service.getLatestReleaseWithPackageInfo('o', 'r')).toBeNull()
  })

  it('selects the architecture-matching asset and exposes its name, url and release date', async () => {
    const { client } = stubHttp(async () =>
      jsonResponse([
        releaseJson({
          tag_name: 'v1.0.0',
          published_at: '2026-01-02T03:04:05Z',
          assets: [assetJson('app-amd64.deb'), assetJson('app-arm64.deb')]
        })
      ])
    )
    const service = new GitHubService({ httpClient: client })

    const info = await service.getLatestReleaseWithPackageInfo('o', 'r', {
      architectures: ['arm64']
    })

    expect(info?.packageName).toBe('app-arm64.deb')
    expect(info?.downloadUrl).toBe('https://example.com/app-arm64.deb')
    expect(info?.release.tagName).toBe('v1.0.0')
    expect(info?.releaseDate).toBe('2026-01-02T03:04:05.000Z')
  })

  it('falls back to the first asset when no architecture filter is set', async () => {
    const { client } = stubHttp(async () =>
      jsonResponse([
        releaseJson({
          tag_name: 'v1.0.0',
          assets: [assetJson('first.deb'), assetJson('second.deb')]
        })
      ])
    )
    const service = new GitHubService({ httpClient: client })

    const info = await service.getLatestReleaseWithPackageInfo('o', 'r')

    expect(info?.packageName).toBe('first.deb')
  })

  it('returns null when no asset matches the requested architecture', async () => {
    const { client } = stubHttp(async () =>
      jsonResponse([releaseJson({ tag_name: 'v1.0.0', assets: [assetJson('app-riscv64.deb')] })])
    )
    const service = new GitHubService({ httpClient: client })

    const info = await service.getLatestReleaseWithPackageInfo('o', 'r', {
      architectures: ['arm64']
    })

    // getLatestRelease already narrows assets by architecture, so a release with
    // no matching asset yields no result rather than a fallback.
    expect(info).toBeNull()
  })
})

describe('GitHubService.searchRepositories', () => {
  function searchResponse(payload: unknown, headers: Record<string, string> = {}): HttpResponse {
    return {
      status: 200,
      headers,
      body: JSON.stringify(payload),
      url: 'https://api.github.com/search/repositories'
    }
  }

  it('sends the Authorization Bearer token from settings when configured', async () => {
    const { request, client } = stubHttp(async () => searchResponse({ total_count: 0, items: [] }))
    const service = new GitHubService({
      httpClient: client,
      getSettings: async () => ({ github_token: 'secret-token' })
    })

    await service.searchRepositories('pacstall')

    const [url, init] = request.mock.calls[0]
    expect(url).toContain('https://api.github.com/search/repositories?q=pacstall')
    expect(init?.headers?.['Authorization']).toBe('Bearer secret-token')
    expect(init?.headers?.['Accept']).toBe('application/vnd.github+json')
    expect(init?.headers?.['X-GitHub-Api-Version']).toBe('2022-11-28')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('omits the Authorization header when no token is configured', async () => {
    const { request, client } = stubHttp(async () => searchResponse({ total_count: 0, items: [] }))
    const service = new GitHubService({ httpClient: client, getSettings: async () => ({}) })

    await service.searchRepositories('pacstall')

    const [, init] = request.mock.calls[0]
    expect(init?.headers?.['Authorization']).toBeUndefined()
  })

  it('encodes the query and appends sort/order/per_page/page parameters', async () => {
    const { request, client } = stubHttp(async () => searchResponse({ total_count: 0, items: [] }))
    const service = new GitHubService({ httpClient: client })

    await service.searchRepositories('hello world', {
      sort: 'stars',
      order: 'desc',
      perPage: 25,
      page: 3
    })

    const [url] = request.mock.calls[0]
    expect(url).toBe(
      'https://api.github.com/search/repositories?q=hello%20world' +
        '&sort=stars&order=desc&per_page=25&page=3'
    )
  })

  it('parses the search result through parseRepoSearch', async () => {
    const { client } = stubHttp(async () =>
      searchResponse({
        total_count: 1,
        incomplete_results: false,
        items: [
          {
            full_name: 'pacstall/pacstall',
            description: 'An AUR-inspired package manager',
            stargazers_count: 1200,
            language: 'Shell',
            license: { spdx_id: 'GPL-3.0', name: 'GNU General Public License v3.0' },
            default_branch: 'develop',
            html_url: 'https://github.com/pacstall/pacstall',
            updated_at: '2026-01-01T00:00:00Z'
          }
        ]
      })
    )
    const service = new GitHubService({ httpClient: client })

    const result = await service.searchRepositories('pacstall')

    expect(result.total_count).toBe(1)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].full_name).toBe('pacstall/pacstall')
    expect(result.items[0].license?.spdx_id).toBe('GPL-3.0')
  })

  it('maps a 403 to a GitHubRateLimitError carrying the rate-limit headers', async () => {
    const { client } = stubHttp(async () => ({
      status: 403,
      headers: {
        'retry-after': '60',
        'x-ratelimit-reset': '1767225600',
        'x-ratelimit-remaining': '0'
      },
      body: JSON.stringify({ message: 'API rate limit exceeded' }),
      url: 'https://api.github.com/search/repositories'
    }))
    const service = new GitHubService({ httpClient: client })

    const error = await service.searchRepositories('pacstall').catch((err: unknown) => err)

    expect(error).toBeInstanceOf(GitHubRateLimitError)
    const rateLimit = error as GitHubRateLimitError
    expect(rateLimit.status).toBe(403)
    expect(rateLimit.retryAfter).toBe(60)
    expect(rateLimit.reset).toBe(1767225600)
    expect(rateLimit.remaining).toBe(0)
  })

  it('maps a 429 to a GitHubRateLimitError with absent headers as null', async () => {
    const { client } = stubHttp(async () => ({
      status: 429,
      headers: {},
      body: '',
      url: 'https://api.github.com/search/repositories'
    }))
    const service = new GitHubService({ httpClient: client })

    const error = await service.searchRepositories('pacstall').catch((err: unknown) => err)

    expect(error).toBeInstanceOf(GitHubRateLimitError)
    const rateLimit = error as GitHubRateLimitError
    expect(rateLimit.status).toBe(429)
    expect(rateLimit.retryAfter).toBeNull()
    expect(rateLimit.reset).toBeNull()
    expect(rateLimit.remaining).toBeNull()
  })

  it('throws a plain load failure for other non-200 statuses', async () => {
    const { client } = stubHttp(async () => ({
      status: 500,
      headers: {},
      body: 'boom',
      url: 'https://api.github.com/search/repositories'
    }))
    const service = new GitHubService({ httpClient: client })

    await expect(service.searchRepositories('pacstall')).rejects.toThrow(
      'Failed to search repositories: 500'
    )
  })
})

describe('GitHubService getGithubReleaseAssets', () => {
  /** A minimal classifier standing in for the installer's identifyAssetType. */
  function classify(name: string): InstallType | null {
    if (name.endsWith('.deb')) return InstallType.deb
    if (name.endsWith('.tar.gz')) return InstallType.binary
    return null
  }

  it('lists only installable assets, tagging each with its install type', async () => {
    const { client } = stubHttp(async () =>
      jsonResponse([
        releaseJson({
          tag_name: 'v1.2.0',
          published_at: '2026-03-04T05:06:07Z',
          assets: [
            assetJson('app-amd64.deb'),
            assetJson('app-linux.tar.gz'),
            assetJson('checksums.txt')
          ]
        })
      ])
    )
    const service = new GitHubService({ httpClient: client, identifyAssetType: classify })

    const result = await service.getGithubReleaseAssets('o', 'r')

    expect(result.tagName).toBe('v1.2.0')
    expect(result.publishedAt).toBe('2026-03-04T05:06:07.000Z')
    expect(result.assets).toEqual([
      {
        name: 'app-amd64.deb',
        size: 0,
        downloadUrl: 'https://example.com/app-amd64.deb',
        installType: InstallType.deb
      },
      {
        name: 'app-linux.tar.gz',
        size: 0,
        downloadUrl: 'https://example.com/app-linux.tar.gz',
        installType: InstallType.binary
      }
    ])
  })

  it('excludes prereleases unless requested', async () => {
    const { client } = stubHttp(async () =>
      jsonResponse([
        releaseJson({
          tag_name: 'v2.0.0-beta',
          prerelease: true,
          assets: [assetJson('app.deb')]
        }),
        releaseJson({ tag_name: 'v1.0.0', prerelease: false, assets: [assetJson('app.deb')] })
      ])
    )
    const service = new GitHubService({ httpClient: client, identifyAssetType: classify })

    expect((await service.getGithubReleaseAssets('o', 'r')).tagName).toBe('v1.0.0')
    expect(
      (await service.getGithubReleaseAssets('o', 'r', { includePrerelease: true })).tagName
    ).toBe('v2.0.0-beta')
  })

  it('returns a null tag and no assets when there is no usable release', async () => {
    const { client } = stubHttp(async () => jsonResponse([]))
    const service = new GitHubService({ httpClient: client, identifyAssetType: classify })

    expect(await service.getGithubReleaseAssets('o', 'r')).toEqual({
      tagName: null,
      assets: [],
      publishedAt: null
    })
  })

  it('reports matchedNames (incl. non-installable) and totalAssets for a filtered lookup', async () => {
    const { client } = stubHttp(async () =>
      jsonResponse([
        releaseJson({
          tag_name: 'v2.0.0',
          published_at: '2026-05-06T07:08:09Z',
          assets: [
            assetJson('app-amd64.deb'),
            assetJson('app.sha256'),
            assetJson('notes.txt')
          ]
        })
      ])
    )
    const service = new GitHubService({ httpClient: client, identifyAssetType: classify })

    const result = await service.getGithubReleaseAssets('o', 'r', { assetFilterPattern: '*' })

    expect(result.tagName).toBe('v2.0.0')
    expect(result.publishedAt).toBe('2026-05-06T07:08:09.000Z')
    // Every glob-matched name is reported, installable or not.
    expect(result.matchedNames).toEqual(['app-amd64.deb', 'app.sha256', 'notes.txt'])
    expect(result.totalAssets).toBe(3)
    // Only the `.deb` is installable, so it is the sole asset option.
    expect(result.assets).toEqual([
      {
        name: 'app-amd64.deb',
        size: 0,
        downloadUrl: 'https://example.com/app-amd64.deb',
        installType: InstallType.deb
      }
    ])
  })

  it('narrows matchedNames to the glob matches while totalAssets stays the pre-filter count', async () => {
    const { client } = stubHttp(async () =>
      jsonResponse([
        releaseJson({
          tag_name: 'v2.0.0',
          assets: [assetJson('app-amd64.deb'), assetJson('app.sha256'), assetJson('notes.txt')]
        })
      ])
    )
    const service = new GitHubService({ httpClient: client, identifyAssetType: classify })

    const result = await service.getGithubReleaseAssets('o', 'r', { assetFilterPattern: '*.deb' })

    expect(result.matchedNames).toEqual(['app-amd64.deb'])
    expect(result.totalAssets).toBe(3)
  })

  it('returns no match for a filtered lookup that matches nothing', async () => {
    const { client } = stubHttp(async () =>
      jsonResponse([releaseJson({ tag_name: 'v1.0.0', assets: [assetJson('app-amd64.deb')] })])
    )
    const service = new GitHubService({ httpClient: client, identifyAssetType: classify })

    expect(await service.getGithubReleaseAssets('o', 'r', { assetFilterPattern: '*.rpm' })).toEqual({
      tagName: null,
      assets: [],
      publishedAt: null
    })
  })

  it('rejects an invalid owner or repo before issuing a request', async () => {
    const { request, client } = stubHttp(async () => jsonResponse([]))
    const service = new GitHubService({ httpClient: client, identifyAssetType: classify })

    await expect(service.getGithubReleaseAssets('', 'r')).rejects.toThrow(/owner/)
    await expect(service.getGithubReleaseAssets('o', 'a/b')).rejects.toThrow(/name/)
    expect(request).not.toHaveBeenCalled()
  })
})
