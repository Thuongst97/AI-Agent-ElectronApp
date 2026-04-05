/** Custom frameless title bar with window controls */
interface WindowControls {
  minimize: () => void
  maximize: () => void
  close:    () => void
}
declare const window: Window & { windowControls: WindowControls }

export default function TitleBar(): JSX.Element {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
  
  return (
    <div className={`titlebar-drag flex items-center h-9 px-4 bg-[var(--bg-secondary)] border-b select-none ${isMac ? 'justify-center' : 'justify-between'}`} style={{ borderColor: 'var(--border)' }}>
      {/* App identity - centered on Mac, left on others */}
      <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>
        🤖 AI Work Assistant
      </span>

      {/* Window controls - only show on Windows/Linux */}
      {!isMac && <div className="titlebar-no-drag flex items-center gap-1">
        <button
          onClick={() => window.windowControls.minimize()}
          className="w-7 h-7 flex items-center justify-center rounded transition-colors text-lg leading-none" style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = ''; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)' }}
          title="Minimise"
        >
          ─
        </button>
        <button
          onClick={() => window.windowControls.maximize()}
          className="w-7 h-7 flex items-center justify-center rounded transition-colors text-base" style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = ''; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)' }}
          title="Maximise / Restore"
        >
          □
        </button>
        <button
          onClick={() => window.windowControls.close()}
          className="w-7 h-7 flex items-center justify-center rounded transition-colors text-base" style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#dc2626'; (e.currentTarget as HTMLButtonElement).style.color = 'white' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = ''; (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)' }}
          title="Close"
        >
          ✕
        </button>
      </div>}
    </div>
  )
}
