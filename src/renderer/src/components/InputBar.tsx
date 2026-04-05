import { useRef, useState, useEffect, KeyboardEvent } from 'react'
import { useChatStore } from '../store/chatStore'
import { useSettingsStore } from '../store/settingsStore'
import { MODEL_GROUPS, modelLabel } from '../constants/models'

export default function InputBar(): JSX.Element {
  const [text, setText] = useState('')
  const { sendMessage, isLoading } = useChatStore()
  const { settings, saveSettings } = useSettingsStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Model picker state ────────────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return
    const handler = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pickerOpen])

  const handleModelSelect = async (value: string): Promise<void> => {
    setPickerOpen(false)
    if (value !== settings.copilotModel) {
      await saveSettings({ copilotModel: value })
    }
  }

  // ── Chat input handlers ───────────────────────────────────────────────────
  const handleSend = async (): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    await sendMessage(trimmed)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (): void => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }

  const currentLabel = modelLabel(settings.copilotModel ?? '')

  return (
    <div className="px-4 pt-2 pb-3 border-t" style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}>
      <div className="max-w-5xl mx-auto">
        {/* Unified input box — textarea + toolbar inside one container */}
        <div className="input-box">
          <textarea
            ref={textareaRef}
            placeholder="Ask Mimi anything… (Enter to send, Shift+Enter for newline)"
            rows={1}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            disabled={isLoading}
          />

          {/* Toolbar row — model picker + send button */}
          <div className="flex items-center gap-1 px-2 pb-1.5">
            <div ref={pickerRef} className="relative">
          {/* Pill button */}
          <button
            onClick={() => setPickerOpen(p => !p)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
            style={{
              color: 'var(--text-muted)',
              background: pickerOpen ? 'var(--surface-hover)' : 'transparent',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = pickerOpen ? 'var(--surface-hover)' : 'transparent')}
            title="Switch model"
          >
            <span style={{ fontSize: '11px', opacity: 0.6 }}>⬡</span>
            <span>{currentLabel}</span>
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none"
              style={{ transform: pickerOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 120ms' }}
            >
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Dropdown — opens upward */}
          {pickerOpen && (
            <div
              className="absolute bottom-full left-0 mb-1 w-56 rounded-lg shadow-xl border overflow-hidden z-50"
              style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
            >
              {MODEL_GROUPS.map(g => (
                <div key={g.group}>
                  <div
                    className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    {g.group}
                  </div>
                  {g.models.map(m => {
                    const active = m.value === settings.copilotModel
                    return (
                      <button
                        key={m.value}
                        onClick={() => handleModelSelect(m.value)}
                        className="w-full text-left px-3 py-1.5 text-sm flex items-center justify-between transition-colors"
                        style={{
                          color: active ? 'var(--accent)' : 'var(--text-primary)',
                          background: active ? 'var(--tool-bg)' : 'transparent',
                          fontWeight: active ? 600 : 400,
                        }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-hover)' }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                      >
                        <span>{m.label}</span>
                        {active && <span style={{ fontSize: '10px' }}>✓</span>}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

            {/* Send button — right end of toolbar */}
            <div className="ml-auto">
              <button
                onClick={handleSend}
                disabled={!text.trim() || isLoading}
                title="Send (Enter)"
                className="flex items-center justify-center h-8 w-8 rounded-lg transition-opacity"
                style={{
                  background: (!text.trim() || isLoading) ? 'var(--text-faint)' : 'var(--text-primary)',
                  color: 'var(--bg-primary)',
                  opacity: (!text.trim() || isLoading) ? 0.4 : 1,
                }}
              >
                {isLoading ? (
                  <span className="animate-spin text-sm leading-none">⟳</span>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7H12M12 7L7.5 2.5M12 7L7.5 11.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            </div>

          </div>{/* end toolbar */}
        </div>{/* end input-box */}
      </div>
    </div>
  )
}
