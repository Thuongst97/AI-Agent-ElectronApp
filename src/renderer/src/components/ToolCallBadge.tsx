import { useState } from 'react'
import { Message } from '@shared/ipc-types'

interface Props {
  message: Message
}

export default function ToolCallBadge({ message }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false)

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
