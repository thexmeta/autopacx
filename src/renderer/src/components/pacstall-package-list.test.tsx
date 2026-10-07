// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { TrackedPacstallPackage } from '@core/models/tracked-pacstall-package'
import { PacstallPackageList } from './pacstall-package-list'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

function pkg(
  overrides: Partial<ConstructorParameters<typeof TrackedPacstallPackage>[0]> = {}
): TrackedPacstallPackage {
  return new TrackedPacstallPackage({
    id: 1,
    name: 'neovim',
    displayName: 'Neovim',
    installedVersion: '0.10.0',
    latestVersion: '0.11.0',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    registryRepo: 'pacstall/pacstall-programs',
    ...overrides
  })
}

function installedStatus(): Record<string, unknown> {
  return {
    installed: true,
    version: '6.0.0',
    path: '/usr/bin/pacstall',
    pathUnexpected: false,
    enabled: true
  }
}

describe('PacstallPackageList', () => {
  it('renders the tracked package with its versions and update badge', async () => {
    installMockApi({ getPacstallPackages: vi.fn().mockResolvedValue([pkg().toMap()]) })

    renderWithProviders(<PacstallPackageList />)

    expect(await screen.findByText('Neovim')).toBeInTheDocument()
    expect(screen.getByText('Installed: 0.10.0')).toBeInTheDocument()
    expect(screen.getByText('Latest: 0.11.0')).toBeInTheDocument()
    expect(screen.getByText('Update available')).toBeInTheDocument()
  })

  it('renders the empty state when nothing is tracked', async () => {
    installMockApi()

    renderWithProviders(<PacstallPackageList />)

    expect(await screen.findByText('No pacstall packages tracked')).toBeInTheDocument()
  })

  it('launches an installed package through the bridge', async () => {
    const tracked = pkg()
    const launchPacstall = vi.fn().mockResolvedValue(undefined)
    installMockApi({
      getPacstallPackages: vi.fn().mockResolvedValue([tracked.toMap()]),
      launchPacstall
    })

    renderWithProviders(<PacstallPackageList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Launch Neovim' }))

    await waitFor(() => expect(launchPacstall).toHaveBeenCalledWith(tracked.toMap()))
  })

  it('checks for updates through the bridge', async () => {
    const tracked = pkg()
    const checkPacstallUpdate = vi.fn().mockResolvedValue('0.11.0')
    installMockApi({
      getPacstallPackages: vi.fn().mockResolvedValue([tracked.toMap()]),
      checkPacstallUpdate
    })

    renderWithProviders(<PacstallPackageList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Check updates for Neovim' }))

    await waitFor(() => expect(checkPacstallUpdate).toHaveBeenCalledWith(tracked.toMap()))
  })

  it('deletes a tracked package after confirmation', async () => {
    const deletePacstallPackage = vi.fn().mockResolvedValue(undefined)
    installMockApi({
      getPacstallPackages: vi.fn().mockResolvedValue([pkg().toMap()]),
      deletePacstallPackage
    })

    renderWithProviders(<PacstallPackageList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Neovim' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deletePacstallPackage).toHaveBeenCalledWith(1))
  })

  it('disables the Install button when pacstall is not installed', async () => {
    installMockApi({
      getPacstallPackages: vi.fn().mockResolvedValue([pkg({ installedVersion: null }).toMap()]),
      getPacstallStatus: vi.fn().mockResolvedValue({
        installed: false,
        version: null,
        path: null,
        pathUnexpected: false,
        enabled: false
      })
    })

    renderWithProviders(<PacstallPackageList />)

    const install = await screen.findByRole('button', { name: 'Install Neovim' })
    expect(install).toBeDisabled()
    // The disabled control points at the banner that explains how to install pacstall.
    expect(install).toHaveAttribute('aria-describedby')
  })

  it('disables the Install button when pacstall resolves to an unexpected path', async () => {
    installMockApi({
      getPacstallPackages: vi.fn().mockResolvedValue([pkg({ installedVersion: null }).toMap()]),
      getPacstallStatus: vi.fn().mockResolvedValue({
        installed: true,
        version: '6.0.0',
        path: '/home/user/.local/bin/pacstall',
        pathUnexpected: true,
        enabled: true
      })
    })

    renderWithProviders(<PacstallPackageList />)

    expect(await screen.findByText(/unexpected path/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install Neovim' })).toBeDisabled()
  })

  it('installs a tracked package when pacstall is installed', async () => {
    const tracked = pkg({ installedVersion: null })
    const installPacstallPackage = vi.fn().mockResolvedValue({})
    installMockApi({
      getPacstallPackages: vi.fn().mockResolvedValue([tracked.toMap()]),
      getPacstallStatus: vi.fn().mockResolvedValue(installedStatus()),
      installPacstallPackage
    })

    renderWithProviders(<PacstallPackageList />)

    const install = await screen.findByRole('button', { name: 'Install Neovim' })
    expect(install).toBeEnabled()
    fireEvent.click(install)

    await waitFor(() => expect(installPacstallPackage).toHaveBeenCalledWith(tracked.toMap()))
  })

  it('filters the rows to installed packages', async () => {
    installMockApi({
      getPacstallPackages: vi.fn().mockResolvedValue([
        pkg({
          id: 1,
          name: 'inst',
          displayName: 'Installed Pkg',
          installedVersion: '1.0.0'
        }).toMap(),
        pkg({ id: 2, name: 'fresh', displayName: 'Fresh Pkg', installedVersion: null }).toMap()
      ])
    })

    renderWithProviders(<PacstallPackageList />)

    await screen.findByText('Installed Pkg')
    fireEvent.click(screen.getByRole('radio', { name: 'Installed' }))

    expect(screen.getByText('Installed Pkg')).toBeInTheDocument()
    expect(screen.queryByText('Fresh Pkg')).not.toBeInTheDocument()
  })
})
