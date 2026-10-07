// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { DiscoverView } from './discover-view'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

function status(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    installed: false,
    version: null,
    path: null,
    pathUnexpected: false,
    enabled: false,
    ...overrides
  }
}

describe('DiscoverView', () => {
  it('hides the pacstall mode when pacstall integration is disabled', async () => {
    const getPacstallStatus = vi.fn().mockResolvedValue(status({ enabled: false }))
    installMockApi({ getPacstallStatus })

    renderWithProviders(<DiscoverView />)

    // Wait for the status query to settle so the assertion is not trivially true
    // because the flag is still unknown.
    await waitFor(() => expect(getPacstallStatus).toHaveBeenCalled())

    expect(screen.getByRole('radio', { name: 'GitHub repositories' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'pacstall packages' })).toBeNull()
  })

  it('offers the pacstall mode when pacstall integration is enabled', async () => {
    installMockApi({
      getPacstallStatus: vi
        .fn()
        .mockResolvedValue(
          status({ installed: true, version: '6.0.0', path: '/usr/bin/pacstall', enabled: true })
        ),
      getPacstallIndex: vi.fn().mockResolvedValue({ names: [], fetchedAt: '', fromCache: false })
    })

    renderWithProviders(<DiscoverView />)

    expect(await screen.findByRole('radio', { name: 'pacstall packages' })).toBeInTheDocument()
  })
})
