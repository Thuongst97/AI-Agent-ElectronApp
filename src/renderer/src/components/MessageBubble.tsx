import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import { Message } from '@shared/ipc-types'
import ToolCallBadge from './ToolCallBadge'

interface Props {
  message: Message
}

export default function MessageBubble({ message }: Props): JSX.Element {
  if (message.role === 'tool') {
    return <ToolCallBadge message={message} />
  }

  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && (
        <span className="text-lg mr-2 mt-1 shrink-0" aria-hidden>🤖</span>
      )}
      <div className={isUser ? 'bubble-user' : 'bubble-assistant prose-mimi'}>
        {isUser ? (
          <p className="m-0 whitespace-pre-wrap">{message.content}</p>
        ) : (
          <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
            {message.content}
          </ReactMarkdown>
        )}
        <time className="block text-right text-[10px] opacity-40 mt-1">
          {new Date(message.createdAt).toLocaleTimeString()}
        </time>
      </div>
      {isUser && (
        <span className="text-lg ml-2 mt-1 shrink-0" aria-hidden>👤</span>
      )}
    </div>
  )
}
