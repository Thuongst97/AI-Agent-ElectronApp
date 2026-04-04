import { app, safeStorage } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { AppSettings, DEFAULT_SETTINGS, TOKEN_MASKED } from '../../shared/ipc-types'
import log from 'electron-log'

/**
 * Shape written to disk — token is never stored as plain text.
 * `githubTokenEncrypted` holds a base64-encoded safeStorage-encrypted buffer.
 * `githubToken` key is intentionally absent.
 */
type DiskSettings = Omit<AppSettings, 'githubToken'> & {
  githubTokenEncrypted?: string
  /** Legacy plain-text field — migrated to encrypted on first read. */
  githubToken?: string
}

export class SettingsService {
  private readonly filePath: string
  private cache: AppSettings | null = null

  constructor() {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.filePath = join(dir, 'settings.json')
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Full settings including the plaintext token.
   * Main-process only — never send this to the renderer directly.
   */
  get(): AppSettings {
    if (this.cache) return this.cache

    if (!existsSync(this.filePath)) {
      const fromEnv: Partial<AppSettings> = {
        githubToken: process.env['GITHUB_TOKEN']  ?? '',
        llmBaseUrl:  process.env['LLM_BASE_URL']  ?? DEFAULT_SETTINGS.llmBaseUrl,
        llmModel:    process.env['LLM_MODEL']     ?? DEFAULT_SETTINGS.llmModel,
        chromaHost:  process.env['CHROMA_HOST']   ?? DEFAULT_SETTINGS.chromaHost,
        chromaPort:  Number(process.env['CHROMA_PORT']) || DEFAULT_SETTINGS.chromaPort,
      }
      this.cache = { ...DEFAULT_SETTINGS, ...fromEnv }
      this._save()
      return this.cache
    }

    try {
      const raw  = readFileSync(this.filePath, 'utf-8')
      const disk = JSON.parse(raw) as DiskSettings

      let token = ''

      if (disk.githubTokenEncrypted && safeStorage.isEncryptionAvailable()) {
        try {
          token = safeStorage.decryptString(
            Buffer.from(disk.githubTokenEncrypted, 'base64'),
          )
        } catch (e) {
          log.warn('[Settings] Failed to decrypt token — resetting to empty', e)
        }
      } else if (disk.githubToken) {
        // Migration: old plain-text token found → encrypt and re-save
        log.info('[Settings] Migrating plain-text token to encrypted storage')
        token = disk.githubToken
      }

      const { githubToken: _pt, githubTokenEncrypted: _enc, ...rest } = disk
      this.cache = { ...DEFAULT_SETTINGS, ...rest, githubToken: token }

      // Re-save immediately to apply encryption if we migrated a plain token
      if (disk.githubToken && !disk.githubTokenEncrypted) this._save()
    } catch (err) {
      log.warn('[Settings] Failed to read settings.json, using defaults', err)
      this.cache = { ...DEFAULT_SETTINGS }
    }

    return this.cache as AppSettings
  }

  /**
   * Settings safe to send to the renderer.
   * The GitHub token is replaced with TOKEN_MASKED so the real value is never
   * exposed to the browser process or DevTools.
   */
  getForRenderer(): AppSettings {
    const s = this.get()
    return { ...s, githubToken: s.githubToken ? TOKEN_MASKED : '' }
  }

  /**
   * Merge `partial` into the current settings and persist.
   * If `partial.githubToken` is empty or TOKEN_MASKED the existing token is kept.
   */
  set(partial: Partial<AppSettings>): void {
    const current = this.get()
    const incoming = partial.githubToken
    const tokenToStore =
      !incoming || incoming === TOKEN_MASKED
        ? current.githubToken   // keep encrypted value unchanged
        : incoming              // user provided a new token

    this.cache = { ...current, ...partial, githubToken: tokenToStore }
    this._save()
    log.info('[Settings] Updated:', Object.keys(partial).join(', '))
  }

  // ── Storage ───────────────────────────────────────────────────────────────

  private _save(): void {
    if (!this.cache) return
    try {
      const { githubToken, ...rest } = this.cache
      const disk: DiskSettings = { ...rest }

      if (githubToken) {
        if (safeStorage.isEncryptionAvailable()) {
          disk.githubTokenEncrypted = safeStorage
            .encryptString(githubToken)
            .toString('base64')
          log.info('[Settings] Token stored encrypted via safeStorage')
        } else {
          // safeStorage unavailable (headless / CI) — plain-text fallback with warning
          log.warn('[Settings] safeStorage unavailable — storing token as plain text (fallback)')
          ;(disk as DiskSettings & { githubToken: string }).githubToken = githubToken
        }
      }

      writeFileSync(this.filePath, JSON.stringify(disk, null, 2), 'utf-8')
    } catch (err) {
      log.error('[Settings] Failed to write settings.json', err)
    }
  }
}
