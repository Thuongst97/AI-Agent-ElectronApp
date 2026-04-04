import { useEffect } from 'react'
import { useChatStore } from '../store/chatStore'

interface Props {
  collapsed: boolean
  onToggle: () => void
  onSettings?: () => void
}

export default function HistoryView({ collapsed, onToggle, onSettings }: Props): JSX.Element {
  const { conversations, activeConversationId, loadHistory, setActiveConversation, deleteConversation, newConversation } =
    useChatStore()

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  return (
    <aside
      className="shrink-0 flex flex-col bg-[var(--bg-secondary)] border-r overflow-hidden"
      style={{
        borderColor: 'var(--border)',
        width: collapsed ? '44px' : '224px',
        transition: 'width 200ms ease',
        minWidth: collapsed ? '44px' : '224px',
      }}
    >
      {/* ── Collapsed strip ───────────────────────────────── */}
      {collapsed ? (
        <div className="flex flex-col items-center h-full py-3 gap-2">
          {/* Expand button */}
          <button
            onClick={onToggle}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            title="Expand sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* New chat icon */}
          <button
            onClick={() => newConversation()}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            title="New chat"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Settings icon */}
          <button
            onClick={onSettings}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            title="Settings (Ctrl+,)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M11.54 4.46l-1.41 1.41M4.95 11.54l-1.41 1.41" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      ) : (
        /* ── Expanded panel ───────────────────────────────── */
        <div className="flex flex-col h-full px-2 py-3">
          {/* Header row */}
          <div className="flex items-center gap-1 mb-2">
            <button
              className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm"
              onClick={() => newConversation()}
            >
              <span>+</span> New chat
            </button>
            {/* Collapse button */}
            <button
              onClick={onToggle}
              className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              title="Collapse sidebar"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          {/* Conversation list */}
          <div className="flex-1 flex flex-col gap-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="text-[11px] px-2 mt-2" style={{ color: 'var(--text-faint)' }}>No conversations yet</p>
            ) : (
              conversations.map(conv => (
                <div
                  key={conv.id}
                  className={`sidebar-item group relative ${conv.id === activeConversationId ? 'active' : ''}`}
                  onClick={() => setActiveConversation(conv.id)}
                >
                  <span className="flex-1 truncate text-xs">{conv.title}</span>
                  <button
                    className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all ml-1 text-xs"
                    style={{ color: 'var(--text-faint)' }}
                    title="Delete"
                    onClick={e => { e.stopPropagation(); deleteConversation(conv.id) }}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Bottom: settings */}
          <div className="flex flex-col pt-1">
            <button
              className="btn-ghost w-full text-sm text-left px-2 py-1"
              onClick={onSettings}
              title="Settings (Ctrl+,)"
            >
              ⚙︎ Settings
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
