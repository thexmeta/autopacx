// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SegmentedControl } from './segmented-control'

afterEach(cleanup)

function Harness(): JSX.Element {
  const [value, setValue] = useState<'github' | 'pacstall'>('github')
  return (
    <SegmentedControl
      ariaLabel="Discover source"
      value={value}
      onChange={setValue}
      options={[
        { value: 'github', label: 'GitHub repositories' },
        { value: 'pacstall', label: 'pacstall packages' }
      ]}
    />
  )
}

describe('SegmentedControl', () => {
  it('exposes a radio group with aria-checked on the selected option', () => {
    render(<Harness />)

    expect(screen.getByRole('radiogroup', { name: 'Discover source' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'GitHub repositories' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: 'pacstall packages' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('moves the selection with the arrow keys', () => {
    render(<Harness />)

    fireEvent.keyDown(screen.getByRole('radio', { name: 'GitHub repositories' }), {
      key: 'ArrowRight'
    })
    expect(screen.getByRole('radio', { name: 'pacstall packages' })).toHaveAttribute(
      'aria-checked',
      'true'
    )

    fireEvent.keyDown(screen.getByRole('radio', { name: 'pacstall packages' }), {
      key: 'ArrowLeft'
    })
    expect(screen.getByRole('radio', { name: 'GitHub repositories' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('jumps to the first and last option with Home and End', () => {
    render(<Harness />)

    fireEvent.keyDown(screen.getByRole('radio', { name: 'GitHub repositories' }), { key: 'End' })
    expect(screen.getByRole('radio', { name: 'pacstall packages' })).toHaveAttribute(
      'aria-checked',
      'true'
    )

    fireEvent.keyDown(screen.getByRole('radio', { name: 'pacstall packages' }), { key: 'Home' })
    expect(screen.getByRole('radio', { name: 'GitHub repositories' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('selects an option on click', () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('radio', { name: 'pacstall packages' }))
    expect(screen.getByRole('radio', { name: 'pacstall packages' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })
})
