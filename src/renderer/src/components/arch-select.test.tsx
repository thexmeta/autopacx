// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ArchSelect } from './arch-select'

afterEach(cleanup)

function Harness({
  initial,
  onChange
}: {
  initial: string[]
  onChange?: (v: string[]) => void
}): JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <ArchSelect
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

describe('ArchSelect', () => {
  it('pre-selects a known architecture passed in the value', () => {
    render(<Harness initial={['amd64']} />)

    expect(screen.getByLabelText('amd64')).toBeChecked()
    expect(screen.getByLabelText('arm64')).not.toBeChecked()
  })

  it('adds and removes known architectures as toggles are clicked', () => {
    const onChange = vi.fn()
    render(<Harness initial={['amd64']} onChange={onChange} />)

    fireEvent.click(screen.getByLabelText('arm64'))
    expect(onChange).toHaveBeenLastCalledWith(['amd64', 'arm64'])

    fireEvent.click(screen.getByLabelText('amd64'))
    expect(onChange).toHaveBeenLastCalledWith(['arm64'])
  })

  it('merges a custom architecture with the known selection', () => {
    const onChange = vi.fn()
    render(<Harness initial={['amd64']} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Custom architecture'), {
      target: { value: 'riscv64, loongarch64' }
    })

    expect(onChange).toHaveBeenLastCalledWith(['amd64', 'riscv64', 'loongarch64'])
  })
})
