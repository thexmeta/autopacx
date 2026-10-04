// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { AddAppDialog } from './add-app-dialog'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

describe('AddAppDialog', () => {
  it('validates required fields and does not call addApp when empty', async () => {
    const addApp = vi.fn().mockResolvedValue(1)
    installMockApi({ addApp })

    renderWithProviders(<AddAppDialog open onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add app' }))

    expect(await screen.findByText('Repository owner is required')).toBeInTheDocument()
    expect(addApp).not.toHaveBeenCalled()
  })

  it('calls addApp with the mapped input when the form is valid', async () => {
    const addApp = vi.fn().mockResolvedValue(1)
    const onClose = vi.fn()
    installMockApi({ addApp })

    renderWithProviders(<AddAppDialog open onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('Repository owner'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText('Repository name'), { target: { value: 'repo' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'My App' } })
    fireEvent.change(screen.getByLabelText('Architectures'), {
      target: { value: 'amd64, arm64' }
    })
    fireEvent.click(screen.getByLabelText(/Include pre-releases/))

    fireEvent.click(screen.getByRole('button', { name: 'Add app' }))

    await waitFor(() => expect(addApp).toHaveBeenCalledTimes(1))
    expect(addApp).toHaveBeenCalledWith({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'My App',
      assetFilterPattern: null,
      tagPrefix: null,
      architectures: ['amd64', 'arm64'],
      includePrerelease: true,
      launchCommand: null,
      packageName: null,
      installType: null
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('sends the selected install type', async () => {
    const addApp = vi.fn().mockResolvedValue(1)
    installMockApi({ addApp })

    renderWithProviders(<AddAppDialog open onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText('Repository owner'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText('Repository name'), { target: { value: 'repo' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'My App' } })
    fireEvent.change(screen.getByLabelText('Install type'), { target: { value: 'binary' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add app' }))

    await waitFor(() => expect(addApp).toHaveBeenCalledTimes(1))
    expect(addApp.mock.calls[0]?.[0]).toMatchObject({ installType: 'binary' })
  })
})
