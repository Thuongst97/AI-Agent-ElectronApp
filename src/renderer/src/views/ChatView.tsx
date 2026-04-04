import { useEffect, useRef } from 'react'
import { useChatStore } from '../store/chatStore'
import MessageBubble from '../components/MessageBubble'
import ThinkingIndicator from '../components/ThinkingIndicator'
import InputBar from '../components/InputBar'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import type { Message } from '@shared/ipc-types'

export default function ChatView(): JSX.Element {
  const { messages, isThinking, streamingContent } = useChatStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom whenever messages or stream changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, isThinking])

  // Build a synthetic streaming message to show partial content live
  const streamingMsg: Message | null = streamingContent
    ? {
        id:        '__streaming__',
        role:      'assistant',
        content:   streamingContent,
        createdAt: new Date().toISOString(),
      }
    : null

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4" style={{ color: 'var(--text-muted)' }}>
            <span className="text-6xl">🤖</span>
            <p className="text-lg font-semibold" style={{ color: 'var(--text-muted)' }}>Hello, I'm Mimi</p>
            <p className="text-sm max-w-sm">
              Your AI agent for requirements analysis, test generation and more.
              Ask me anything!
            </p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {[
                'Show all power requirements',
                'How many requirements are there?',
                'Explain Core_01140',
                'Generate tests for APP_01010',
              ].map(prompt => (
                <QuickPrompt key={prompt} text={prompt} />
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Live streaming message */}
        {streamingMsg && (
          <div className="flex justify-start mb-3">
            <span className="text-lg mr-2 mt-1 shrink-0">🤖</span>
            <div className="bubble-assistant prose-mimi">
              <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
                {streamingMsg.content}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {/* Thinking indicator — shown before first token */}
        {isThinking && <ThinkingIndicator />}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <InputBar />
    </div>
  )
}

function QuickPrompt({ text }: { text: string }): JSX.Element {
  const { sendMessage } = useChatStore()
  return (
    <button
      className="text-xs text-left rounded-lg px-3 py-2 transition-colors"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        color: 'var(--text-muted)',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'
        ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--text-faint)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)'
        ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'
      }}
      onClick={() => sendMessage(text)}
    >
      {text}
    </button>
  )
}
