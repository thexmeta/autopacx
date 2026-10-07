// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { TrackedApp } from '@core/models/tracked-app'
import { AppList } from './app-list'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

function appWire(id: number, displayName: string) {
  return new TrackedApp({
    id,
    repoOwner: 'owner',
    repoName: `repo-${id}`,
    displayName,
    createdAt: new Date('2026-01-01T00:00:00Z')
  }).toMap()
}

describe('batch selection', () => {
  it('calls batchDelete with the selected app ids', async () => {
    const batchDelete = vi.fn().mockResolvedValue({ succeeded: 2, failed: 0 })
    installMockApi({
      getApps: vi.fn().mockResolvedValue([appWire(1, 'App One'), appWire(2, 'App Two')]),
      batchDelete
    })

    renderWithProviders(<AppList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select multiple' }))
    fireEvent.click(screen.getByLabelText('Select App One'))
    fireEvent.click(screen.getByLabelText('Select App Two'))

    // Delete is destructive: the first click only opens the confirm dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(batchDelete).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(batchDelete).toHaveBeenCalledWith([1, 2], [], []))
  })

  it('calls batchUpdate with the selected apps for a batch check', async () => {
    const batchUpdate = vi.fn().mockResolvedValue([])
    installMockApi({
      getApps: vi.fn().mockResolvedValue([appWire(1, 'App One')]),
      batchUpdate
    })

    renderWithProviders(<AppList />)

    fireEvent.click(await screen.findByRole('button', { name: 'Select multiple' }))
    fireEvent.click(screen.getByLabelText('Select App One'))
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))

    await waitFor(() => expect(batchUpdate).toHaveBeenCalledTimes(1))
    const [apps, debPackages] = batchUpdate.mock.calls[0] as [unknown[], unknown[]]
    expect(apps).toEqual([appWire(1, 'App One')])
    expect(debPackages).toEqual([])
  })
})
