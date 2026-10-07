// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
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

    fireEvent.change(screen.getByLabelText('Custom path'), {
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

    fireEvent.change(screen.getByLabelText('Custom path'), { target: { value: 'relative/bin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('Install path must be absolute')).toBeInTheDocument()
  })

  it('lists the suggested targets, badges them and pre-selects the recommended one', async () => {
    const getInstallTargets = vi.fn().mockResolvedValue({
      candidates: [
        {
          path: '/home/u/.local/bin',
          writable: true,
          onPath: true,
          ownedByPackage: false,
          recommended: true
        },
        {
          path: '/usr/bin',
          writable: false,
          onPath: true,
          ownedByPackage: true,
          recommended: false
        }
      ],
      defaultPath: '/home/u/.local/bin'
    })
    installMockApi({ getInstallTargets })
    const onConfirm = vi.fn()

    renderWithProviders(
      <InstallOptionsDialog app={app()} busy={false} onCancel={() => {}} onConfirm={onConfirm} />
    )

    const recommended = await screen.findByRole('radio', { name: /\/home\/u\/\.local\/bin/ })
    expect(recommended).toBeChecked()
    expect(screen.getByText('writable')).toBeInTheDocument()
    expect(screen.getByText('system-managed')).toBeInTheDocument()
    expect(screen.getAllByText('on PATH').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(onConfirm).toHaveBeenCalledWith({
      targetPath: '/home/u/.local/bin/myrepo',
      binaryName: 'myrepo'
    })
  })

  it('composes the selected directory with the binary name (never a bare directory)', async () => {
    const getInstallTargets = vi.fn().mockResolvedValue({
      candidates: [
        {
          path: '/home/u/.local/bin',
          writable: true,
          onPath: true,
          ownedByPackage: false,
          recommended: true
        },
        {
          path: '/usr/bin',
          writable: false,
          onPath: true,
          ownedByPackage: true,
          recommended: false
        }
      ],
      defaultPath: '/home/u/.local/bin'
    })
    installMockApi({ getInstallTargets })
    const onConfirm = vi.fn()

    renderWithProviders(
      <InstallOptionsDialog
        app={app({ repoName: 'codegraph', displayName: 'codegraph' })}
        busy={false}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />
    )

    fireEvent.click(await screen.findByRole('radio', { name: /\/usr\/bin/ }))
    // The resolved full path is shown, not the bare directory.
    expect(screen.getByText('/usr/bin/codegraph')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(onConfirm).toHaveBeenCalledWith({
      targetPath: '/usr/bin/codegraph',
      binaryName: 'codegraph'
    })
  })

  it('prefills the configured default binary install path', async () => {
    const getInstallTargets = vi.fn().mockResolvedValue({
      candidates: [
        {
          path: '/home/u/.local/bin',
          writable: true,
          onPath: true,
          ownedByPackage: false,
          recommended: true
        },
        {
          path: '/opt/apps/bin',
          writable: true,
          onPath: false,
          ownedByPackage: false,
          recommended: false
        }
      ],
      defaultPath: '/home/u/.local/bin'
    })
    installMockApi({
      getInstallTargets,
      getSettings: vi.fn().mockResolvedValue({
        hasGithubToken: false,
        default_binary_install_dir: '/opt/apps/bin'
      })
    })
    const onConfirm = vi.fn()

    renderWithProviders(
      <InstallOptionsDialog app={app()} busy={false} onCancel={() => {}} onConfirm={onConfirm} />
    )

    // The configured default directory is prefilled as a full install path.
    await screen.findByRole('radio', { name: /\/opt\/apps\/bin/ })
    await waitFor(() =>
      expect(screen.getByLabelText('Custom path')).toHaveValue('/opt/apps/bin/myrepo')
    )
    // The resolved path is shown.
    expect(screen.getByText('/opt/apps/bin/myrepo')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(onConfirm).toHaveBeenCalledWith({
      targetPath: '/opt/apps/bin/myrepo',
      binaryName: 'myrepo'
    })
  })

  it('shows a read-only destination for an AppImage and confirms without a target', () => {
    installMockApi()
    const onConfirm = vi.fn()

    renderWithProviders(
      <InstallOptionsDialog
        app={app({ installType: 'appImage' })}
        busy={false}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />
    )

    expect(screen.getByText(/appimages\/myrepo/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Custom path')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(onConfirm).toHaveBeenCalledWith({ targetPath: null, binaryName: null })
  })
})
