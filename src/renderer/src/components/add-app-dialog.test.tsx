// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { AddAppDialog } from './add-app-dialog'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

/** Settings that seed a deterministic default architecture. */
function settings(): Record<string, unknown> {
  return { hasGithubToken: false, default_architecture: 'amd64' }
}

describe('AddAppDialog', () => {
  it('validates required fields and does not call addApp when empty', async () => {
    const addApp = vi.fn().mockResolvedValue(1)
    installMockApi({ addApp, getSettings: vi.fn().mockResolvedValue(settings()) })

    renderWithProviders(<AddAppDialog open onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add app' }))

    expect(await screen.findByText('Repository is required')).toBeInTheDocument()
    expect(addApp).not.toHaveBeenCalled()
  })

  it('parses the repository field and sends the mapped input with defaults', async () => {
    const addApp = vi.fn().mockResolvedValue(1)
    const onClose = vi.fn()
    installMockApi({ addApp, getSettings: vi.fn().mockResolvedValue(settings()) })

    renderWithProviders(<AddAppDialog open onClose={onClose} />)

    // The settings-driven defaults arrive asynchronously.
    await waitFor(() => expect(screen.getByLabelText('amd64')).toBeChecked())

    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'owner/repo' } })
    expect(await screen.findByText('Resolved: owner/repo')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'My App' } })
    fireEvent.click(screen.getByLabelText(/Include pre-releases/))

    fireEvent.click(screen.getByRole('button', { name: 'Add app' }))

    await waitFor(() => expect(addApp).toHaveBeenCalledTimes(1))
    expect(addApp).toHaveBeenCalledWith({
      repoOwner: 'owner',
      repoName: 'repo',
      displayName: 'My App',
      assetFilterPattern: '*amd64*',
      tagPrefix: null,
      architectures: ['amd64'],
      includePrerelease: true,
      launchCommand: null,
      packageName: null,
      installType: null
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('rejects a malformed repository reference', async () => {
    const addApp = vi.fn().mockResolvedValue(1)
    installMockApi({ addApp, getSettings: vi.fn().mockResolvedValue(settings()) })

    renderWithProviders(<AddAppDialog open onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'just-a-name' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'My App' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add app' }))

    expect(await screen.findByText('Enter owner/name or a GitHub URL')).toBeInTheDocument()
    expect(addApp).not.toHaveBeenCalled()
  })

  it('sends the selected install type', async () => {
    const addApp = vi.fn().mockResolvedValue(1)
    installMockApi({ addApp, getSettings: vi.fn().mockResolvedValue(settings()) })

    renderWithProviders(<AddAppDialog open onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'owner/repo' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'My App' } })
    fireEvent.change(screen.getByLabelText('Install type'), { target: { value: 'binary' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add app' }))

    await waitFor(() => expect(addApp).toHaveBeenCalledTimes(1))
    expect(addApp.mock.calls[0]?.[0]).toMatchObject({ installType: 'binary' })
  })

  it('pre-fills arch selection, install type, asset filter and arch types from settings', async () => {
    installMockApi({
      getSettings: vi.fn().mockResolvedValue({
        hasGithubToken: false,
        default_architectures: ['arm64'],
        default_install_type: 'deb',
        default_arch_type: ['amd64', 'arm64', 'riscv64'],
        default_asset_filter_pattern: '*.deb'
      })
    })

    renderWithProviders(<AddAppDialog open onClose={() => {}} />)

    // Arch selection is pre-filled from default_architectures.
    await waitFor(() => expect(screen.getByLabelText('arm64')).toBeChecked())
    // The picker offers the configured architecture types (arch type).
    expect(screen.getByLabelText('riscv64')).toBeInTheDocument()
    // Install type and asset filter come straight from settings.
    expect(screen.getByLabelText('Install type')).toHaveValue('deb')
    expect(screen.getByLabelText('Asset filter pattern')).toHaveValue('*.deb')
  })

  it('pastes a repository reference from the clipboard', async () => {
    installMockApi({
      getSettings: vi.fn().mockResolvedValue(settings()),
      readClipboardText: vi.fn().mockResolvedValue('https://github.com/owner/repo')
    })

    renderWithProviders(<AddAppDialog open onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }))

    await waitFor(() => expect(screen.getByLabelText('Repository')).toHaveValue('owner/repo'))
    expect(await screen.findByText('Resolved: owner/repo')).toBeInTheDocument()
  })

  it('warns when the clipboard read fails', async () => {
    installMockApi({
      getSettings: vi.fn().mockResolvedValue(settings()),
      readClipboardText: vi.fn().mockRejectedValue(new Error('clipboard unavailable'))
    })

    renderWithProviders(<AddAppDialog open onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }))

    expect(await screen.findByText('Could not read the clipboard.')).toBeInTheDocument()
  })

  it('auto-fills the display name from the repo name until it is edited', async () => {
    installMockApi({ getSettings: vi.fn().mockResolvedValue(settings()) })

    renderWithProviders(<AddAppDialog open onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'owner/codegraph' } })
    await waitFor(() => expect(screen.getByLabelText('Display name')).toHaveValue('codegraph'))

    // Still auto-filling while the name has not been touched.
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'owner/other' } })
    await waitFor(() => expect(screen.getByLabelText('Display name')).toHaveValue('other'))
  })

  it('does not clobber a manually edited display name', async () => {
    installMockApi({ getSettings: vi.fn().mockResolvedValue(settings()) })

    renderWithProviders(<AddAppDialog open onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'owner/codegraph' } })
    await waitFor(() => expect(screen.getByLabelText('Display name')).toHaveValue('codegraph'))

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'My Tool' } })
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'owner/other' } })

    await waitFor(() => expect(screen.getByLabelText('Display name')).toHaveValue('My Tool'))
  })
})
