// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { GithubAssetDialog } from './github-asset-dialog'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

const ASSETS = {
  tagName: 'v1.0.0',
  assets: [
    {
      name: 'app-amd64.deb',
      size: 2048,
      downloadUrl: 'https://example.com/app-amd64.deb',
      installType: 'deb'
    },
    {
      name: 'app-arm64.deb',
      size: 2048,
      downloadUrl: 'https://example.com/app-arm64.deb',
      installType: 'deb'
    },
    {
      name: 'app-linux.tar.gz',
      size: 4096,
      downloadUrl: 'https://example.com/app-linux.tar.gz',
      installType: 'binary'
    }
  ]
}

function renderDialog(onConfirm = vi.fn(), overrides: Record<string, unknown> = {}) {
  installMockApi(overrides)
  renderWithProviders(
    <GithubAssetDialog
      repoOwner="o"
      repoName="r"
      displayName="App"
      busy={false}
      onCancel={vi.fn()}
      onConfirm={onConfirm}
    />
  )
  return onConfirm
}

describe('GithubAssetDialog', () => {
  it('fetches the release assets and groups them by install type', async () => {
    const getGithubReleaseAssets = vi.fn().mockResolvedValue(ASSETS)

    renderDialog(vi.fn(), { getGithubReleaseAssets })

    expect(await screen.findByRole('radio', { name: /app-amd64\.deb/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /app-linux\.tar\.gz/ })).toBeInTheDocument()
    expect(screen.getByText('DEB')).toBeInTheDocument()
    expect(screen.getByText('Binary')).toBeInTheDocument()
    expect(getGithubReleaseAssets).toHaveBeenCalledWith({
      repoOwner: 'o',
      repoName: 'r',
      includePrerelease: undefined
    })
  })

  it('defaults to Auto (best match) and confirms with no asset name', async () => {
    const onConfirm = renderDialog(vi.fn(), {
      getGithubReleaseAssets: vi.fn().mockResolvedValue(ASSETS)
    })

    const auto = await screen.findByRole('radio', { name: /Auto \(best match\)/ })
    expect(auto).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    expect(onConfirm).toHaveBeenCalledWith(null)
  })

  it('preselects the only installable asset', async () => {
    const onConfirm = renderDialog(vi.fn(), {
      getGithubReleaseAssets: vi
        .fn()
        .mockResolvedValue({ tagName: 'v1.0.0', assets: [ASSETS.assets[0]] })
    })

    const only = await screen.findByRole('radio', { name: /app-amd64\.deb/ })
    await waitFor(() => expect(only).toBeChecked())

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    expect(onConfirm).toHaveBeenCalledWith('app-amd64.deb')
  })

  it('passes the explicitly chosen asset name', async () => {
    const onConfirm = renderDialog(vi.fn(), {
      getGithubReleaseAssets: vi.fn().mockResolvedValue(ASSETS)
    })

    fireEvent.click(await screen.findByRole('radio', { name: /app-linux\.tar\.gz/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    expect(onConfirm).toHaveBeenCalledWith('app-linux.tar.gz')
  })

  it('shows an error state with retry', async () => {
    const getGithubReleaseAssets = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(ASSETS)

    renderDialog(vi.fn(), { getGithubReleaseAssets })

    expect(await screen.findByText('Could not load packages')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('radio', { name: /app-amd64\.deb/ })).toBeInTheDocument()
  })

  it('shows an empty state and disables install when nothing is installable', async () => {
    renderDialog(vi.fn(), {
      getGithubReleaseAssets: vi.fn().mockResolvedValue({ tagName: 'v1.0.0', assets: [] })
    })

    expect(await screen.findByText('No downloadable packages')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled()
  })
})
