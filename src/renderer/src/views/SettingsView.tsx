import { useState, useEffect } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import type { AppSettings } from '@shared/ipc-types'

function IconDatabase(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4.03 3-9 3S3 13.66 3 12" />
      <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
    </svg>
  )
}

function IconClose(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function IconJira(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 12h4m0 0 3-3m-3 3 3 3" />
    </svg>
  )
}

export default function SettingsView({ onClose }: { onClose: () => void }): JSX.Element {
  const { settings, loadSettings, saveSettings } = useSettingsStore()
  const [form, setForm] = useState<AppSettings>(settings)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    loadSettings().then(() => {
      setForm(settings)
    })
  }, [])

  const handleSave = async (): Promise<void> => {
    setSaveError('')
    try {
      await saveSettings(form)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setSaveError(String(err).replace(/^Error:\s*/, ''))
    }
  }

  const isDirty =
    form.chromaHost   !== settings.chromaHost  ||
    form.chromaPort   !== settings.chromaPort  ||
    form.jiraDomain   !== settings.jiraDomain  ||
    form.jiraEmail    !== settings.jiraEmail   ||
    form.jiraToken    !== settings.jiraToken

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>Settings</h2>
        </div>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-7 h-7 rounded-md transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          title="Close"
        >
          <IconClose />
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* ChromaDB Card */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
          {/* Card header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <span style={{ color: 'var(--accent)' }}><IconDatabase /></span>
            <div>
              <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>Vector Database</p>
              <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>ChromaDB connection settings</p>
            </div>
          </div>

          {/* Rows */}
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {/* Host row */}
            <div className="flex items-center justify-between gap-6 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>Host</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>Hostname or IP address of your ChromaDB instance</p>
              </div>
              <input
                type="text"
                className="input-bar text-sm py-1.5 w-48 shrink-0"
                value={form.chromaHost ?? ''}
                onChange={e => setForm(f => ({ ...f, chromaHost: e.target.value }))}
                placeholder="localhost"
              />
            </div>

            {/* Port row */}
            <div className="flex items-center justify-between gap-6 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>Port</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>TCP port ChromaDB is listening on</p>
              </div>
              <input
                type="number"
                className="input-bar text-sm py-1.5 w-28 shrink-0"
                value={form.chromaPort ?? ''}
                onChange={e => setForm(f => ({ ...f, chromaPort: Number(e.target.value) }))}
                placeholder="8000"
              />
            </div>
          </div>
        </div>

        {/* Jira Card */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
          {/* Card header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <span style={{ color: 'var(--accent)' }}><IconJira /></span>
            <div>
              <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>Jira Integration</p>
              <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>Fetch and analyze Jira tickets with the agent</p>
            </div>
          </div>

          {/* Rows */}
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {/* Domain */}
            <div className="flex items-center justify-between gap-6 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>Domain</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>Your Atlassian domain, e.g. mycompany.atlassian.net</p>
              </div>
              <input
                type="text"
                className="input-bar text-sm py-1.5 w-56 shrink-0"
                value={form.jiraDomain ?? ''}
                onChange={e => setForm(f => ({ ...f, jiraDomain: e.target.value }))}
                placeholder="mycompany.atlassian.net"
              />
            </div>

            {/* Email */}
            <div className="flex items-center justify-between gap-6 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>Email</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>Atlassian account email used to authenticate</p>
              </div>
              <input
                type="email"
                className="input-bar text-sm py-1.5 w-56 shrink-0"
                value={form.jiraEmail ?? ''}
                onChange={e => setForm(f => ({ ...f, jiraEmail: e.target.value }))}
                placeholder="you@example.com"
              />
            </div>

            {/* API Token */}
            <div className="flex items-center justify-between gap-6 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>API Token</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>Generate at id.atlassian.com → Security → API tokens</p>
              </div>
              <input
                type="password"
                className="input-bar text-sm py-1.5 w-56 shrink-0"
                value={form.jiraToken ?? ''}
                onChange={e => setForm(f => ({ ...f, jiraToken: e.target.value }))}
                placeholder="ATATT3x…"
              />
            </div>
          </div>
        </div>

      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-6 py-3 border-t"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}
      >
        <div className="text-xs h-5 flex items-center">
          {saved && (
            <span className="flex items-center gap-1.5" style={{ color: 'var(--success)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              Changes saved
            </span>
          )}
          {saveError && (
            <span className="flex items-center gap-1.5" style={{ color: '#f87171' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01" /></svg>
              {saveError}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost text-sm px-3 py-1.5"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="btn-primary text-sm px-4 py-1.5 disabled:opacity-40"
            onClick={handleSave}
            disabled={!isDirty}
          >
            Save changes
          </button>
        </div>
      </div>

    </div>
  )
}