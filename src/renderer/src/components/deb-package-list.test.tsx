// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { DebPackageList } from './deb-package-list'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

describe('DebPackageList', () => {
  it('renders the effective display name, filename and versions from the bridge', async () => {
    installMockApi({
      getDebPackages: vi.fn().mockResolvedValue([
        new TrackedDebPackage({
          id: 2,
          name: 'thing',
          packageUrl: 'https://example.com/downloads/thing_1.0.0_amd64.deb',
          displayName: 'Thing',
          installedVersion: '1.0.0',
          latestVersion: '1.0.1',
          createdAt: new Date('2026-01-01T00:00:00Z')
        }).toMap()
      ])
    })

    renderWithProviders(<DebPackageList />)

    expect(await screen.findByText('Thing')).toBeInTheDocument()
    expect(screen.getByText('thing_1.0.0_amd64.deb')).toBeInTheDocument()
    expect(screen.getByText('Installed: 1.0.0')).toBeInTheDocument()
    expect(screen.getByText('Latest: 1.0.1')).toBeInTheDocument()
    expect(screen.getByText('Update available')).toBeInTheDocument()
  })

  it('renders the empty state when there are no tracked packages', async () => {
    installMockApi()

    renderWithProviders(<DebPackageList />)

    expect(await screen.findByText('No deb packages tracked')).toBeInTheDocument()
  })

  it('launches an installed package through the bridge', async () => {
    const pkg = new TrackedDebPackage({
      id: 2,
      name: 'thing',
      packageUrl: 'https://example.com/downloads/thing_1.0.0_amd64.deb',
      displayName: 'Thing',
      installedVersion: '1.0.0',
      createdAt: new Date('2026-01-01T00:00:00Z')
    })
    const launchDeb = vi.fn().mockResolvedValue(undefined)
    installMockApi({ getDebPackages: vi.fn().mockResolvedValue([pkg.toMap()]), launchDeb })

    renderWithProviders(<DebPackageList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Launch Thing' }))

    await waitFor(() => expect(launchDeb).toHaveBeenCalledWith(pkg.toMap()))
  })
})
