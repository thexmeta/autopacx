// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { TrackedApp } from '@core/models/tracked-app'
import { InstallOptionsDialog } from './install-options-dialog'
import { installMockApi, renderWithProviders } from '@renderer/src/test-utils'

afterEach(cleanup)

function app(overrides: Partial<ConstructorParameters<typeof TrackedApp>[0]> = {}): TrackedApp {
  return new TrackedApp({
    id: 1,
    repoOwner: 'owner',
    repoName: 'MyRepo',
    displayName: 'My App',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides
  })
}

describe('InstallOptionsDialog', () => {
  it('prefills the binary name and forwards the entered options', () => {
    installMockApi()
    const onConfirm = vi.fn()

    renderWithProviders(
      <InstallOptionsDialog app={app()} busy={false} onCancel={() => {}} onConfirm={onConfirm} />
    )

    expect(screen.getByLabelText('Binary name')).toHaveValue('myrepo')

    fireEvent.change(screen.getByLabelText('Install path'), {
      target: { value: '/usr/local/bin/myrepo' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    expect(onConfirm).toHaveBeenCalledWith({
      targetPath: '/usr/local/bin/myrepo',
      binaryName: 'myrepo'
    })
  })

  it('leaves the target path null when it is blank (install-latest default)', () => {
    installMockApi()
    const onConfirm = vi.fn()

    renderWithProviders(
      <InstallOptionsDialog app={app()} busy={false} onCancel={() => {}} onConfirm={onConfirm} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    expect(onConfirm).toHaveBeenCalledWith({ targetPath: null, binaryName: 'myrepo' })
  })

  it('rejects a relative install path without confirming', () => {
    installMockApi()
    const onConfirm = vi.fn()

    renderWithProviders(
      <InstallOptionsDialog app={app()} busy={false} onCancel={() => {}} onConfirm={onConfirm} />
    )

    fireEvent.change(screen.getByLabelText('Install path'), { target: { value: 'relative/bin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('Install path must be absolute')).toBeInTheDocument()
  })
})
