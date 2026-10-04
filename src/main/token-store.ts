// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import type { JsonStore } from './store/json-store'

/**
 * The subset of Electron's `safeStorage` this module needs.
 *
 * Declared structurally so the store is testable without Electron: production
 * passes `safeStorage` itself, tests pass a fake keyring.
 */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

/** On-disk key holding the base64-encoded encrypted token. */
export const GITHUB_TOKEN_ENC_KEY = 'github_token_enc'

/** Legacy on-disk key holding the token in plaintext; removed on migration. */
export const GITHUB_TOKEN_KEY = 'github_token'

/**
 * Stores the GitHub personal access token encrypted at rest.
 *
 * The token lives in `settings.json` under {@link GITHUB_TOKEN_ENC_KEY} as a
 * base64 string produced by Electron's `safeStorage.encryptString`, which is
 * backed by the OS keyring (libsecret / KWallet / Keychain / DPAPI). The
 * plaintext {@link GITHUB_TOKEN_KEY} key is removed on every write and by
 * {@link migratePlaintext} on startup.
 *
 * When the keyring is unavailable `setToken` refuses rather than silently
 * writing plaintext; `hasToken`/`getToken` still recognise a legacy plaintext
 * token so the app keeps working until the user re-saves it.
 */
export class TokenStore {
  private readonly store: JsonStore
  private readonly safeStorage: SafeStorageLike

  constructor(store: JsonStore, safeStorage: SafeStorageLike) {
    this.store = store
    this.safeStorage = safeStorage
  }

  /** Whether a token is configured (encrypted or a not-yet-migrated plaintext one). */
  async hasToken(): Promise<boolean> {
    const settings = await this.store.readSettings()
    const encrypted = settings[GITHUB_TOKEN_ENC_KEY]
    if (typeof encrypted === 'string' && encrypted.length > 0) return true
    const plaintext = settings[GITHUB_TOKEN_KEY]
    return typeof plaintext === 'string' && plaintext.length > 0
  }

  /**
   * The decrypted token, or `null` when unset. A stored ciphertext that cannot
   * be decrypted (e.g. the keyring changed) is reported as unset rather than
   * crashing the caller.
   */
  async getToken(): Promise<string | null> {
    const settings = await this.store.readSettings()
    const encrypted = settings[GITHUB_TOKEN_ENC_KEY]
    if (typeof encrypted === 'string' && encrypted.length > 0) {
      try {
        return this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
      } catch {
        return null
      }
    }
    const plaintext = settings[GITHUB_TOKEN_KEY]
    return typeof plaintext === 'string' && plaintext.length > 0 ? plaintext : null
  }

  /**
   * Encrypts and persists `token`, removing the plaintext key. A blank token
   * clears the stored token.
   *
   * @throws when the keyring is unavailable and a non-blank token was given —
   * plaintext is never written silently.
   */
  async setToken(token: string): Promise<void> {
    const settings: Record<string, unknown> = { ...(await this.store.readSettings()) }

    if (token.trim().length === 0) {
      delete settings[GITHUB_TOKEN_KEY]
      delete settings[GITHUB_TOKEN_ENC_KEY]
      await this.store.writeSettings(settings)
      return
    }

    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'Cannot store the GitHub token: OS keyring encryption (safeStorage) is ' +
          'unavailable. Install a keyring (gnome-keyring / kwallet) and try again.'
      )
    }

    settings[GITHUB_TOKEN_ENC_KEY] = this.safeStorage.encryptString(token).toString('base64')
    delete settings[GITHUB_TOKEN_KEY]
    await this.store.writeSettings(settings)
  }

  /**
   * Encrypts a legacy plaintext token found in `settings.json` and removes the
   * plaintext key.
   *
   * Returns `true` when a token was migrated. When the keyring is unavailable
   * the plaintext key is left untouched (it cannot be encrypted) and `false` is
   * returned; {@link getToken} keeps reading it in the meantime.
   */
  async migratePlaintext(): Promise<boolean> {
    const settings: Record<string, unknown> = { ...(await this.store.readSettings()) }
    const plaintext = settings[GITHUB_TOKEN_KEY]
    if (typeof plaintext !== 'string' || plaintext.length === 0) return false
    if (!this.safeStorage.isEncryptionAvailable()) return false

    settings[GITHUB_TOKEN_ENC_KEY] = this.safeStorage.encryptString(plaintext).toString('base64')
    delete settings[GITHUB_TOKEN_KEY]
    await this.store.writeSettings(settings)
    return true
  }
}
