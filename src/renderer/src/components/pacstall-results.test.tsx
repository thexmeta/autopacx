// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { PacstallResults } from './pacstall-results'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

function installedStatus(): Record<string, unknown> {
  return {
    installed: true,
    version: '6.0.0',
    path: '/usr/bin/pacstall',
    pathUnexpected: false,
    enabled: true
  }
}

const INDEX = {
  names: ['neovim', 'htop', 'ripgrep'],
  fetchedAt: '2026-01-01T00:00:00Z',
  fromCache: false
}

describe('PacstallResults', () => {
  it('filters the cached index client-side', async () => {
    installMockApi({
      getPacstallStatus: vi.fn().mockResolvedValue(installedStatus()),
      getPacstallIndex: vi.fn().mockResolvedValue(INDEX)
    })

    renderWithProviders(<PacstallResults />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'neo' } })

    expect(await screen.findByRole('button', { name: 'neovim' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'htop' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'ripgrep' })).toBeNull()
  })

  it('shows the not-installed banner with install guide and detect-again', async () => {
    installMockApi({
      getPacstallStatus: vi.fn().mockResolvedValue({
        installed: false,
        version: null,
        path: null,
        pathUnexpected: false,
        enabled: false
      }),
      getPacstallIndex: vi.fn().mockResolvedValue(INDEX)
    })

    renderWithProviders(<PacstallResults />)

    // The persistent banner is a polite status, not an assertive alert.
    expect(await screen.findByText('pacstall is not installed on this system.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'How to install pacstall' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Detect again' })).toBeInTheDocument()
  })

  it('shows a distinct banner when pacstall resolves to an unexpected path', async () => {
    installMockApi({
      getPacstallStatus: vi.fn().mockResolvedValue({
        installed: true,
        version: '6.0.0',
        path: '/home/user/.local/bin/pacstall',
        pathUnexpected: true,
        enabled: true
      }),
      getPacstallIndex: vi.fn().mockResolvedValue(INDEX)
    })

    renderWithProviders(<PacstallResults />)

    expect(await screen.findByText(/unexpected path/)).toBeInTheDocument()
  })

  it('disables the row Install button when pacstall is not installed', async () => {
    installMockApi({
      getPacstallStatus: vi.fn().mockResolvedValue({
        installed: false,
        version: null,
        path: null,
        pathUnexpected: false,
        enabled: true
      }),
      getPacstallIndex: vi.fn().mockResolvedValue(INDEX)
    })

    renderWithProviders(<PacstallResults />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'neovim' } })

    const install = await screen.findByRole('button', { name: 'Install neovim' })
    expect(install).toBeDisabled()
    // The disabled control points at the banner that explains how to install pacstall.
    expect(install).toHaveAttribute('aria-describedby')
  })

  it('names the filter field "Filter pacstall packages"', async () => {
    installMockApi({
      getPacstallStatus: vi.fn().mockResolvedValue(installedStatus()),
      getPacstallIndex: vi.fn().mockResolvedValue(INDEX)
    })

    renderWithProviders(<PacstallResults />)

    expect(
      await screen.findByRole('searchbox', { name: 'Filter pacstall packages' })
    ).toBeInTheDocument()
  })

  it('wires the expandable row button to its details region', async () => {
    const getPacstallPackageInfo = vi.fn().mockResolvedValue({
      pkgname: 'neovim',
      pkgver: '0.10.0',
      pkgdesc: 'Vim-fork focused on extensibility',
      arch: ['amd64'],
      depends: [],
      optdepends: [],
      makedepends: [],
      maintainer: '',
      url: '',
      license: [],
      source: [],
      sha256sums: []
    })
    installMockApi({
      getPacstallStatus: vi.fn().mockResolvedValue(installedStatus()),
      getPacstallIndex: vi.fn().mockResolvedValue(INDEX),
      getPacstallPackageInfo
    })

    renderWithProviders(<PacstallResults />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'neovim' } })
    const toggle = await screen.findByRole('button', { name: 'neovim' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).not.toHaveAttribute('aria-controls')

    fireEvent.click(toggle)

    const group = await screen.findByRole('group', { name: 'neovim package details' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', group.id)
  })

  it('tracks and installs a package through addPacstallPackage then installPacstallPackage', async () => {
    const addPacstallPackage = vi.fn().mockResolvedValue(4)
    const installPacstallPackage = vi.fn().mockResolvedValue({})
    installMockApi({
      getPacstallStatus: vi.fn().mockResolvedValue(installedStatus()),
      getPacstallIndex: vi.fn().mockResolvedValue(INDEX),
      addPacstallPackage,
      installPacstallPackage
    })

    renderWithProviders(<PacstallResults />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'neovim' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Install neovim' }))

    await waitFor(() =>
      expect(addPacstallPackage).toHaveBeenCalledWith({ name: 'neovim', displayName: 'neovim' })
    )
    await waitFor(() => expect(installPacstallPackage).toHaveBeenCalledTimes(1))
    const [pkg] = installPacstallPackage.mock.calls[0] as [Record<string, unknown>]
    expect(pkg['name']).toBe('neovim')
    expect(pkg['id']).toBe(4)
  })

  it('adds a package to the list without installing it', async () => {
    const addPacstallPackage = vi.fn().mockResolvedValue(9)
    const installPacstallPackage = vi.fn().mockResolvedValue({})
    installMockApi({
      getPacstallStatus: vi.fn().mockResolvedValue(installedStatus()),
      getPacstallIndex: vi.fn().mockResolvedValue(INDEX),
      addPacstallPackage,
      installPacstallPackage
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    renderWithProviders(<PacstallResults />, { client })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'neovim' } })

    fireEvent.click(await screen.findByRole('button', { name: 'Add neovim to list' }))

    await waitFor(() =>
      expect(addPacstallPackage).toHaveBeenCalledWith({ name: 'neovim', displayName: 'neovim' })
    )
    expect(installPacstallPackage).not.toHaveBeenCalled()
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pacstallPackages'] }))
  })

  it('keeps Add to list enabled when pacstall is not installed', async () => {
    installMockApi({
      getPacstallStatus: vi.fn().mockResolvedValue({
        installed: false,
        version: null,
        path: null,
        pathUnexpected: false,
        enabled: true
      }),
      getPacstallIndex: vi.fn().mockResolvedValue(INDEX)
    })

    renderWithProviders(<PacstallResults />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'neovim' } })

    expect(await screen.findByRole('button', { name: 'Install neovim' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add neovim to list' })).toBeEnabled()
  })

  it('lazily fetches package info when a row is expanded', async () => {
    const getPacstallPackageInfo = vi.fn().mockResolvedValue({
      pkgname: 'neovim',
      pkgver: '0.10.0',
      pkgdesc: 'Vim-fork focused on extensibility',
      arch: ['amd64'],
      depends: ['libc6'],
      optdepends: ['python3'],
      makedepends: [],
      maintainer: 'Test <t@example.com>',
      url: 'https://neovim.io',
      license: ['Apache-2.0'],
      source: [],
      sha256sums: []
    })
    installMockApi({
      getPacstallStatus: vi.fn().mockResolvedValue(installedStatus()),
      getPacstallIndex: vi.fn().mockResolvedValue(INDEX),
      getPacstallPackageInfo
    })

    renderWithProviders(<PacstallResults />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'neovim' } })
    expect(getPacstallPackageInfo).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByRole('button', { name: 'neovim' }))

    await waitFor(() => expect(getPacstallPackageInfo).toHaveBeenCalledWith({ name: 'neovim' }))
    expect(await screen.findByText('Vim-fork focused on extensibility')).toBeInTheDocument()
    expect(screen.getByText('libc6')).toBeInTheDocument()
    expect(screen.getByText('python3')).toBeInTheDocument()
  })
})
