# AutoPacX architecture

A GitHub-release package manager for Linux, built with Electron, React 19 and
TypeScript. This document describes the layer boundaries, the IPC contract, the
privileged-helper protocol, token handling and the build/packaging pipeline.

## Layers

The codebase is split into four layers with a one-way dependency direction:

```
core  ←  main   (Electron main process)
      ←  preload (contextBridge)
      ←  renderer (React, browser sandbox)
```

| Layer      | Path            | May import                       | Must never import                   |
| ---------- | --------------- | -------------------------------- | ----------------------------------- |
| `core`     | `src/core/`     | nothing framework-specific       | `electron`, `node:*`, DOM           |
| `main`     | `src/main/`     | `core`, `electron`, `node:*`     | renderer code                       |
| `preload`  | `src/preload/`  | `core`, `electron` (bridge only) | `node:*` app logic, renderer code   |
| `renderer` | `src/renderer/` | `core` types/constants, React    | `electron`, `node:*`, the raw token |

- **core** holds framework-free models (`TrackedApp`, `TrackedDebPackage`),
  version helpers and the IPC type contract (`src/core/api.ts`). It is the only
  shared vocabulary and has no I/O.
- **main** owns the window, the security policy, the services and every side
  effect (filesystem, network, `pkexec`, `shell`).
- **preload** is the single, typed bridge. It exposes `window.autopacx` via
  `contextBridge` and never leaks `ipcRenderer`/`require`/`fs`.
- **renderer** is React + Tailwind. It calls only `window.autopacx` and never
  touches Node or Electron.

Path aliases (`@core`, `@renderer`) are configured in `electron.vite.config.ts`
and mirrored in the `tsconfig*.json` files.

## IPC contract

Every channel is `autopacx:<method>`, where `<method>` is a member of the
`IPC_METHODS` tuple in `src/core/api.ts`. There is a single push channel,
`autopacx:event`, for progress events.

**Type-level completeness.** `IpcMethod` is derived from `IPC_METHODS`. Both
the handler map (`IpcHandlers` in `src/main/ipc-handlers.ts`) and the result
schema map (`resultSchemas` in `src/main/ipc.ts`) are _total records_ over
`IpcMethod`, and `AutopacxApi` (preload) implements every method. Adding a
channel without a handler, a result schema or a preload method fails typecheck.

**Two-sided validation.** Each handler parses its own arguments against a Zod
request schema (`src/main/ipc-schemas.ts`) before doing any work, and
`registerIpcHandlers` validates the handler's return value against the method's
result schema before it crosses back to the renderer. Handlers therefore return
_wire maps_ (`TrackedApp.toMap()`), never class instances — structured clone
drops prototypes, so getters like `hasUpdate` would otherwise arrive as
`undefined`.

**Sender trust.** Before any handler runs, the call is checked against
`isTrustedFrame` (`src/main/trusted.ts`): the sender must be the main window's
`webContents`, on its main frame, from an allowlisted origin (`file://` for the
packaged bundle, plus the Vite dev origin when `ELECTRON_RENDERER_URL` is set).
Registration is idempotent so per-window (re)creation rebinds cleanly.

**Progress events.** Long-running sweeps (`batchInstall`, `batchDelete`,
`batchUpdate`, `checkAllUpdates`) emit `BatchProgressEvent`s on
`autopacx:event`. `checkAllUpdates` never aborts on a single unreachable
repository: it collects per-item failures and returns them alongside the
refreshed lists, so the renderer can report "N of M failed" while still showing
what did succeed.

### Service seam

Handlers are thin validate→delegate adapters. Orchestration lives in a service
layer under `src/main/services/`:

- `app-service.ts` — tracked-app install / update-check / CRUD.
- `deb-service.ts` — direct-URL `.deb` install / update-check / CRUD / launch.
- `tracked-repository.ts` — persistence over the JSON store.
- `ports.ts` — narrow structural interfaces (`GitHubLike`, `InstallerLike`,
  `StoreLike`, …) that services and handlers depend on, so tests substitute
  plain stubs and no Electron is needed.

Batch sweeps remain in the handlers because their job is emitting progress on
the transport channel while looping over the same service calls.

## Security posture

- `webPreferences`: `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false` (`src/main/window-config.ts`).
- A strict Content-Security-Policy header plus a deny-all permission handler
  (`src/main/security.ts`).
- `setWindowOpenHandler` denies all new windows and `will-navigate` is
  prevented, so the renderer cannot navigate itself anywhere.
- External links go through `openExternal`, a main-only IPC method that accepts
  only `https://` URLs on an allowlisted host (`github.com`,
  `raw.githubusercontent.com`, `objects.githubusercontent.com`) and then calls
  Electron `shell.openExternal` (`src/main/services/external-link.ts`). It is
  the only `shell.openExternal` call site in `src/main/`; the renderer reaches
  it through a button, never an `<a href>`.

## Privileged-helper protocol

Installing a package, removing one, or writing a binary into a system directory
requires root. AutoPacX never builds a shell string and never asks `pkexec` to
run a generic interpreter or package manager. Every privileged step is an argv
array:

```
pkexec /usr/lib/autopacx/autopacx-helper <verb> <args...>
```

The root-owned helper (`resources/autopacx-helper`, installed by the package
post-install script) accepts a small, validated verb protocol — `apt-install`,
`rpm-install`, `dpkg-remove`, `rpm-remove`, `atomic-install`, `backup`,
`cleanup` — and rejects any path outside the app's own download/staging
directories or a fixed install-directory allowlist. The canonical specification
of that validation is `src/main/services/privileged-helper.ts`, which the POSIX
`sh` helper mirrors one-for-one; it is unit-tested and lets the app fail with a
clear error before spawning `pkexec`.

The polkit policy (`resources/org.autopacx.policy`) binds its single action to
that one helper (`auth_admin`, never cached), so `pkexec` cannot be turned into
a generic root shell. If the helper is absent (dev/unpackaged run) the install
fails with "Privileged helper not found" rather than falling back.

Downloads are HTTPS-only, follow redirects by hand so every hop stays HTTPS, and
are size-capped. The exact bytes downloaded are recorded (size + SHA-256) and
re-verified immediately before the privileged install, closing the
download→install TOCTOU window.

## Token handling

The GitHub personal access token is stored **encrypted** in `settings.json`
under `github_token_enc`, as base64 of `safeStorage.encryptString(...)` backed
by the OS keyring (gnome-keyring / KWallet / Keychain / DPAPI). The plaintext
`github_token` key is removed on every write and migrated on startup. If no
keyring is available, saving a token fails loudly instead of writing plaintext.

The token never crosses to the renderer. `getSettings` returns a
`MaskedSettings` map with every token key stripped plus a `hasGithubToken`
boolean; `setSettings` refuses to write token keys (they are owned by
`setGithubToken`). The main process injects the decrypted token into
`GitHubService` only.

## Build & packaging

- **Bundling** — `electron-vite build` produces three outputs in `out/`:
  `out/main`, `out/preload`, `out/renderer`. `pnpm typecheck` checks the node
  (`tsconfig.node.json`) and web (`tsconfig.web`) projects separately.
- **Packaging** — `electron-builder` (config in `electron-builder.yml`) builds
  Linux `deb` and `rpm` artifacts into `release/`. `build/` holds the icon and
  the `after-install.tpl` / `after-remove.tpl` maintainer scripts, which
  electron-builder reads at package time; they are deliberately **not** ignored
  by `.gitignore`.
- **Privileged assets** — `resources/org.autopacx.policy` and
  `resources/autopacx-helper` ship via `extraResources`; the post-install
  script installs them to `/usr/share/polkit-1/actions/` and
  `/usr/lib/autopacx/` and the post-remove script cleans them up.

## Testing

Vitest (`pnpm test`) covers core models, the main-process services and IPC
handlers (with stubbed ports, no Electron), the preload contract, and the
renderer components with Testing Library. The renderer tests assert the
`window.autopacx` bridge is called with the correct wire maps.
