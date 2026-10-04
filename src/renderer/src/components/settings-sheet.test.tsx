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

  it('saves the default architecture through setSettings', async () => {
    const setSettings = vi.fn().mockResolvedValue(undefined)
    installMockApi({
      getSettings: vi.fn().mockResolvedValue({ hasGithubToken: false }),
      setSettings
    })

    renderWithProviders(<SettingsSheet open onClose={() => {}} />)

    fireEvent.change(await screen.findByLabelText('Default architecture'), {
      target: { value: 'arm64' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save default architecture' }))

    await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ default_architecture: 'arm64' }))
  })
})
