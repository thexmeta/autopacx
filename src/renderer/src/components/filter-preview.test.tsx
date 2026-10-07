// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { FilterPreview } from './filter-preview'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

describe('FilterPreview', () => {
  it('shows the tag, release date, matched names and match count', async () => {
    const getGithubReleaseAssets = vi.fn().mockResolvedValue({
      tagName: 'v1.2.3',
      assets: [],
      publishedAt: '2026-03-04T00:00:00Z',
      matchedNames: ['app_1.2.3_amd64.deb', 'app_1.2.3_arm64.deb'],
      totalAssets: 5
    })
    installMockApi({ getGithubReleaseAssets })

    renderWithProviders(
      <FilterPreview repoOwner="owner" repoName="repo" assetFilterPattern="*amd64*" />
    )

    expect(await screen.findByText('v1.2.3')).toBeInTheDocument()
    expect(screen.getByText(/Released:/)).toBeInTheDocument()
    expect(screen.getByText('2 of 5 assets match')).toBeInTheDocument()
    expect(screen.getByText('app_1.2.3_amd64.deb')).toBeInTheDocument()
    expect(screen.getByText('app_1.2.3_arm64.deb')).toBeInTheDocument()
  })

  it('sends the debounced filters to the bridge', async () => {
    const getGithubReleaseAssets = vi
      .fn()
      .mockResolvedValue({ tagName: null, assets: [], publishedAt: null })
    installMockApi({ getGithubReleaseAssets })

    renderWithProviders(
      <FilterPreview
        repoOwner="owner"
        repoName="repo"
        assetFilterPattern="*.deb"
        tagPrefix="v"
        architectures={['amd64']}
      />
    )

    await waitFor(() => expect(getGithubReleaseAssets).toHaveBeenCalledTimes(1))
    expect(getGithubReleaseAssets).toHaveBeenCalledWith({
      repoOwner: 'owner',
      repoName: 'repo',
      assetFilterPattern: '*.deb',
      tagPrefix: 'v',
      architectures: ['amd64']
    })
  })

  it('shows an empty state when no release matches', async () => {
    installMockApi({
      getGithubReleaseAssets: vi
        .fn()
        .mockResolvedValue({ tagName: null, assets: [], publishedAt: null })
    })

    renderWithProviders(<FilterPreview repoOwner="owner" repoName="repo" />)

    expect(await screen.findByText('No matching release found.')).toBeInTheDocument()
  })

  it('shows an error with a retry action when the bridge rejects', async () => {
    installMockApi({
      getGithubReleaseAssets: vi.fn().mockRejectedValue(new Error('rate limited'))
    })

    renderWithProviders(<FilterPreview repoOwner="owner" repoName="repo" />)

    expect(await screen.findByText('rate limited')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('renders nothing when the repository is incomplete', () => {
    const getGithubReleaseAssets = vi.fn()
    installMockApi({ getGithubReleaseAssets })

    renderWithProviders(<FilterPreview repoOwner="" repoName="" />)

    expect(screen.queryByLabelText('Release preview')).not.toBeInTheDocument()
    expect(getGithubReleaseAssets).not.toHaveBeenCalled()
  })
})
