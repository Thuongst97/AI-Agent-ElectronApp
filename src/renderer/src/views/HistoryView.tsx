import { useEffect, useState } from 'react'
import { useChatStore } from '../store/chatStore'
import { useSettingsStore } from '../store/settingsStore'

interface Props {
  collapsed: boolean
  onToggle: () => void
  onSettings?: () => void
}

/* ── Icon helpers ──────────────────────────────────────────────────────── */
function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M11.89 4.11l-1.06 1.06M4.17 11.83l-1.06 1.06" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}
function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M13.5 10.5A6 6 0 015.5 2.5a6 6 0 108 8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function IconMonitor() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="2" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M5 14h6M8 12v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

type Theme = 'light' | 'dark' | 'system'
const THEME_CYCLE: Theme[] = ['dark', 'light', 'system']
const THEME_LABELS: Record<Theme, string> = { dark: 'Dark', light: 'Light', system: 'System' }

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'light') return <IconSun />
  if (theme === 'dark')  return <IconMoon />
  return <IconMonitor />
}

function IconMenu() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  )
}
function IconSearch() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
      <circle cx="7.5" cy="7.5" r="5" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M11.5 11.5l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  )
}
function IconEditChat() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
      <rect x="2" y="2" width="13" height="13" rx="3" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M6 9.5l1.5-1.5 3-3 1.5 1.5-3 3-1.5 1.5H6v-1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
    </svg>
  )
}
function IconStar() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
      <path d="M8.5 2l1.6 4.9H15l-4.1 3 1.6 4.9L8.5 12l-4 2.9 1.6-4.9L2 7h4.9z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  )
}
function IconSettings() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M6.5 1.5h3l.5 1.5a5 5 0 011.2.7l1.5-.5 1.5 2.6-1.2 1.1a5 5 0 010 1.4l1.2 1.1-1.5 2.6-1.5-.5a5 5 0 01-1.2.7L9.5 14.5h-3l-.5-1.5A5 5 0 014.8 12.3l-1.5.5L1.8 10.2 3 9.1a5 5 0 010-1.4L1.8 6.6l1.5-2.6 1.5.5A5 5 0 015.9 3.2L6.5 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}

/* ── Icon button shared style ──────────────────────────────────────────── */
function IconBtn({
  onClick,
  title,
  children,
  active,
}: {
  onClick?: () => void
  title: string
  children: React.ReactNode
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors shrink-0"
      style={{ color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
  )
}

export default function HistoryView({ collapsed, onToggle, onSettings }: Props): JSX.Element {
  const { conversations, activeConversationId, loadHistory, setActiveConversation, deleteConversation, newConversation } =
    useChatStore()
  const { settings, saveSettings } = useSettingsStore()
  const currentTheme = (settings.theme ?? 'dark') as Theme
  const nextTheme = THEME_CYCLE[(THEME_CYCLE.indexOf(currentTheme) + 1) % THEME_CYCLE.length]
  const [historyOpen, setHistoryOpen] = useState(true)

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  /* ── Collapsed strip ──────────────────────────────────────── */
  if (collapsed) {
    return (
      <aside
        className="shrink-0 flex flex-col items-center border-r py-3 gap-1"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--bg-secondary)',
          width: '48px',
          minWidth: '48px',
          transition: 'width 200ms ease',
        }}
      >
        {/* Hamburger — expands the sidebar */}
        <IconBtn onClick={onToggle} title="Expand sidebar">
          <IconMenu />
        </IconBtn>

        {/* New chat */}
        <IconBtn onClick={() => newConversation()} title="New chat">
          <IconEditChat />
        </IconBtn>

        {/* My content (history toggle) */}
        <IconBtn onClick={() => setHistoryOpen(v => !v)} title="My content" active={historyOpen}>
          <IconStar />
        </IconBtn>

        <div className="flex-1" />

        {/* Theme cycle */}
        <IconBtn
          onClick={() => saveSettings({ theme: nextTheme })}
          title={`Switch to ${THEME_LABELS[nextTheme]} mode`}
        >
          <ThemeIcon theme={currentTheme} />
        </IconBtn>

        {/* Settings */}
        <IconBtn onClick={onSettings} title="Settings (Ctrl+,)">
          <IconSettings />
        </IconBtn>
      </aside>
    )
  }

  /* ── Expanded panel ───────────────────────────────────────── */
  return (
    <aside
      className="shrink-0 flex flex-col border-r overflow-hidden"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--bg-secondary)',
        width: '240px',
        minWidth: '240px',
        transition: 'width 200ms ease',
      }}
    >
      {/* ── Top header row: hamburger | spacer | search ── */}
      <div
        className="flex items-center px-3 py-2 gap-1"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <IconBtn onClick={onToggle} title="Collapse sidebar">
          <IconMenu />
        </IconBtn>
        <div className="flex-1" />
        <IconBtn title="Search conversations">
          <IconSearch />
        </IconBtn>
      </div>

      {/* ── Action rows ── */}
      <div className="flex flex-col px-2 pt-2 gap-0.5">
        {/* New chat */}
        <button
          onClick={() => newConversation()}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl w-full text-sm text-left transition-colors"
          style={{ color: 'var(--text-primary)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ color: 'var(--text-muted)' }}><IconEditChat /></span>
          <span className="font-medium">New chat</span>
        </button>

        {/* My content / history */}
        <button
          onClick={() => setHistoryOpen(v => !v)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl w-full text-sm text-left transition-colors"
          style={{ color: 'var(--text-primary)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ color: 'var(--text-muted)' }}><IconStar /></span>
          <span className="font-medium flex-1">Conversation History</span>
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            style={{
              color: 'var(--text-faint)',
              transform: historyOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 150ms',
            }}
          >
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* ── Conversation list (collapsible) ── */}
      {historyOpen && (
        <div className="flex-1 flex flex-col gap-0.5 overflow-y-auto px-2 pt-1 pb-2">
          {conversations.length === 0 ? (
            <p className="text-[11px] px-3 mt-2" style={{ color: 'var(--text-faint)' }}>
              No conversations yet
            </p>
          ) : (
            conversations.map(conv => (
              <div
                key={conv.id}
                className={`sidebar-item group relative ${conv.id === activeConversationId ? 'active' : ''}`}
                onClick={() => setActiveConversation(conv.id)}
              >
                  <span className="flex-1 truncate">{conv.title}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all ml-1 text-[10px]"
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
      )}

      {!historyOpen && <div className="flex-1" />}

      {/* ── Bottom: settings + theme toggle ── */}
      <div
        className="px-2 py-2 flex items-center gap-1"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <button
          className="flex items-center gap-3 px-3 py-2 rounded-xl flex-1 text-sm text-left transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onClick={onSettings}
          title="Settings (Ctrl+,)"
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <IconSettings />
          <span className="font-medium">Settings</span>
        </button>

        {/* Theme cycle button */}
        <button
          onClick={() => saveSettings({ theme: nextTheme })}
          title={`Switch to ${THEME_LABELS[nextTheme]} mode`}
          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <ThemeIcon theme={currentTheme} />
        </button>
      </div>
    </aside>
  )
}
