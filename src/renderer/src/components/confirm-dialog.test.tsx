// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useState, type JSX } from 'react'
import { ConfirmDialog } from './ui'

afterEach(cleanup)

type HarnessProps = {
  onConfirm: () => void
  onCancel: () => void
}

/** A controlled confirm dialog with a trigger, so focus restore can be asserted. */
function Harness({ onConfirm, onCancel }: HarnessProps): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open confirm
      </button>
      <ConfirmDialog
        open={open}
        title="Delete app"
        message="Permanently delete App One?"
        confirmLabel="Delete"
        onConfirm={() => {
          onConfirm()
          setOpen(false)
        }}
        onCancel={() => {
          onCancel()
          setOpen(false)
        }}
      />
    </>
  )
}

describe('ConfirmDialog', () => {
  it('exposes the title as the dialog name and confirms via the confirm button', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<Harness onConfirm={onConfirm} onCancel={onCancel} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open confirm' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName('Delete app')
    expect(dialog).toHaveTextContent('Permanently delete App One?')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels via the cancel button', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<Harness onConfirm={onConfirm} onCancel={onCancel} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open confirm' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('ignores Escape and backdrop clicks (non-dismissible)', () => {
    const onCancel = vi.fn()
    render(<Harness onConfirm={() => {}} onCancel={onCancel} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open confirm' }))
    const dialog = screen.getByRole('dialog')

    fireEvent.keyDown(dialog, { key: 'Escape' })
    const backdrop = dialog.parentElement?.querySelector('[aria-hidden="true"]')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)

    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('moves focus into the dialog and restores it to the trigger on close', async () => {
    render(<Harness onConfirm={() => {}} onCancel={() => {}} />)

    const trigger = screen.getByRole('button', { name: 'Open confirm' })
    trigger.focus()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toHaveFocus()

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
