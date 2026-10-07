// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useEffect, useRef, useState, type JSX } from 'react'
import { z } from 'zod'
import { formatRepoReference, parseRepoReference, type AddAppInput } from '@core/index'
import { useActions } from '@renderer/src/hooks/use-actions'
import { useSettings } from '@renderer/src/hooks/use-settings'
import {
  addAppDefaults,
  defaultArchitectures,
  defaultArchTypes
} from '@renderer/src/lib/add-app-defaults'
import { ArchSelect } from './arch-select'
import { FilterPreview } from './filter-preview'
import { useNotifications } from './notifications'
import { Button, Checkbox, Dialog, IconButton, SelectField, TextField } from './ui'

/** The add-app form shape, validated before it is mapped onto `AddAppInput`. */
const AddAppFormSchema = z.object({
  repository: z
    .string()
    .min(1, 'Repository is required')
    // Only run the parse check once something was typed, so an empty field
    // reports a single "required" error rather than two.
    .refine((value) => value.trim().length === 0 || parseRepoReference(value) !== null, {
      message: 'Enter owner/name or a GitHub URL'
    }),
  displayName: z.string().min(1, 'Display name is required'),
  assetFilterPattern: z.string(),
  tagPrefix: z.string().refine((value) => value === '' || /^[a-zA-Z0-9_-]+$/.test(value), {
    message: 'Use only letters, digits, hyphens and underscores'
  }),
  architectures: z.array(z.string()),
  includePrerelease: z.boolean(),
  launchCommand: z.string(),
  packageName: z.string(),
  installType: z.string()
})

type FormValues = z.infer<typeof AddAppFormSchema>
type FieldErrors = Partial<Record<keyof FormValues, string>>

/**
 * Install formats a tracked app may expect. Values match the model's
 * `InstallType`; an empty value means "let the app decide" (the installer
 * identifies the format from the release asset).
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

const EMPTY_FORM: FormValues = {
  repository: '',
  displayName: '',
  assetFilterPattern: '',
  tagPrefix: '',
  architectures: [],
  includePrerelease: false,
  launchCommand: '',
  packageName: '',
  installType: ''
}

export type AddAppDialogProps = {
  open: boolean
  onClose: () => void
}

/**
 * Dialog for tracking a new GitHub repository.
 *
 * A single "Repository" field accepts an `owner/name` slug or a full GitHub URL
 * and is parsed with `parseRepoReference`; the resolved parts are shown as
 * helper text. Optional filter fields (asset pattern, tag prefix, architectures)
 * are seeded from the user's settings and a derived asset filter, and a live
 * {@link FilterPreview} shows what they match. Validation runs with Zod before
 * calling `addApp`; the optional fields are only sent when non-empty so the main
 * process stores `null` rather than `""`.
 */
export function AddAppDialog({ open, onClose }: AddAppDialogProps): JSX.Element {
  const { addApp } = useActions()
  const { notify } = useNotifications()
  const { data: settings } = useSettings()

  const [form, setForm] = useState<FormValues>(() => ({ ...EMPTY_FORM }))
  const [errors, setErrors] = useState<FieldErrors>({})
  const formRef = useRef<HTMLFormElement>(null)
  const focusErrors = useRef(false)
  const seeded = useRef(false)
  // Once the user edits the display name themselves, stop overwriting it.
  const displayNameEdited = useRef(false)

  // Seed the defaults once the (async) settings arrive. The dialog is mounted
  // fresh on each open, so this runs at most once per open.
  useEffect(() => {
    if (seeded.current || settings == null) return
    seeded.current = true
    const defaults = addAppDefaults(settings)
    setForm((current) => ({
      ...current,
      architectures: defaults.architectures,
      installType: defaults.installType,
      assetFilterPattern: defaults.assetFilterPattern
    }))
  }, [settings])

  useEffect(() => {
    if (!focusErrors.current) return
    focusErrors.current = false
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errors])

  const parsedRepo = parseRepoReference(form.repository)
  const repositoryHint =
    parsedRepo != null
      ? `Resolved: ${formatRepoReference(parsedRepo.owner, parsedRepo.name)}`
      : 'owner/name or a GitHub URL'

  // The architecture types the picker offers come straight from settings (Dart
  // `_availableArchitectures`), so the add-app form pre-fills the arch type.
  const archTypes = defaultArchTypes(settings)

  const errorCount = Object.keys(errors).length

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]): void {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  /**
   * Updates the repository field and, until the user has edited the display
   * name themselves, auto-fills it with the parsed repo name.
   */
  function updateRepository(value: string): void {
    setForm((current) => {
      const parsed = parseRepoReference(value)
      return {
        ...current,
        repository: value,
        displayName:
          parsed != null && !displayNameEdited.current ? parsed.name : current.displayName
      }
    })
    setErrors((current) => {
      if (!('repository' in current)) return current
      const next = { ...current }
      delete next.repository
      return next
    })
  }

  function handleClose(): void {
    setForm({ ...EMPTY_FORM })
    setErrors({})
    displayNameEdited.current = false
    onClose()
  }

  async function pasteRepository(): Promise<void> {
    try {
      // The session denies the `clipboard-read` permission, so the renderer
      // cannot use `navigator.clipboard`; the main process reads it instead.
      const text = (await window.autonex.readClipboardText()).trim()
      // Normalise a pasted GitHub URL/slug to the canonical `owner/name`, but
      // keep unparseable text verbatim so the user can see and fix it.
      const parsed = parseRepoReference(text)
      updateRepository(parsed != null ? formatRepoReference(parsed.owner, parsed.name) : text)
    } catch {
      notify({ tone: 'warning', message: 'Could not read the clipboard.' })
    }
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

    const repo = parseRepoReference(parsed.data.repository)
    if (repo == null) {
      setErrors({ repository: 'Enter owner/name or a GitHub URL' })
      return
    }

    const fallbackArchitectures = defaultArchitectures(settings)
    const resolvedArchitectures =
      parsed.data.architectures.length > 0 ? parsed.data.architectures : fallbackArchitectures

    const input: AddAppInput = {
      repoOwner: repo.owner,
      repoName: repo.name,
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
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <TextField
              label="Repository"
              labelAddon={REQUIRED_MARKER}
              required
              placeholder="owner/repo"
              hint={repositoryHint}
              value={form.repository}
              error={errors.repository}
              onChange={(event) => updateRepository(event.target.value)}
            />
          </div>
          <div className="pt-5">
            <IconButton
              label="Paste from clipboard"
              variant="default"
              onClick={() => void pasteRepository()}
            >
              📋
            </IconButton>
          </div>
        </div>
        <TextField
          label="Display name"
          labelAddon={REQUIRED_MARKER}
          required
          placeholder="My App"
          value={form.displayName}
          error={errors.displayName}
          onChange={(event) => {
            displayNameEdited.current = true
            update('displayName', event.target.value)
          }}
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
        <ArchSelect
          value={form.architectures}
          known={archTypes}
          onChange={(architectures) => update('architectures', architectures)}
        />
        {parsedRepo != null ? (
          <FilterPreview
            repoOwner={parsedRepo.owner}
            repoName={parsedRepo.name}
            includePrerelease={form.includePrerelease}
            assetFilterPattern={form.assetFilterPattern}
            tagPrefix={form.tagPrefix}
            architectures={form.architectures}
          />
        ) : null}
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
