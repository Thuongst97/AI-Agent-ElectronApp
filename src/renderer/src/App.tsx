import { useEffect, useState } from 'react'
import TitleBar from './components/TitleBar'
import ChatView from './views/ChatView'
import HistoryView from './views/HistoryView'
import SettingsView from './views/SettingsView'
import { useChatStore } from './store/chatStore'
import { useSettingsStore } from './store/settingsStore'

type ActiveView = 'chat' | 'settings'

export default function App(): JSX.Element {
  const [view, setView] = useState<ActiveView>('chat')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { newConversation, loadHistory } = useChatStore()
  const { loadSettings, refreshStatus, settings } = useSettingsStore()

  // Apply theme to <html> whenever the setting changes
  useEffect(() => {
    const root = document.documentElement
    const pref = settings.theme
    if (pref === 'system') {
      const sys = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
      root.setAttribute('data-theme', sys)
    } else {
      root.setAttribute('data-theme', pref)
    }
  }, [settings.theme])

  // Bootstrap on mount
  useEffect(() => {
    loadSettings()
    refreshStatus()
    loadHistory()
    newConversation()

    // Keyboard shortcuts
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key === 'n') { e.preventDefault(); newConversation() }
      if (e.ctrlKey && e.key === ',') { e.preventDefault(); setView('settings') }
      if (e.key === 'Escape' && view === 'settings') setView('chat')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)]">
      {/* Custom title bar */}
      <TitleBar />

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {view === 'chat' && (
          <>
            {/* Sidebar */}
            <HistoryView
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed(c => !c)}
              onSettings={() => setView('settings')}
            />

            {/* Main chat */}
            <main className="flex-1 flex flex-col overflow-hidden">

              <ChatView />
            </main>
          </>
        )}

        {view === 'settings' && (
          <div className="flex-1 overflow-hidden">
            <SettingsView onClose={() => setView('chat')} />
          </div>
        )}
      </div>


    </div>
  )
}
