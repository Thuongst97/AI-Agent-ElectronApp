import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { Message } from '@shared/ipc-types'
import ToolCallBadge from './ToolCallBadge'
import type { Components } from 'react-markdown'

interface Props {
  message: Message
}

function CopyButton({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className="copy-btn"
      title="Copy code"
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M2 6.5l3 3 6-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <rect x="4" y="1" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M1 4v7.5A1.5 1.5 0 002.5 13H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      )}
      <span>{copied ? 'Copied!' : 'Copy'}</span>
    </button>
  )
}

const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const isBlock = className?.startsWith('language-')
    const lang = className?.replace('language-', '') ?? ''
    const text = String(children).replace(/\n$/, '')
    if (isBlock) {
      return (
        <div className="code-block">
          <div className="code-block-header">
            <span className="code-lang">{lang || 'code'}</span>
            <CopyButton text={text} />
          </div>
          <pre><code className={className} {...props}>{children}</code></pre>
        </div>
      )
    }
    return <code className="inline-code" {...props}>{children}</code>
  },
}

export default function MessageBubble({ message }: Props): JSX.Element {
  if (message.role === 'tool') {
    return <ToolCallBadge message={message} />
  }

  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="group flex justify-end mb-5">
        <div className="flex flex-col items-end gap-1">
          <div className="bubble-user">
            <p className="m-0 whitespace-pre-wrap leading-relaxed">{message.content}</p>
          </div>
          <time className="text-[11px] opacity-0 group-hover:opacity-40 transition-opacity pr-1"
            style={{ color: 'var(--text-muted)' }}>
            {new Date(message.createdAt).toLocaleTimeString()}
          </time>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start mb-6 gap-3">
      {/* Avatar */}
      <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm mt-0.5"
        style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)' }}>
        ✦
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 prose-mimi">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={markdownComponents}
        >
          {message.content}
        </ReactMarkdown>
        <time className="block text-[10px] mt-2 opacity-40">
          {new Date(message.createdAt).toLocaleTimeString()}
        </time>
      </div>
    </div>
  )
}
