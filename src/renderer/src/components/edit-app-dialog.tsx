// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useEffect, useRef, useState, type JSX } from 'react'
import { z } from 'zod'
import type { TrackedApp } from '@core/models/tracked-app'
import { useActions } from '@renderer/src/hooks/use-actions'
import { useNotifications } from './notifications'
import { Button, Checkbox, Dialog, TextField } from './ui'

const EditAppFormSchema = z.object({
  displayName: z.string().min(1, 'Display name is required'),
  repoOwner: z.string().min(1, 'Repository owner is required'),
  repoName: z.string().min(1, 'Repository name is required'),
  assetFilterPattern: z.string(),
  tagPrefix: z.string().refine((value) => value === '' || /^[a-zA-Z0-9_-]+$/.test(value), {
    message: 'Use only letters, digits, hyphens and underscores'
  }),
  architectures: z.string(),
  includePrerelease: z.boolean(),
  launchCommand: z.string(),
  packageName: z.string()
})

type FieldErrors = Partial<Record<keyof z.infer<typeof EditAppFormSchema>, string>>

/** Visual "required" affordance; the native `required` attr carries the semantics. */
const REQUIRED_MARKER = (
  <span aria-hidden="true" className="text-red">
    *
  </span>
)

function parseArchitectures(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export type EditAppDialogProps = {
  open: boolean
  app: TrackedApp | null
  onClose: () => void
}

/** Dialog for editing an existing tracked app, calling `updateApp` on save. */
export function EditAppDialog({ open, app, onClose }: EditAppDialogProps): JSX.Element | null {
  const { updateApp } = useActions()
  const { notify } = useNotifications()

  const [form, setForm] = useState(() => ({
    displayName: app?.displayName ?? '',
    repoOwner: app?.repoOwner ?? '',
    repoName: app?.repoName ?? '',
    assetFilterPattern: app?.assetFilterPattern ?? '',
    tagPrefix: app?.tagPrefix ?? '',
    architectures: app?.architectures.join(', ') ?? '',
    includePrerelease: app?.includePrerelease ?? false,
    launchCommand: app?.launchCommand ?? '',
    packageName: app?.packageName ?? ''
  }))
  const [errors, setErrors] = useState<FieldErrors>({})
  const formRef = useRef<HTMLFormElement>(null)
  const focusErrors = useRef(false)

  useEffect(() => {
    if (!focusErrors.current) return
    focusErrors.current = false
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errors])

  if (!open || app == null) return null

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

  async function handleSubmit(): Promise<void> {
    if (app == null) return
    const parsed = EditAppFormSchema.safeParse(form)
    if (!parsed.success) {
      const nextErrors: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        nextErrors[issue.path[0] as keyof FieldErrors] = issue.message
      }
      focusErrors.current = true
      setErrors(nextErrors)
      return
    }
    setErrors({})

    const updated = app.copyWith({
      displayName: parsed.data.displayName.trim(),
      repoOwner: parsed.data.repoOwner.trim(),
      repoName: parsed.data.repoName.trim(),
      assetFilterPattern: parsed.data.assetFilterPattern.trim() || null,
      tagPrefix: parsed.data.tagPrefix.trim() || null,
      architectures: parseArchitectures(parsed.data.architectures),
      includePrerelease: parsed.data.includePrerelease,
      launchCommand: parsed.data.launchCommand.trim() || null,
      packageName: parsed.data.packageName.trim() || null
    })

    try {
      await updateApp.mutateAsync(updated)
      notify({ tone: 'success', message: `${updated.displayName} updated.` })
      onClose()
    } catch {
      // The mutation's onError already raised a persistent notification.
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit tracked app"
      description={`${app.repoOwner}/${app.repoName}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={updateApp.isPending}
          >
            {updateApp.isPending ? 'Saving…' : 'Save changes'}
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
          label="Display name"
          labelAddon={REQUIRED_MARKER}
          required
          value={form.displayName}
          error={errors.displayName}
          onChange={(event) => update('displayName', event.target.value)}
        />
        <TextField
          label="Repository owner"
          labelAddon={REQUIRED_MARKER}
          required
          value={form.repoOwner}
          error={errors.repoOwner}
          onChange={(event) => update('repoOwner', event.target.value)}
        />
        <TextField
          label="Repository name"
          labelAddon={REQUIRED_MARKER}
          required
          value={form.repoName}
          error={errors.repoName}
          onChange={(event) => update('repoName', event.target.value)}
        />
        <TextField
          label="Asset filter pattern"
          value={form.assetFilterPattern}
          onChange={(event) => update('assetFilterPattern', event.target.value)}
        />
        <TextField
          label="Tag prefix"
          value={form.tagPrefix}
          error={errors.tagPrefix}
          onChange={(event) => update('tagPrefix', event.target.value)}
        />
        <TextField
          label="Architectures"
          hint="Comma-separated"
          value={form.architectures}
          onChange={(event) => update('architectures', event.target.value)}
        />
        <TextField
          label="Launch command"
          value={form.launchCommand}
          onChange={(event) => update('launchCommand', event.target.value)}
        />
        <TextField
          label="Package name"
          value={form.packageName}
          onChange={(event) => update('packageName', event.target.value)}
        />
        <Checkbox
          label="Include pre-releases"
          checked={form.includePrerelease}
          onChange={(event) => update('includePrerelease', event.target.checked)}
        />
        {/* Enables Enter-to-submit from any field; the visible footer button is
            outside the form, so a hidden native submit button is required. */}
        <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">
          Save changes
        </button>
      </form>
    </Dialog>
  )
}
