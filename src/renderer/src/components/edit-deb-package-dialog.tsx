// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useEffect, useRef, useState, type JSX } from 'react'
import { z } from 'zod'
import type { TrackedDebPackage } from '@core/models/tracked-deb-package'
import { useActions } from '@renderer/src/hooks/use-actions'
import { useNotifications } from './notifications'
import { Button, Checkbox, Dialog, TextField } from './ui'

const EditDebFormSchema = z.object({
  name: z.string().min(1, 'Internal name is required'),
  displayName: z.string(),
  packageUrl: z.string().refine((value) => {
    try {
      const url = new URL(value)
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0
    } catch {
      return false
    }
  }, 'A valid http(s) package URL is required'),
  autoUpdate: z.boolean()
})

type FieldErrors = Partial<Record<keyof z.infer<typeof EditDebFormSchema>, string>>

/** Visual "required" affordance; the native `required` attr carries the semantics. */
const REQUIRED_MARKER = (
  <span aria-hidden="true" className="text-red">
    *
  </span>
)

export type EditDebPackageDialogProps = {
  open: boolean
  pkg: TrackedDebPackage | null
  onClose: () => void
}

/** Dialog for editing a tracked deb package, calling `updateDebPackage` on save. */
export function EditDebPackageDialog({
  open,
  pkg,
  onClose
}: EditDebPackageDialogProps): JSX.Element | null {
  const { updateDebPackage } = useActions()
  const { notify } = useNotifications()

  const [form, setForm] = useState(() => ({
    name: pkg?.name ?? '',
    displayName: pkg?.displayName ?? '',
    packageUrl: pkg?.packageUrl ?? '',
    autoUpdate: pkg?.autoUpdate ?? false
  }))
  const [errors, setErrors] = useState<FieldErrors>({})
  const formRef = useRef<HTMLFormElement>(null)
  const focusErrors = useRef(false)

  useEffect(() => {
    if (!focusErrors.current) return
    focusErrors.current = false
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errors])

  if (!open || pkg == null) return null

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
    if (pkg == null) return
    const parsed = EditDebFormSchema.safeParse(form)
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

    const updated = pkg.copyWith({
      name: parsed.data.name.trim(),
      displayName: parsed.data.displayName.trim() || null,
      packageUrl: parsed.data.packageUrl.trim(),
      autoUpdate: parsed.data.autoUpdate
    })

    try {
      await updateDebPackage.mutateAsync(updated)
      notify({ tone: 'success', message: `${updated.effectiveDisplayName} updated.` })
      onClose()
    } catch {
      // The mutation's onError already raised a persistent notification.
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit deb package"
      description={pkg.filename || pkg.packageUrl}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={updateDebPackage.isPending}
          >
            {updateDebPackage.isPending ? 'Saving…' : 'Save'}
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
          label="Internal name (package id)"
          labelAddon={REQUIRED_MARKER}
          required
          value={form.name}
          error={errors.name}
          onChange={(event) => update('name', event.target.value)}
        />
        <TextField
          label="Display name"
          value={form.displayName}
          onChange={(event) => update('displayName', event.target.value)}
        />
        <TextField
          label="Package URL"
          labelAddon={REQUIRED_MARKER}
          required
          value={form.packageUrl}
          error={errors.packageUrl}
          onChange={(event) => update('packageUrl', event.target.value)}
        />
        <Checkbox
          label="Auto-update check"
          description="Preference only; no scheduler runs yet"
          checked={form.autoUpdate}
          onChange={(event) => update('autoUpdate', event.target.checked)}
        />
        {/* Enables Enter-to-submit from any field; the visible footer button is
            outside the form, so a hidden native submit button is required. */}
        <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">
          Save
        </button>
      </form>
    </Dialog>
  )
}
