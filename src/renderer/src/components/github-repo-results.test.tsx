// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { GithubRepoResults } from './github-repo-results'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

function repoItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    full_name: 'facebook/react',
    description: 'The library for web and native user interfaces',
    stargazers_count: 200000,
    language: 'JavaScript',
    license: { spdx_id: 'MIT', name: 'MIT License' },
    default_branch: 'main',
    html_url: 'https://github.com/facebook/react',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides
  }
}

function searchResult(items: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return { total_count: items.length, incomplete_results: false, items, ...extra }
}

describe('GithubRepoResults', () => {
  it('debounces the query and renders the result row', async () => {
    const searchGithubRepositories = vi.fn().mockResolvedValue(searchResult([repoItem()]))
    installMockApi({ searchGithubRepositories })

    renderWithProviders(<GithubRepoResults />)

    const input = screen.getByRole('searchbox')
    // Three rapid edits must collapse into a single debounced request.
    fireEvent.change(input, { target: { value: 'r' } })
    fireEvent.change(input, { target: { value: 're' } })
    fireEvent.change(input, { target: { value: 'react' } })

    expect(await screen.findByText('facebook/react')).toBeInTheDocument()
    expect(screen.getByText('The library for web and native user interfaces')).toBeInTheDocument()
    expect(screen.getByText('MIT')).toBeInTheDocument()
    expect(screen.getByText('★ 200,000')).toBeInTheDocument()
    expect(screen.getByText('JavaScript')).toBeInTheDocument()

    expect(searchGithubRepositories).toHaveBeenCalledTimes(1)
    expect(searchGithubRepositories).toHaveBeenCalledWith({
      query: 'react',
      sort: 'best-match',
      perPage: 30,
      page: 1
    })
  })

  it('shows a warning badge when GitHub reports incomplete results', async () => {
    installMockApi({
      searchGithubRepositories: vi
        .fn()
        .mockResolvedValue(searchResult([repoItem()], { incomplete_results: true }))
    })

    renderWithProviders(<GithubRepoResults />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'react' } })

    expect(await screen.findByText('Partial results')).toBeInTheDocument()
  })

  it('surfaces the rate-limit banner with the reset time and a token CTA', async () => {
    const searchGithubRepositories = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Error invoking remote method 'autopacx:searchGithubRepositories': Error: " +
            'GitHub search rate limit exceeded (status 403, reset 1767225600, retry-after 60)'
        )
      )
    installMockApi({ searchGithubRepositories })

    renderWithProviders(<GithubRepoResults />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'react' } })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('GitHub search rate limit reached.')
    expect(alert).toHaveTextContent(/Resets at/)
    expect(screen.getByRole('button', { name: 'Add a GitHub token' })).toBeInTheDocument()
  })

  it('loads more pages and accumulates the results', async () => {
    const searchGithubRepositories = vi
      .fn()
      .mockResolvedValueOnce(searchResult([repoItem()], { total_count: 2 }))
      .mockResolvedValueOnce(
        searchResult([repoItem({ full_name: 'vuejs/core', stargazers_count: 50000 })], {
          total_count: 2
        })
      )
    installMockApi({ searchGithubRepositories })

    renderWithProviders(<GithubRepoResults />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'react' } })

    expect(await screen.findByText('facebook/react')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByText('vuejs/core')).toBeInTheDocument()
    // The first page's row is still present after appending.
    expect(screen.getByText('facebook/react')).toBeInTheDocument()
    expect(searchGithubRepositories).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'react', page: 2 })
    )
  })

  it('tracks and installs a repository through addApp then installApp', async () => {
    const addApp = vi.fn().mockResolvedValue(7)
    const installApp = vi.fn().mockResolvedValue({})
    installMockApi({
      searchGithubRepositories: vi.fn().mockResolvedValue(searchResult([repoItem()])),
      getGithubReleaseAssets: vi.fn().mockResolvedValue({
        tagName: 'v1.0.0',
        assets: [
          {
            name: 'app-amd64.deb',
            size: 10,
            downloadUrl: 'https://example.com/app-amd64.deb',
            installType: 'deb'
          }
        ]
      }),
      addApp,
      installApp
    })

    renderWithProviders(<GithubRepoResults />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'react' } })

    fireEvent.click(await screen.findByRole('button', { name: 'Add and install facebook/react' }))

    // The install-options dialog collects the destination before tracking.
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }))

    await waitFor(() =>
      expect(addApp).toHaveBeenCalledWith({
        repoOwner: 'facebook',
        repoName: 'react',
        displayName: 'react'
      })
    )

    // The asset dialog then offers the release packages; a single candidate is
    // preselected, so confirming installs it.
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }))

    await waitFor(() => expect(installApp).toHaveBeenCalledTimes(1))
    const [wire, options] = installApp.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>
    ]
    expect(wire['repo_owner']).toBe('facebook')
    expect(wire['repo_name']).toBe('react')
    expect(wire['id']).toBe(7)
    expect(options).toEqual({
      targetPath: null,
      binaryName: 'react',
      assetName: 'app-amd64.deb'
    })
  })

  it('adds a repository to the list without installing it', async () => {
    const addApp = vi.fn().mockResolvedValue(11)
    const installApp = vi.fn().mockResolvedValue({})
    installMockApi({
      searchGithubRepositories: vi.fn().mockResolvedValue(searchResult([repoItem()])),
      addApp,
      installApp
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    renderWithProviders(<GithubRepoResults />, { client })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'react' } })

    fireEvent.click(await screen.findByRole('button', { name: 'Add facebook/react to list' }))

    await waitFor(() =>
      expect(addApp).toHaveBeenCalledWith({
        repoOwner: 'facebook',
        repoName: 'react',
        displayName: 'react'
      })
    )
    // No install dialog, no install mutation.
    expect(installApp).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    // The tracked list is invalidated so the new item appears.
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['apps'] }))
  })

  it('shows a searching status and dims stale rows while the next page loads', async () => {
    let resolveSecond: ((value: unknown) => void) | undefined
    const second = new Promise<unknown>((resolve) => {
      resolveSecond = resolve
    })
    const searchGithubRepositories = vi
      .fn()
      .mockResolvedValueOnce(searchResult([repoItem()], { total_count: 2 }))
      .mockReturnValueOnce(second)
    installMockApi({ searchGithubRepositories })

    renderWithProviders(<GithubRepoResults />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'react' } })
    expect(await screen.findByText('facebook/react')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(searchGithubRepositories).toHaveBeenCalledTimes(2))

    // The first page stays visible (keepPreviousData) but is dimmed and flagged.
    expect(screen.getByText('Searching…')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'GitHub repository results' })
    expect(list.className).toContain('opacity-60')
    expect(screen.getByText('facebook/react')).toBeInTheDocument()

    resolveSecond?.(
      searchResult([repoItem({ full_name: 'vuejs/core', stargazers_count: 50000 })], {
        total_count: 2
      })
    )
    expect(await screen.findByText('vuejs/core')).toBeInTheDocument()
    // Once settled the stale dimming is removed.
    await waitFor(() =>
      expect(
        screen.getByRole('list', { name: 'GitHub repository results' }).className
      ).not.toContain('opacity-60')
    )
  })

  it('shows an inline error with retry when loading more fails but rows remain', async () => {
    const searchGithubRepositories = vi
      .fn()
      .mockResolvedValueOnce(searchResult([repoItem()], { total_count: 2 }))
      .mockRejectedValueOnce(new Error('network exploded'))
      .mockResolvedValue(
        searchResult([repoItem({ full_name: 'vuejs/core', stargazers_count: 50000 })], {
          total_count: 2
        })
      )
    installMockApi({ searchGithubRepositories })

    renderWithProviders(<GithubRepoResults />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'react' } })
    expect(await screen.findByText('facebook/react')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('network exploded')
    // The already-loaded row is not replaced by an empty state.
    expect(screen.getByText('facebook/react')).toBeInTheDocument()

    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(searchGithubRepositories).toHaveBeenCalledTimes(3))
  })

  it('reports how many results are shown and notes the GitHub cap', async () => {
    installMockApi({
      searchGithubRepositories: vi
        .fn()
        .mockResolvedValue(searchResult([repoItem()], { total_count: 1200 }))
    })

    renderWithProviders(<GithubRepoResults />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'react' } })

    expect(await screen.findByText(/Showing 1 of 1,000/)).toBeInTheDocument()
    expect(screen.getByText(/GitHub caps search results at 1,000/)).toBeInTheDocument()
  })

  it('names the search field "Search GitHub repositories"', async () => {
    installMockApi({ searchGithubRepositories: vi.fn().mockResolvedValue(searchResult([])) })

    renderWithProviders(<GithubRepoResults />)

    expect(
      screen.getByRole('searchbox', { name: 'Search GitHub repositories' })
    ).toBeInTheDocument()
  })
})
