import { useState, useEffect } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import type { AppSettings } from '@shared/ipc-types'
import { TOKEN_MASKED } from '@shared/ipc-types'
import { MODEL_GROUPS, ALL_KNOWN_VALUES, CUSTOM_SENTINEL, REASONING_MODELS } from '../constants/models'

export default function SettingsView({ onClose }: { onClose: () => void }): JSX.Element {
  const { settings, loadSettings, saveSettings } = useSettingsStore()
  const [form, setForm] = useState<AppSettings>(settings)
  const [saved, setSaved] = useState(false)
  const [tokenError, setTokenError] = useState('')
  const [saveError, setSaveError] = useState('')

  // Track whether the current model value is a custom (not in the known list)
  const [customModel, setCustomModel] = useState(
    !ALL_KNOWN_VALUES.includes(settings.copilotModel ?? '') ? (settings.copilotModel ?? '') : ''
  )
  const isCustom = !ALL_KNOWN_VALUES.includes(form.copilotModel ?? '')
  const supportsReasoning = REASONING_MODELS.has(form.copilotModel ?? '')

  useEffect(() => {
    loadSettings().then(() => {
      setForm(settings)
      setCustomModel(!ALL_KNOWN_VALUES.includes(settings.copilotModel ?? '') ? (settings.copilotModel ?? '') : '')
    })
  }, [])

  const handleSave = async (): Promise<void> => {
    if (tokenError) return
    setSaveError('')
    try {
      await saveSettings(form)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError(String(err).replace(/^Error:\s*/, ''))
    }
  }

  const field = (label: string, key: keyof AppSettings, type = 'text'): JSX.Element => (
    <label className="flex flex-col gap-1 text-sm">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <input
        type={type}
        className="input-bar text-sm py-2"
        value={String(form[key] ?? '')}
        onChange={e =>
          setForm(f => ({ ...f, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))
        }
      />
    </label>
  )

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Settings</h2>
        <button className="btn-ghost" onClick={onClose}>✕ Close</button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        <section>
          <h3 className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>GitHub Copilot</h3>
          <div className="flex flex-col gap-3">

            {/* ── GitHub Token ── */}
            <div className="flex flex-col gap-1 text-sm">
              <span style={{ color: 'var(--text-muted)' }}>Token <span className="text-xs font-normal">(optional)</span></span>
              <div className="flex gap-2">
                <input
                  type="password"
                  className={`input-bar text-sm py-2 flex-1 ${tokenError ? 'border-red-500' : ''}`}
                  value={form.githubToken === TOKEN_MASKED ? '' : (form.githubToken ?? '')}
                  placeholder={
                    form.githubToken === TOKEN_MASKED
                      ? 'Token saved — clear and retype to change'
                      : 'Leave empty to use gh CLI credentials'
                  }
                  onChange={e => {
                    const val = e.target.value
                    setForm(f => ({ ...f, githubToken: val }))
                    if (val.startsWith('ghp_')) {
                      setTokenError('PATs (ghp_…) are not supported. Use an OAuth token from `gh auth token` (ghu_…) or leave empty.')
                    } else {
                      setTokenError('')
                    }
                  }}
                />
                {form.githubToken === TOKEN_MASKED && (
                  <button
                    type="button"
                    className="btn-ghost text-xs px-3 whitespace-nowrap"
                    style={{ color: 'var(--text-muted)' }}
                    onClick={() => { setForm(f => ({ ...f, githubToken: '' })); setTokenError('') }}
                  >
                    Clear
                  </button>
                )}
              </div>
              {tokenError
                ? <span className="text-xs" style={{ color: '#f87171' }}>⚠️ {tokenError}</span>
                : form.githubToken === TOKEN_MASKED
                  ? <span className="text-xs" style={{ color: 'var(--text-muted)' }}>🔒 Stored encrypted on this device</span>
                  : <span className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      <strong>Option A (recommended):</strong> Leave empty — uses <code className="px-1 rounded" style={{background:'var(--bg-hover)'}}>gh auth login</code> credentials automatically.<br/>
                      <strong>Option B:</strong> OAuth token from <code className="px-1 rounded" style={{background:'var(--bg-hover)'}}>gh auth token</code> (starts with <code className="px-1 rounded" style={{background:'var(--bg-hover)'}}>ghu_</code>).
                    </span>
              }
            </div>

            {/* ── Model selector ── */}
            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: 'var(--text-muted)' }}>Model</span>
              <select
                className="input-bar text-sm py-2"
                value={isCustom ? CUSTOM_SENTINEL : (form.copilotModel ?? '')}
                onChange={e => {
                  const v = e.target.value
                  if (v === CUSTOM_SENTINEL) {
                    setCustomModel('')
                    setForm(f => ({ ...f, copilotModel: '' }))
                  } else {
                    setCustomModel('')
                    setForm(f => ({ ...f, copilotModel: v }))
                  }
                }}
              >
                {MODEL_GROUPS.map(g => (
                  <optgroup key={g.group} label={g.group}>
                    {g.models.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </optgroup>
                ))}
                <option value={CUSTOM_SENTINEL}>Custom…</option>
              </select>
              {isCustom && (
                <input
                  type="text"
                  className="input-bar text-sm py-2 mt-1"
                  placeholder="Enter custom model name"
                  value={customModel}
                  onChange={e => {
                    setCustomModel(e.target.value)
                    setForm(f => ({ ...f, copilotModel: e.target.value }))
                  }}
                />
              )}
            </label>

            {/* ── Reasoning Effort (only for models that support it) ── */}
            {supportsReasoning && (
              <label className="flex flex-col gap-1 text-sm">
                <span style={{ color: 'var(--text-muted)' }}>Reasoning Effort</span>
                <select
                  className="input-bar text-sm py-2"
                  value={form.reasoningEffort ?? ''}
                  onChange={e => setForm(f => ({
                    ...f,
                    reasoningEffort: (e.target.value || null) as AppSettings['reasoningEffort'],
                  }))}
                >
                  <option value="">Default</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="xhigh">Extra High</option>
                </select>
              </label>
            )}
          </div>
        </section>

        <section>
          <h3 className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>ChromaDB</h3>
          <div className="flex flex-col gap-3">
            {field('Host', 'chromaHost')}
            {field('Port', 'chromaPort', 'number')}
          </div>
        </section>

        <section>
          <h3 className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Appearance</h3>
          <label className="flex flex-col gap-1 text-sm">
            <span style={{ color: 'var(--text-muted)' }}>Theme</span>
            <select
              className="input-bar text-sm py-2"
              value={form.theme}
              onChange={e => setForm(f => ({ ...f, theme: e.target.value as AppSettings['theme'] }))}
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
        </section>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: 'var(--border)' }}>
        {saved && <span className="text-xs self-center" style={{ color: 'var(--success)' }}>✓ Saved!</span>}
        {saveError && <span className="text-xs self-center text-right" style={{ color: '#f87171', maxWidth: '60%' }}>⚠️ {saveError}</span>}
        <button className="btn-primary" onClick={handleSave} disabled={!!tokenError} style={tokenError ? { opacity: 0.4, cursor: 'not-allowed' } : {}}>Save</button>
      </div>
    </div>
  )
}