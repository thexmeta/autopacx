// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useEffect, useRef, useState, type JSX } from 'react'
import { z } from 'zod'
import type { AddAppInput } from '@core/index'
import { useActions } from '@renderer/src/hooks/use-actions'
import { useSettings } from '@renderer/src/hooks/use-settings'
import { useNotifications } from './notifications'
import { Button, Checkbox, Dialog, SelectField, TextField } from './ui'

/** The add-app form shape, validated before it is mapped onto `AddAppInput`. */
const AddAppFormSchema = z.object({
  repoOwner: z.string().min(1, 'Repository owner is required'),
  repoName: z.string().min(1, 'Repository name is required'),
  displayName: z.string().min(1, 'Display name is required'),
  assetFilterPattern: z.string(),
  tagPrefix: z.string().refine((value) => value === '' || /^[a-zA-Z0-9_-]+$/.test(value), {
    message: 'Use only letters, digits, hyphens and underscores'
  }),
  architectures: z.string(),
  includePrerelease: z.boolean(),
  launchCommand: z.string(),
  packageName: z.string(),
  installType: z.string()
})

type FieldErrors = Partial<Record<keyof z.infer<typeof AddAppFormSchema>, string>>

const DEFAULT_ARCHITECTURES = ['amd64', 'arm64', 'x86_64', 'arm', 'armhf', 'i386']

/**
 * Install formats a tracked app may expect. Values match
 * `lib/models/install_type.dart`; an empty value means "let the app decide"
 * (the installer identifies the format from the release asset).
 */
const INSTALL_TYPE_OPTIONS = [
  { value: '', label: 'Not specified' },
  { value: 'appImage', label: 'AppImage' },
  { value: 'binary', label: 'Binary' },
  { value: 'deb', label: 'DEB' }
] as const

/** Visual "required" affordance; the native `required` attr carries the semantics. */
const REQUIRED_MARKER = (
  <span aria-hidden="true" className="text-red">
    *
  </span>
)

const EMPTY_FORM = {
  repoOwner: '',
  repoName: '',
  displayName: '',
  assetFilterPattern: '',
  tagPrefix: '',
  architectures: '',
  includePrerelease: false,
  launchCommand: '',
  packageName: '',
  installType: ''
}

/** Splits a comma-separated architecture list into trimmed, non-empty entries. */
function parseArchitectures(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export type AddAppDialogProps = {
  open: boolean
  onClose: () => void
}

/**
 * Dialog for tracking a new GitHub repository.
 *
 * Validates with Zod before calling `addApp`; the optional fields are only sent
 * when non-empty so the main process stores `null` rather than `""`. On a
 * failed submit the first invalid field is focused and a `role="alert"`
 * summary is announced; editing a field clears its own error.
 */
export function AddAppDialog({ open, onClose }: AddAppDialogProps): JSX.Element {
  const { addApp } = useActions()
  const { notify } = useNotifications()
  const { data: settings } = useSettings()

  const [form, setForm] = useState(() => ({ ...EMPTY_FORM }))
  const [errors, setErrors] = useState<FieldErrors>({})
  const formRef = useRef<HTMLFormElement>(null)
  const focusErrors = useRef(false)

  useEffect(() => {
    if (!focusErrors.current) return
    focusErrors.current = false
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errors])

  const defaultArch = settings?.default_architecture
  const architectureHint =
    defaultArch != null && defaultArch.length > 0
      ? `Comma-separated; defaults to ${defaultArch} when left blank`
      : 'Comma-separated, e.g. amd64, arm64'

  const errorCount = Object.keys(errors).length

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]): void {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  function handleClose(): void {
    setForm({ ...EMPTY_FORM })
    setErrors({})
    onClose()
  }

  async function handleSubmit(): Promise<void> {
    const parsed = AddAppFormSchema.safeParse(form)
    if (!parsed.success) {
      const nextErrors: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors
        nextErrors[key] = issue.message
      }
      focusErrors.current = true
      setErrors(nextErrors)
      return
    }
    setErrors({})

    const architectures = parseArchitectures(parsed.data.architectures)
    const resolvedArchitectures =
      architectures.length > 0
        ? architectures
        : defaultArch != null && defaultArch.length > 0
          ? [defaultArch]
          : []

    const input: AddAppInput = {
      repoOwner: parsed.data.repoOwner.trim(),
      repoName: parsed.data.repoName.trim(),
      displayName: parsed.data.displayName.trim(),
      assetFilterPattern: parsed.data.assetFilterPattern.trim() || null,
      tagPrefix: parsed.data.tagPrefix.trim() || null,
      architectures: resolvedArchitectures,
      includePrerelease: parsed.data.includePrerelease,
      launchCommand: parsed.data.launchCommand.trim() || null,
      packageName: parsed.data.packageName.trim() || null,
      installType: parsed.data.installType || null
    }

    try {
      await addApp.mutateAsync(input)
      notify({ tone: 'success', message: `${input.displayName} is now tracked.` })
      handleClose()
    } catch {
      // The mutation's onError already raised a persistent notification.
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Add app"
      description="Track a GitHub repository and watch its releases."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSubmit()} disabled={addApp.isPending}>
            {addApp.isPending ? 'Adding…' : 'Add app'}
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        noValidate
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit()
        }}
      >
        {errorCount > 0 ? (
          <div
            role="alert"
            className="rounded-field border border-red/40 bg-red/10 px-2 py-1.5 text-2xs text-red"
          >
            Please fix the {errorCount} highlighted field{errorCount > 1 ? 's' : ''} below.
          </div>
        ) : null}
        <TextField
          label="Repository owner"
          labelAddon={REQUIRED_MARKER}
          required
          placeholder="owner"
          value={form.repoOwner}
          error={errors.repoOwner}
          onChange={(event) => update('repoOwner', event.target.value)}
        />
        <TextField
          label="Repository name"
          labelAddon={REQUIRED_MARKER}
          required
          placeholder="repo"
          value={form.repoName}
          error={errors.repoName}
          onChange={(event) => update('repoName', event.target.value)}
        />
        <TextField
          label="Display name"
          labelAddon={REQUIRED_MARKER}
          required
          placeholder="My App"
          value={form.displayName}
          error={errors.displayName}
          onChange={(event) => update('displayName', event.target.value)}
        />
        <TextField
          label="Asset filter pattern"
          hint="Filter release assets by filename, e.g. *.deb or *amd64*"
          placeholder="*.deb"
          value={form.assetFilterPattern}
          onChange={(event) => update('assetFilterPattern', event.target.value)}
        />
        <TextField
          label="Tag prefix"
          hint="Only consider releases whose tag starts with this prefix"
          placeholder="v"
          value={form.tagPrefix}
          error={errors.tagPrefix}
          onChange={(event) => update('tagPrefix', event.target.value)}
        />
        <TextField
          label="Architectures"
          hint={architectureHint}
          placeholder={DEFAULT_ARCHITECTURES.slice(0, 3).join(', ')}
          value={form.architectures}
          onChange={(event) => update('architectures', event.target.value)}
        />
        <TextField
          label="Launch command"
          hint="Optional; checked with which before being offered"
          placeholder="my-app"
          value={form.launchCommand}
          onChange={(event) => update('launchCommand', event.target.value)}
        />
        <TextField
          label="Package name"
          hint="Optional; checked with dpkg"
          placeholder="my-app"
          value={form.packageName}
          onChange={(event) => update('packageName', event.target.value)}
        />
        <SelectField
          label="Install type"
          hint="Expected package format; leave unspecified to detect from the release asset"
          options={INSTALL_TYPE_OPTIONS}
          value={form.installType}
          onChange={(event) => update('installType', event.target.value)}
        />
        <Checkbox
          label="Include pre-releases"
          description="Allow beta/alpha releases"
          checked={form.includePrerelease}
          onChange={(event) => update('includePrerelease', event.target.checked)}
        />
        {/* Enables Enter-to-submit from any field; the visible footer button is
            outside the form, so a hidden native submit button is required. */}
        <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">
          Add app
        </button>
      </form>
    </Dialog>
  )
}
