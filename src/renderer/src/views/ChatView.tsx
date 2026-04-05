import { useEffect, useRef } from 'react'
import { useChatStore } from '../store/chatStore'
import MessageBubble from '../components/MessageBubble'
import ThinkingIndicator from '../components/ThinkingIndicator'
import InputBar from '../components/InputBar'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import type { Message } from '@shared/ipc-types'

const QUICK_PROMPTS: Record<string, string> = {
  'Analyze ticket':     'Please help me analyze a ticket. Describe what information a well-written ticket should contain and what questions to ask when reviewing it.',
  'Summary ticket':     'Please help me write a concise summary for a ticket. Explain what fields and information should be included in a good ticket summary.',
  'Review commit':      'I will provide commit link, please review it',
  'Make weekly report': 'Please help me structure a weekly engineering report. What sections should it include and what key information should be highlighted?',
  'Generate test case': 'Please help me generate test cases. Describe the structure of a good test case including preconditions, steps, expected results, and coverage criteria.',
}

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
      {/* Messages area — scrollable full-width, content centred */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 pt-6 pb-2">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4" style={{ color: 'var(--text-muted)' }}>
              <span className="text-6xl">🤖</span>
              <p className="text-lg font-semibold" style={{ color: 'var(--text-muted)' }}>Hello, I'm Mimi</p>
              <p className="text-sm max-w-sm">
                Your AI agent for requirements analysis, test generation and more.
                Ask me anything!
              </p>
              <div className="flex flex-col items-center gap-2 mt-2">
                <div className="flex gap-2">
                  {['Analyze ticket', 'Summary ticket', 'Review commit'].map(p => (
                    <QuickPrompt key={p} text={p} prompt={QUICK_PROMPTS[p]} />
                  ))}
                </div>
                <div className="flex gap-2">
                  {['Make weekly report', 'Generate test case'].map(p => (
                    <QuickPrompt key={p} text={p} prompt={QUICK_PROMPTS[p]} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Live streaming message */}
          {streamingMsg && (
            <div className="flex justify-start mb-6 gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm mt-0.5"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--accent)' }}>
                ✦
              </div>
              <div className="flex-1 min-w-0 prose-mimi">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {streamingMsg.content}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {/* Thinking indicator — shown before first token */}
          {isThinking && <ThinkingIndicator />}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <InputBar />
    </div>
  )
}

function QuickPrompt({ text, prompt }: { text: string; prompt: string }): JSX.Element {
  const { sendMessage } = useChatStore()
  return (
    <button
      className="text-sm font-semibold text-left rounded-lg px-3 py-2 transition-colors"
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
      onClick={() => sendMessage(prompt)}
    >
      {text}
    </button>
  )
}