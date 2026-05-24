import { useState } from 'react'
import { Message } from '@shared/ipc-types'
import MermaidDiagram from './MermaidDiagram'

interface Props {
  message: Message
}

function findMermaidInText(content: string): string | null {
  const fencedMatch = content.match(/```mermaid[^\S\r\n]*\r?\n([\s\S]*?)```/i)
  if (fencedMatch) return fencedMatch[1].trim()

  const plainSource = content.trim()
  const looksLikeMermaid = /^(graph|flowchart|sequenceDiagram|classDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|stateDiagram(?:-v2)?|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/m.test(plainSource)
  return looksLikeMermaid ? plainSource : null
}

function findMermaidInUnknown(value: unknown): string | null {
  if (typeof value === 'string') return findMermaidInText(value)

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMermaidInUnknown(item)
      if (found) return found
    }
    return null
  }

  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const found = findMermaidInUnknown(nested)
      if (found) return found
    }
  }

  return null
}

/** Extract the mermaid source from a ```mermaid … ``` fence, if present. */
function extractMermaidCode(content: string): string | null {
  const direct = findMermaidInText(content)
  if (direct) return direct

  const unescaped = content
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\`/g, '`')

  const fromEscaped = findMermaidInText(unescaped)
  if (fromEscaped) return fromEscaped

  try {
    return findMermaidInUnknown(JSON.parse(content))
  } catch {
    return null
  }
}

export default function ToolCallBadge({ message }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  const isToolMessage = message.role === 'tool'
  const mermaidCode = isToolMessage ? extractMermaidCode(message.content) : null

  if (isToolMessage && mermaidCode) {
    return (
      <div className="mb-3">
        <div
          className="bubble-tool cursor-pointer mb-2"
          onClick={() => setExpanded(e => !e)}
        >
          <div className="flex items-center gap-2">
            <span className="text-brand-400">⚡</span>
            <span className="text-slate-300 font-semibold">{message.toolName ?? 'tool'}</span>
            <span className="ml-auto text-slate-500">{expanded ? '▲ hide source' : '▼ show source'}</span>
          </div>
          {expanded && (
            <pre className="mt-2 text-slate-400 whitespace-pre-wrap overflow-x-auto text-xs">
              {mermaidCode}
            </pre>
          )}
        </div>
        <MermaidDiagram code={mermaidCode} />
      </div>
    )
  }

  return (
    <div className="bubble-tool mb-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
      <div className="flex items-center gap-2">
        <span className="text-brand-400">⚡</span>
        <span className="text-slate-300 font-semibold">
          {message.toolName ?? 'tool'}
        </span>
        <span className="ml-auto text-slate-500">{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <pre className="mt-2 text-slate-400 whitespace-pre-wrap overflow-x-auto">
          {message.content}
        </pre>
      )}
    </div>
  )
}
