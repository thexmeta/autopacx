// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { TrackedApp } from '@core/models/tracked-app'
import { AppList } from './app-list'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

function appWire(
  overrides: Partial<ConstructorParameters<typeof TrackedApp>[0]> & { displayName: string }
) {
  return new TrackedApp({
    repoOwner: 'owner',
    repoName: 'repo',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides
  }).toMap()
}

describe('AppList', () => {
  it('renders the name, installed/latest versions and update badge from the bridge', async () => {
    installMockApi({
      getApps: vi.fn().mockResolvedValue([
        new TrackedApp({
          id: 1,
          repoOwner: 'owner',
          repoName: 'repo',
          displayName: 'App One',
          installedVersion: '1.0.0',
          latestVersion: '1.1.0',
          createdAt: new Date('2026-01-01T00:00:00Z')
        }).toMap()
      ])
    })

    renderWithProviders(<AppList />)

    expect(await screen.findByText('App One')).toBeInTheDocument()
    expect(screen.getByText('Installed: 1.0.0')).toBeInTheDocument()
    expect(screen.getByText('Latest: 1.1.0')).toBeInTheDocument()
    expect(screen.getByText('Update available')).toBeInTheDocument()
  })

  it('renders the empty state when there are no tracked apps', async () => {
    installMockApi()

    renderWithProviders(<AppList />)

    expect(await screen.findByText('No apps tracked')).toBeInTheDocument()
  })

  it('renders the error state when the bridge rejects', async () => {
    installMockApi({ getApps: vi.fn().mockRejectedValue(new Error('boom')) })

    renderWithProviders(<AppList />)

    expect(await screen.findByText('Could not load apps')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('sorts the rows by name', async () => {
    installMockApi({
      getApps: vi
        .fn()
        .mockResolvedValue([
          appWire({ id: 1, repoName: 'z', displayName: 'Zeta' }),
          appWire({ id: 2, repoName: 'a', displayName: 'Alpha' })
        ])
    })

    renderWithProviders(<AppList />)

    const items = await screen.findAllByRole('listitem')
    const names = items.map((item) => item.querySelector('button')?.textContent)
    expect(names).toEqual(['Alpha', 'Zeta'])
  })

  it('filters the rows to installed apps', async () => {
    installMockApi({
      getApps: vi
        .fn()
        .mockResolvedValue([
          appWire({ id: 1, displayName: 'Installed App', installedVersion: '1.0.0' }),
          appWire({ id: 2, displayName: 'Fresh App' })
        ])
    })

    renderWithProviders(<AppList />)

    await screen.findByText('Installed App')
    fireEvent.click(screen.getByRole('radio', { name: 'Installed' }))

    expect(screen.getByText('Installed App')).toBeInTheDocument()
    expect(screen.queryByText('Fresh App')).not.toBeInTheDocument()
  })

  it('shows the release date when it is known', async () => {
    installMockApi({
      getApps: vi.fn().mockResolvedValue([
        appWire({
          id: 1,
          displayName: 'App One',
          latestReleaseDate: new Date('2026-03-04T00:00:00Z')
        })
      ])
    })

    renderWithProviders(<AppList />)

    expect(await screen.findByText(/Released:/)).toBeInTheDocument()
  })
})
