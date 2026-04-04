import { useSettingsStore } from '../store/settingsStore'
import type { ConnectionState } from '@shared/ipc-types'

function Dot({ state }: { state: ConnectionState }): JSX.Element {
  return <span className={`status-dot ${state}`} />
}

export default function StatusBar({ onSettings }: { onSettings?: () => void }): JSX.Element {
  const { status } = useSettingsStore()

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 bg-[var(--bg-secondary)] border-t text-[11px] select-none" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
      {/* Settings button — bottom-left */}
      <button
        className="btn-ghost text-xs px-1.5 py-0.5"
        onClick={onSettings}
        title="Settings (Ctrl+,)"
      >
        ⚙ Settings
      </button>

      <span className="flex items-center gap-1.5">
        <Dot state={status?.llm ?? 'disconnected'} />
        LLM
      </span>
      <span className="flex items-center gap-1.5">
        <Dot state={status?.chromadb ?? 'disconnected'} />
        ChromaDB
      </span>
      <span className="ml-auto">v{status?.version ?? '…'}</span>
    </div>
  )
}
