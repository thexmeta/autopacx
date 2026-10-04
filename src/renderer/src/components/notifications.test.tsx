// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { JSX } from 'react'
import { useNotifications } from './notifications'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

function Harness(): JSX.Element {
  const { notify } = useNotifications()
  return (
    <button type="button" onClick={() => notify({ tone: 'error', message: 'boom' })}>
      Fail
    </button>
  )
}

function SuccessHarness(): JSX.Element {
  const { notify } = useNotifications()
  return (
    <button type="button" onClick={() => notify({ tone: 'success', message: 'done' })}>
      Succeed
    </button>
  )
}

describe('notifications', () => {
  it('renders a persistent dismissible alert', async () => {
    installMockApi()
    renderWithProviders(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Fail' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('boom')

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('auto-dismisses success notices after the timeout', async () => {
    installMockApi()
    vi.useFakeTimers()
    try {
      renderWithProviders(<SuccessHarness />)

      fireEvent.click(screen.getByRole('button', { name: 'Succeed' }))
      expect(screen.getByRole('status')).toHaveTextContent('done')

      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(screen.queryByRole('status')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
