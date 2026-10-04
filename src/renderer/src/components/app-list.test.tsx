// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { TrackedApp } from '@core/models/tracked-app'
import { AppList } from './app-list'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

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
})
