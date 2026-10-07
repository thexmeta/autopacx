// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useState, type JSX } from 'react'
import { Checkbox, TextField } from './ui'

/** The architectures offered as one-click toggles. */
const KNOWN_ARCHITECTURES = ['amd64', 'arm64', 'x86_64', 'arm', 'armhf', 'i386'] as const

/** Splits a comma-separated architecture list into trimmed, non-empty entries. */
function parseArchitectures(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export type ArchSelectProps = {
  /** The selected architectures; the single source of truth. */
  value: string[]
  onChange: (value: string[]) => void
  /** Architectures offered as toggles; defaults to {@link KNOWN_ARCHITECTURES}. */
  known?: readonly string[]
}

/**
 * Architecture picker: a row of known-architecture toggles plus a free-text
 * "custom architecture" field for anything not in the list.
 *
 * The parent owns the selected list. Known toggles add/remove a single entry;
 * the custom field contributes the architectures that are not in the known set.
 * Because the parent seeds `value` with the default architecture, that toggle
 * starts checked.
 */
export function ArchSelect({
  value,
  onChange,
  known = KNOWN_ARCHITECTURES
}: ArchSelectProps): JSX.Element {
  // The custom entries are held as raw text so typing (including a trailing
  // comma) is not rewritten under the user's cursor.
  const [custom, setCustom] = useState(() =>
    value.filter((arch) => !known.includes(arch)).join(', ')
  )

  function toggleKnown(arch: string, checked: boolean): void {
    const selected = known.filter((entry) => (entry === arch ? checked : value.includes(entry)))
    onChange([...selected, ...parseArchitectures(custom)])
  }

  function changeCustom(next: string): void {
    setCustom(next)
    const selected = known.filter((entry) => value.includes(entry))
    onChange([...selected, ...parseArchitectures(next)])
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs font-medium text-secondary">Architectures</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {known.map((arch) => (
          <Checkbox
            key={arch}
            label={arch}
            checked={value.includes(arch)}
            onChange={(event) => toggleKnown(arch, event.target.checked)}
          />
        ))}
      </div>
      <TextField
        label="Custom architecture"
        hint="Comma-separated entries not listed above, e.g. riscv64"
        placeholder="riscv64"
        value={custom}
        onChange={(event) => changeCustom(event.target.value)}
      />
    </fieldset>
  )
}
