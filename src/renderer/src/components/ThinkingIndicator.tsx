export default function ThinkingIndicator(): JSX.Element {
  return (
    <div className="flex justify-start mb-3">
      <span className="text-lg mr-2 mt-1 shrink-0" aria-hidden>🤖</span>
      <div className="bubble-assistant flex items-center gap-1.5 py-3 px-5">
        <span className="thinking-dot" />
        <span className="thinking-dot" />
        <span className="thinking-dot" />
      </div>
    </div>
  )
}
