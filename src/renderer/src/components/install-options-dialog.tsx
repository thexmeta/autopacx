// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { useEffect, useState, type JSX } from 'react'
import type { InstallOptions } from '@core/index'
import { InstallType } from '@core/models/install-type'
import type { TrackedApp } from '@core/models/tracked-app'
import { useInstallTargets } from '@renderer/src/hooks/use-install-targets'
import { useSettings } from '@renderer/src/hooks/use-settings'
import {
  candidateMatchesDir,
  executableName,
  installTargetBasename,
  joinInstallTarget
} from '@renderer/src/lib/install-options'
import { Badge, Button, Dialog, Spinner, TextField } from './ui'

export type InstallOptionsDialogProps = {
  app: TrackedApp
  busy: boolean
  onCancel: () => void
  onConfirm: (options: InstallOptions) => void
}

/**
 * Collects the destination for a raw-binary install, ported from the
 * `chooseInstallTarget` path in `lib/ui/upgrade_flow.dart`.
 *
 * The main process suggests the directories a binary could target; they are
 * listed as radios with the configured default directory (else the recommended
 * one) pre-selected, and a custom path overrides the selection. The chosen
 * directory is always composed with the binary name into a full file path, so
 * a bare directory is never sent as the target. An AppImage is placed by the
 * installer, so it only shows a read-only note of where it will land. The
 * parent mounts this only while it is open, so the initial values are derived
 * once from the app without a reset effect.
 */
export function InstallOptionsDialog({
  app,
  busy,
  onCancel,
  onConfirm
}: InstallOptionsDialogProps): JSX.Element {
  const isAppImage = app.installType === InstallType.appImage
  const name = executableName(app)

  const [chosen, setChosen] = useState<string | null>(null)
  const [customPath, setCustomPath] = useState('')
  const [binaryName, setBinaryName] = useState(name)
  const [pathError, setPathError] = useState<string | undefined>(undefined)
  // Guards the one-time prefill of the default installation path.
  const [prefilled, setPrefilled] = useState(false)

  const targets = useInstallTargets({ name, installType: app.installType })
  const candidates = targets.data?.candidates ?? []
  const { data: settings } = useSettings()

  // The configured default directory, if any. A `~`-prefixed value matches the
  // candidate it points at because the renderer has no `HOME`.
  const configuredDir =
    typeof settings?.default_binary_install_dir === 'string'
      ? settings.default_binary_install_dir.trim()
      : ''
  const configuredCandidate =
    configuredDir.length > 0
      ? candidates.find((candidate) => candidateMatchesDir(candidate.path, configuredDir))
      : undefined

  const custom = customPath.trim()
  // An empty binary name falls back to the app's executable name.
  const effectiveBinaryName = binaryName.trim().length > 0 ? binaryName.trim() : name
  // Resolve the configured default directory to an ABSOLUTE path: the matching
  // suggested candidate, an already-absolute setting, else the recommended one.
  // (A `~`-prefixed setting is only usable via the candidate it matches.)
  const defaultDirAbsolute =
    configuredCandidate?.path ??
    (configuredDir.startsWith('/') ? configuredDir : undefined) ??
    targets.data?.defaultPath ??
    ''
  // The full default installation path (directory + binary name).
  const defaultTargetPath =
    defaultDirAbsolute.length > 0 ? joinInstallTarget(defaultDirAbsolute, effectiveBinaryName) : ''
  // The directory to install into: the user's pick, else the resolved default.
  const selectedDir = chosen ?? defaultDirAbsolute

  // Prefill the target field with the configured default installation path once
  // settings/targets have loaded, so the dialog opens with it already filled in.
  // Only when a default directory is configured — otherwise the existing
  // "let the installer decide" behaviour (a null target) is preserved.
  useEffect(() => {
    if (prefilled || configuredDir.length === 0 || defaultTargetPath.length === 0) return
    setCustomPath(defaultTargetPath)
    setPrefilled(true)
  }, [prefilled, configuredDir, defaultTargetPath])
  // `InstallOptions.targetPath` must ALWAYS be a full file path, never a bare
  // directory; a custom path is already complete and is used verbatim.
  const effectiveTarget =
    custom.length > 0
      ? custom
      : selectedDir.length > 0
        ? joinInstallTarget(selectedDir, effectiveBinaryName)
        : ''
  // A composed path that equals a candidate directory is a bare directory.
  const targetIsDirectory = candidates.some((candidate) => candidate.path === effectiveTarget)

  function handleConfirm(): void {
    if (isAppImage) {
      onConfirm({ targetPath: null, binaryName: null })
      return
    }
    if (custom.length > 0 && !custom.startsWith('/')) {
      setPathError('Install path must be absolute')
      return
    }
    if (
      effectiveTarget.length > 0 &&
      (installTargetBasename(effectiveTarget).length === 0 || targetIsDirectory)
    ) {
      setPathError('Install path must name a file, not a directory')
      return
    }
    setPathError(undefined)
    onConfirm({
      targetPath: effectiveTarget.length > 0 ? effectiveTarget : null,
      binaryName: binaryName.trim().length > 0 ? binaryName.trim() : null
    })
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      title={`Install ${app.displayName}`}
      description={
        isAppImage
          ? 'AutoNex installs this AppImage for you.'
          : 'Choose where the binary is installed.'
      }
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirm} disabled={busy}>
            {busy ? 'Installing…' : 'Install'}
          </Button>
        </>
      }
    >
      {isAppImage ? (
        <p className="text-xs text-muted">
          Will install to <code className="break-all">{`<app data>/appimages/${name}`}</code>.
        </p>
      ) : (
        <div className="space-y-3">
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-secondary">Install target</legend>
            {targets.isPending ? (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center gap-2 text-xs text-muted"
              >
                <Spinner />
                <span>Finding install locations…</span>
              </div>
            ) : targets.isError ? (
              <p className="text-xs text-red">
                {targets.error?.message ?? 'Could not list install locations.'}
              </p>
            ) : candidates.length === 0 ? (
              <p className="text-xs text-muted">
                No suggested directories; enter a custom path below.
              </p>
            ) : (
              candidates.map((candidate) => (
                <label
                  key={candidate.path}
                  className="flex items-start gap-2 rounded-field px-1 py-0.5 hover:bg-hover"
                >
                  <input
                    type="radio"
                    name="install-target"
                    value={candidate.path}
                    checked={custom.length === 0 && selectedDir === candidate.path}
                    onChange={() => {
                      setChosen(candidate.path)
                      setCustomPath('')
                      setPathError(undefined)
                    }}
                    className="mt-0.5 accent-[var(--accent-solid)]"
                  />
                  <span className="min-w-0">
                    <span className="block break-all text-sm text-text">{candidate.path}</span>
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {candidate.recommended ? <Badge tone="accent">recommended</Badge> : null}
                      {candidate.onPath ? <Badge tone="neutral">on PATH</Badge> : null}
                      {candidate.writable ? <Badge tone="success">writable</Badge> : null}
                      {candidate.ownedByPackage ? (
                        <Badge tone="warning">system-managed</Badge>
                      ) : null}
                    </span>
                  </span>
                </label>
              ))
            )}
          </fieldset>
          {effectiveTarget.length > 0 ? (
            <p className="text-2xs text-muted">
              Installs to <code className="break-all">{effectiveTarget}</code>.
            </p>
          ) : null}
          <TextField
            label="Custom path"
            hint="Absolute path; overrides the selected target"
            placeholder="/usr/local/bin/my-app"
            value={customPath}
            error={pathError}
            onChange={(event) => {
              setCustomPath(event.target.value)
              if (pathError) setPathError(undefined)
            }}
          />
          <TextField
            label="Binary name"
            hint="Executable to select from an archive and install as"
            value={binaryName}
            onChange={(event) => setBinaryName(event.target.value)}
          />
        </div>
      )}
    </Dialog>
  )
}
