import { useState, useEffect } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import type { AppSettings } from '@shared/ipc-types'
import { MODEL_GROUPS, ALL_KNOWN_VALUES, CUSTOM_SENTINEL, REASONING_MODELS } from '../constants/models'

export default function SettingsView({ onClose }: { onClose: () => void }): JSX.Element {
  const { settings, loadSettings, saveSettings } = useSettingsStore()
  const [form, setForm] = useState<AppSettings>(settings)
  const [saved, setSaved] = useState(false)
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
        <button className="btn-primary" onClick={handleSave}>Save</button>
      </div>
    </div>
  )
}