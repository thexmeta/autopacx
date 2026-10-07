// SPDX-License-Identifier: MIT
// Copyright (c) 2024 PlebOne

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JsonStore } from './store/json-store'
import {
  GITHUB_TOKEN_ENC_KEY,
  GITHUB_TOKEN_KEY,
  TokenStore,
  type SafeStorageLike
} from './token-store'

/**
 * A reversible fake keyring. `encryptString` produces `enc:<plaintext>` so a
 * test can prove the stored value is not the plaintext while `decryptString`
 * still round-trips it.
 */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText: string) => Buffer.from(`enc:${plainText}`, 'utf8'),
    decryptString: (encrypted: Buffer) => encrypted.toString('utf8').replace(/^enc:/, '')
  }
}

async function readSettingsFile(directory: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(directory, 'settings.json'), 'utf8')
  return JSON.parse(raw) as Record<string, unknown>
}

describe('TokenStore', () => {
  let directory: string
  let store: JsonStore

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'autopacx-token-'))
    store = new JsonStore(directory)
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('encrypts the token on set and never writes plaintext', async () => {
    const tokenStore = new TokenStore(store, fakeSafeStorage())

    await tokenStore.setToken('ghp_secret')

    const settings = await readSettingsFile(directory)
    expect(settings[GITHUB_TOKEN_ENC_KEY]).toBe(Buffer.from('enc:ghp_secret').toString('base64'))
    expect(settings[GITHUB_TOKEN_KEY]).toBeUndefined()
    expect(JSON.stringify(settings)).not.toContain('ghp_secret')
  })

  it('decrypts the token on read and reports it as present', async () => {
    const tokenStore = new TokenStore(store, fakeSafeStorage())
    await tokenStore.setToken('ghp_secret')

    expect(await tokenStore.getToken()).toBe('ghp_secret')
    expect(await tokenStore.hasToken()).toBe(true)
  })

  it('clears both token keys when set with a blank value', async () => {
    const tokenStore = new TokenStore(store, fakeSafeStorage())
    await tokenStore.setToken('ghp_secret')

    await tokenStore.setToken('   ')

    const settings = await readSettingsFile(directory)
    expect(settings[GITHUB_TOKEN_ENC_KEY]).toBeUndefined()
    expect(settings[GITHUB_TOKEN_KEY]).toBeUndefined()
    expect(await tokenStore.hasToken()).toBe(false)
    expect(await tokenStore.getToken()).toBeNull()
  })

  it('migrates a legacy plaintext token to encrypted and deletes the plaintext key', async () => {
    await writeFile(
      join(directory, 'settings.json'),
      JSON.stringify({ theme: 'dark', [GITHUB_TOKEN_KEY]: 'ghp_legacy' }),
      'utf8'
    )
    const tokenStore = new TokenStore(store, fakeSafeStorage())

    expect(await tokenStore.migratePlaintext()).toBe(true)

    const settings = await readSettingsFile(directory)
    expect(settings[GITHUB_TOKEN_KEY]).toBeUndefined()
    expect(settings[GITHUB_TOKEN_ENC_KEY]).toBeDefined()
    expect(settings['theme']).toBe('dark')
    expect(await tokenStore.getToken()).toBe('ghp_legacy')
  })

  it('is a no-op when there is no plaintext token to migrate', async () => {
    const tokenStore = new TokenStore(store, fakeSafeStorage())
    expect(await tokenStore.migratePlaintext()).toBe(false)
  })

  it('refuses to store a token when the keyring is unavailable', async () => {
    const tokenStore = new TokenStore(store, fakeSafeStorage(false))

    await expect(tokenStore.setToken('ghp_secret')).rejects.toThrow(/keyring encryption/)

    // Nothing was written in plaintext.
    const settings: Record<string, unknown> = await readSettingsFile(directory).catch(
      () => ({}) as Record<string, unknown>
    )
    expect(settings[GITHUB_TOKEN_KEY]).toBeUndefined()
    expect(settings[GITHUB_TOKEN_ENC_KEY]).toBeUndefined()
  })

  it('leaves a legacy plaintext token in place when the keyring is unavailable', async () => {
    await writeFile(
      join(directory, 'settings.json'),
      JSON.stringify({ [GITHUB_TOKEN_KEY]: 'ghp_legacy' }),
      'utf8'
    )
    const tokenStore = new TokenStore(store, fakeSafeStorage(false))

    expect(await tokenStore.migratePlaintext()).toBe(false)
    // The app keeps working with the plaintext token until it can be encrypted.
    expect(await tokenStore.getToken()).toBe('ghp_legacy')
    expect(await tokenStore.hasToken()).toBe(true)
  })

  it('treats an undecryptable ciphertext as no token', async () => {
    const tokenStore = new TokenStore(store, {
      isEncryptionAvailable: () => true,
      encryptString: (plainText: string) => Buffer.from(plainText),
      decryptString: () => {
        throw new Error('wrong keyring')
      }
    })
    await writeFile(
      join(directory, 'settings.json'),
      JSON.stringify({ [GITHUB_TOKEN_ENC_KEY]: Buffer.from('x').toString('base64') }),
      'utf8'
    )

    expect(await tokenStore.getToken()).toBeNull()
  })
})
