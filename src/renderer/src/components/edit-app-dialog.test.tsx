// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { TrackedApp } from '@core/models/tracked-app'
import { EditAppDialog } from './edit-app-dialog'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

/** Builds a tracked app with sensible defaults for the edit dialog. */
function trackedApp(
  overrides: Partial<ConstructorParameters<typeof TrackedApp>[0]> = {}
): TrackedApp {
  return new TrackedApp({
    id: 7,
    repoOwner: 'owner',
    repoName: 'repo',
    displayName: 'My App',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides
  })
}

describe('EditAppDialog', () => {
  it('pre-fills the single repository field and shows the resolved reference', () => {
    installMockApi({})

    renderWithProviders(<EditAppDialog open app={trackedApp()} onClose={() => {}} />)

    expect(screen.getByLabelText('Repository')).toHaveValue('owner/repo')
    expect(screen.getByText('Resolved: owner/repo')).toBeInTheDocument()
  })

  it('parses the repository field and updates the app on save', async () => {
    const updateApp = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    installMockApi({ updateApp })

    renderWithProviders(
      <EditAppDialog open app={trackedApp({ architectures: ['amd64'] })} onClose={onClose} />
    )

    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'newowner/newrepo' } })
    expect(await screen.findByText('Resolved: newowner/newrepo')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Renamed' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateApp).toHaveBeenCalledTimes(1))
    expect(updateApp.mock.calls[0]?.[0]).toMatchObject({
      id: 7,
      repo_owner: 'newowner',
      repo_name: 'newrepo',
      display_name: 'Renamed',
      architectures: ['amd64']
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('adds a selected architecture through the shared ArchSelect', async () => {
    const updateApp = vi.fn().mockResolvedValue(undefined)
    installMockApi({ updateApp })

    renderWithProviders(
      <EditAppDialog open app={trackedApp({ architectures: ['amd64'] })} onClose={() => {}} />
    )

    fireEvent.click(screen.getByLabelText('arm64'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateApp).toHaveBeenCalledTimes(1))
    expect(updateApp.mock.calls[0]?.[0]).toMatchObject({ architectures: ['amd64', 'arm64'] })
  })

  it('rejects a malformed repository reference', async () => {
    const updateApp = vi.fn().mockResolvedValue(undefined)
    installMockApi({ updateApp })

    renderWithProviders(<EditAppDialog open app={trackedApp()} onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'just-a-name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Enter owner/name or a GitHub URL')).toBeInTheDocument()
    expect(updateApp).not.toHaveBeenCalled()
  })

  it('requires a display name', async () => {
    const updateApp = vi.fn().mockResolvedValue(undefined)
    installMockApi({ updateApp })

    renderWithProviders(<EditAppDialog open app={trackedApp()} onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Display name is required')).toBeInTheDocument()
    expect(updateApp).not.toHaveBeenCalled()
  })

  it('renders nothing when no app is supplied', () => {
    installMockApi({})

    const { container } = renderWithProviders(<EditAppDialog open app={null} onClose={() => {}} />)

    expect(container).toBeEmptyDOMElement()
  })
})
