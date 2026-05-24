import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

let mermaidInitialized = false

function ensureInit(): void {
  if (mermaidInitialized) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
    fontFamily: 'inherit',
  })
  mermaidInitialized = true
}

interface Props {
  code: string
}

function normalizeMermaidCode(raw: string): string {
  let text = raw

  // Normalize escaped sequences often produced by LLM/tool payloads.
  text = text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\`/g, '`')

  // Remove line-continuation slashes and accidental escaped line endings.
  text = text
    .replace(/\\\s*\n/g, '\n')
    .replace(/[ \t]*\\$/gm, '')

  // Mermaid labels do not tolerate raw multiline text inside ["..."] well;
  // convert embedded newlines to <br/> for common generated payloads.
  text = text.replace(/\["([\s\S]*?)"\]/g, (_m, label: string) => {
    const cleaned = label
      .replace(/\s*\n\s*/g, '<br/>')
      .replace(/\s{2,}/g, ' ')
      .trim()
    return `["${cleaned}"]`
  })

  return text.trim()
}

export default function MermaidDiagram({ code }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ensureInit()
    let cancelled = false

    async function render(): Promise<void> {
      if (!containerRef.current) return
      try {
        const id = `mermaid-${Math.random().toString(36).slice(2)}`
        const { svg } = await mermaid.render(id, code)
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg
          setError(null)
        }
      } catch (err) {
        try {
          const normalized = normalizeMermaidCode(code)
          const id = `mermaid-${Math.random().toString(36).slice(2)}`
          const { svg } = await mermaid.render(id, normalized)
          if (!cancelled && containerRef.current) {
            containerRef.current.innerHTML = svg
            setError(null)
          }
        } catch (retryErr) {
          if (!cancelled) {
            setError(retryErr instanceof Error ? retryErr.message : String(retryErr))
          }
        }
      }
    }

    render()
    return () => { cancelled = true }
  }, [code])

  if (error) {
    return (
      <div className="code-block">
        <div className="code-block-header">
          <span className="code-lang">mermaid</span>
          <span style={{ color: 'var(--color-error, #f87171)', fontSize: '11px' }}>render error</span>
        </div>
        <pre><code>{code}</code></pre>
        <p style={{ color: 'var(--color-error, #f87171)', fontSize: '11px', margin: '4px 0 0' }}>{error}</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-diagram"
      style={{
        overflowX: 'auto',
        padding: '12px',
        borderRadius: '8px',
        background: 'var(--bg-secondary)',
        margin: '8px 0',
      }}
    />
  )
}
