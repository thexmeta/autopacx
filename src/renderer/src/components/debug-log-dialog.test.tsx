// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { DebugLogDialog } from './debug-log-dialog'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

describe('DebugLogDialog', () => {
  it('renders the log tail returned by getDebugLog', async () => {
    const getDebugLog = vi.fn().mockResolvedValue({
      content: '[2026-01-01 00:00:00] [Cat] hello',
      truncated: false
    })
    installMockApi({ getDebugLog })

    renderWithProviders(<DebugLogDialog open onClose={() => {}} />)

    expect(await screen.findByText(/\[Cat\] hello/)).toBeInTheDocument()
  })

  it('notes when only a truncated tail is shown', async () => {
    installMockApi({
      getDebugLog: vi.fn().mockResolvedValue({ content: 'tail', truncated: true })
    })

    renderWithProviders(<DebugLogDialog open onClose={() => {}} />)

    expect(await screen.findByText(/most recent portion/)).toBeInTheDocument()
  })

  it('clears the log and refetches', async () => {
    const getDebugLog = vi
      .fn()
      .mockResolvedValueOnce({ content: 'before', truncated: false })
      .mockResolvedValueOnce({ content: '', truncated: false })
    const clearDebugLog = vi.fn().mockResolvedValue(undefined)
    installMockApi({ getDebugLog, clearDebugLog })

    renderWithProviders(<DebugLogDialog open onClose={() => {}} />)

    expect(await screen.findByText('before')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear log' }))

    await waitFor(() => expect(clearDebugLog).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('The debug log is empty.')).toBeInTheDocument()
  })

  it('renders nothing while closed', () => {
    installMockApi()
    renderWithProviders(<DebugLogDialog open={false} onClose={() => {}} />)
    expect(screen.queryByText('Debug log')).not.toBeInTheDocument()
  })
})
