// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SettingsSheet } from './settings-sheet'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

describe('SettingsSheet', () => {
  it('saves the token via setGithubToken and never renders a token value', async () => {
    const setGithubToken = vi.fn().mockResolvedValue(undefined)
    installMockApi({
      // Even if a raw secret leaked into the settings payload under any key,
      // the sheet must not read or render it — it only trusts hasGithubToken.
      getSettings: vi.fn().mockResolvedValue({
        hasGithubToken: true,
        legacy_secret: 'ghp_leaked',
        github_releases_per_page: 50,
        default_architecture: 'arm64',
        enable_debug_logging: true
      }),
      hasGithubToken: vi.fn().mockResolvedValue(true),
      setGithubToken
    })

    renderWithProviders(<SettingsSheet open onClose={() => {}} />)

    expect(await screen.findByText('A GitHub token is configured.')).toBeInTheDocument()
    expect(screen.queryByText('ghp_leaked')).toBeNull()

    const input = screen.getByLabelText('Personal access token')
    expect(input).toHaveValue('')

    fireEvent.change(input, { target: { value: 'ghp_newsecret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save token' }))

    await waitFor(() => expect(setGithubToken).toHaveBeenCalledWith('ghp_newsecret'))
    // The plaintext is dropped from component state once persisted.
    await waitFor(() => expect(screen.getByLabelText('Personal access token')).toHaveValue(''))
  })

  it('saves the four add-app defaults through setSettings', async () => {
    const setSettings = vi.fn().mockResolvedValue(undefined)
    installMockApi({
      getSettings: vi.fn().mockResolvedValue({ hasGithubToken: false }),
      setSettings
    })

    renderWithProviders(<SettingsSheet open onClose={() => {}} />)

    // Arch selection: the ArchSelect toggle adds a single architecture.
    fireEvent.click(await screen.findByLabelText('arm64'))
    // Arch types: the comma-separated input parses into a list.
    fireEvent.change(screen.getByLabelText('Architecture types'), {
      target: { value: 'amd64, riscv64' }
    })
    fireEvent.change(screen.getByLabelText('Default install type'), { target: { value: 'deb' } })
    fireEvent.change(screen.getByLabelText('Default asset filter pattern'), {
      target: { value: '*.deb' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }))

    await waitFor(() =>
      expect(setSettings).toHaveBeenCalledWith({
        default_architectures: ['arm64'],
        default_arch_type: ['amd64', 'riscv64'],
        default_install_type: 'deb',
        default_asset_filter_pattern: '*.deb',
        default_binary_install_dir: ''
      })
    )
  })

  it('saves the default binary install location through setSettings', async () => {
    const setSettings = vi.fn().mockResolvedValue(undefined)
    installMockApi({
      getSettings: vi.fn().mockResolvedValue({
        hasGithubToken: false,
        default_binary_install_dir: '~/.local/bin'
      }),
      setSettings
    })

    renderWithProviders(<SettingsSheet open onClose={() => {}} />)

    expect(await screen.findByLabelText('Default binary install location')).toHaveValue(
      '~/.local/bin'
    )
    fireEvent.change(screen.getByLabelText('Default binary install location'), {
      target: { value: '/opt/apps/bin' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }))

    await waitFor(() =>
      expect(setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ default_binary_install_dir: '/opt/apps/bin' })
      )
    )
  })

  it('pre-fills the four add-app defaults from settings', async () => {
    installMockApi({
      getSettings: vi.fn().mockResolvedValue({
        hasGithubToken: false,
        default_architectures: ['arm64'],
        default_arch_type: ['amd64', 'riscv64'],
        default_install_type: 'binary',
        default_asset_filter_pattern: '*linux*'
      })
    })

    renderWithProviders(<SettingsSheet open onClose={() => {}} />)

    expect(await screen.findByLabelText('arm64')).toBeChecked()
    expect(screen.getByLabelText('Architecture types')).toHaveValue('amd64, riscv64')
    expect(screen.getByLabelText('Default install type')).toHaveValue('binary')
    expect(screen.getByLabelText('Default asset filter pattern')).toHaveValue('*linux*')
  })

  it('saves the pacstall registry settings through setSettings', async () => {
    const setSettings = vi.fn().mockResolvedValue(undefined)
    installMockApi({
      getSettings: vi.fn().mockResolvedValue({
        hasGithubToken: false,
        pacstall_enabled: false,
        pacstall_registry_repo: 'pacstall/pacstall-programs',
        pacstall_registry_branch: 'master',
        pacstall_index_ttl_hours: 24
      }),
      setSettings
    })

    renderWithProviders(<SettingsSheet open onClose={() => {}} />)

    fireEvent.change(await screen.findByLabelText('Registry repo'), {
      target: { value: 'me/mirror' }
    })
    fireEvent.change(screen.getByLabelText('Registry branch'), { target: { value: 'dev' } })
    fireEvent.change(screen.getByLabelText('Index cache TTL (hours)'), {
      target: { value: '6' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save pacstall settings' }))

    await waitFor(() =>
      expect(setSettings).toHaveBeenCalledWith({
        pacstall_registry_repo: 'me/mirror',
        pacstall_registry_branch: 'dev',
        pacstall_index_ttl_hours: 6
      })
    )
  })

  it('toggles the pacstall integration through setSettings', async () => {
    const setSettings = vi.fn().mockResolvedValue(undefined)
    installMockApi({
      getSettings: vi.fn().mockResolvedValue({ hasGithubToken: false }),
      setSettings
    })

    renderWithProviders(<SettingsSheet open onClose={() => {}} />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Enable pacstall integration' }))

    await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ pacstall_enabled: true }))
  })

  it('saves the GitHub search defaults through setSettings', async () => {
    const setSettings = vi.fn().mockResolvedValue(undefined)
    installMockApi({
      getSettings: vi.fn().mockResolvedValue({ hasGithubToken: false }),
      setSettings
    })

    renderWithProviders(<SettingsSheet open onClose={() => {}} />)

    fireEvent.change(await screen.findByLabelText('Default sort'), { target: { value: 'stars' } })
    fireEvent.change(screen.getByLabelText('Results per page'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save search defaults' }))

    await waitFor(() =>
      expect(setSettings).toHaveBeenCalledWith({
        github_search_sort: 'stars',
        github_search_per_page: 50
      })
    )
  })

  it('never renders a raw secret value from the settings payload', async () => {
    installMockApi({
      // The main process masks the token key before IPC, but the sheet must not
      // read or render it even if a value leaked into the payload.
      getSettings: vi.fn().mockResolvedValue({
        hasGithubToken: true,
        legacy_secret: 'ghp_rawsecret'
      }),
      hasGithubToken: vi.fn().mockResolvedValue(true)
    })

    renderWithProviders(<SettingsSheet open onClose={() => {}} />)

    expect(await screen.findByText('A GitHub token is configured.')).toBeInTheDocument()
    expect(screen.queryByText('ghp_rawsecret')).toBeNull()
  })

  it('exposes the theme choice as a radio group with aria-checked', async () => {
    installMockApi({ getSettings: vi.fn().mockResolvedValue({ hasGithubToken: false }) })

    renderWithProviders(<SettingsSheet open onClose={() => {}} />)

    expect(await screen.findByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))

    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'false')
  })
})
