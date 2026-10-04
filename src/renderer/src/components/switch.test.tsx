// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Switch } from './ui/switch'

afterEach(cleanup)

describe('Switch', () => {
  it('uses its visible label as the accessible name', () => {
    render(<Switch label="Enable debug logging" checked={false} onCheckedChange={() => {}} />)

    expect(screen.getByRole('switch', { name: 'Enable debug logging' })).toBeInTheDocument()
  })

  it('associates the description with the switch', () => {
    render(
      <Switch label="Enable" description="Verbose output" checked onCheckedChange={() => {}} />
    )

    expect(screen.getByRole('switch', { name: 'Enable' })).toHaveAccessibleDescription(
      'Verbose output'
    )
  })

  it('reports its checked state and toggles through onCheckedChange', () => {
    const onCheckedChange = vi.fn()
    render(<Switch label="Enable" checked={false} onCheckedChange={onCheckedChange} />)

    const control = screen.getByRole('switch', { name: 'Enable' })
    expect(control).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(control)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })
})
