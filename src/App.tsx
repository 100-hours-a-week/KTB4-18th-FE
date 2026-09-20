import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { recommend } from './api/recommendations'
import { RecommendationCards } from './components/RecommendationCards'
import type { Recommendation } from './types/recommendation'
import './App.css'

type ChatMessage = { id: string; sentAt: Date } & (
  { role: 'user'; text: string } | { role: 'assistant'; result: Recommendation }
)
const formatTime = (date: Date) => date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })

function App() {
  const [conversationKey] = useState(() => crypto.randomUUID())
  const [openedAt] = useState(() => new Date())
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activePreview, setActivePreview] = useState<string | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => () => requestRef.current?.abort(), [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading, error])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = prompt.trim()
    if (!text || requestRef.current) return
    const controller = new AbortController()
    const messageId = crypto.randomUUID()
    requestRef.current = controller
    setLoading(true)
    setError('')
    setActivePreview(null)
    setMessages(previous => [...previous, { id: messageId, role: 'user', text, sentAt: new Date() }])
    setPrompt('')
    try {
      const result = await recommend(text, conversationKey, controller.signal)
      setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'assistant', result, sentAt: new Date() }])
    } catch (caught) {
      if (!controller.signal.aborted) {
        setMessages(previous => previous.filter(message => message.id !== messageId))
        setError(caught instanceof Error ? caught.message : '서버에 연결하지 못했습니다.')
        setPrompt(text)
      }
    } finally {
      requestRef.current = null
      if (!controller.signal.aborted) { setLoading(false); inputRef.current?.focus() }
    }
  }

  return <main className="chat-app">
    <header className="chat-header"><h1>음악 추천 챗봇</h1></header>
    <div className="chat-content" role="log" aria-label="음악 추천 대화" aria-live="polite">
      <p className="date-label">{openedAt.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
      <div className="message-row assistant-row">
        <div className="welcome-bubble">
          <p>지금의 순간에 음악을 더해볼까요?</p>
          <p>느껴지는 분위기나 장소, 날씨를 편하게 들려주세요.</p>
          <p>이 순간에 어울리는 음악을 골라드릴게요.</p>
          <p className="sample-notice">현재는 입력 문장으로 iTunes에서 음악을 검색합니다. 입력 문장은 연속 추천을 위해 대화별로 저장합니다.</p>
        </div><time>{formatTime(openedAt)}</time>
      </div>
      {messages.map(message => <div key={message.id} className={`message-row ${message.role === 'user' ? 'user-row' : 'assistant-row'}`}>
        {message.role === 'user' ? <p className="user-bubble">{message.text}</p>
          : <RecommendationCards recommendation={message.result} activePreview={activePreview} onPreviewChange={setActivePreview} />}
        <time dateTime={message.sentAt.toISOString()}>{formatTime(message.sentAt)}</time>
      </div>)}
      {loading && <p className="status-message" role="status">음악을 고르고 있어요…</p>}
      {error && <p role="alert" className="error-message">{error} 입력창에서 다시 전송할 수 있습니다.</p>}
      <div ref={bottomRef} />
    </div>
    <form className="input-bar" onSubmit={submit}>
      <label className="sr-only" htmlFor="prompt">추천받고 싶은 상황</label>
      <textarea ref={inputRef} id="prompt" placeholder="메시지를 입력하세요…" rows={1} maxLength={1000}
        value={prompt} onChange={event => setPrompt(event.target.value)} disabled={loading}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} />
      <button className="send-button" type="submit" disabled={loading || !prompt.trim()} aria-label="추천 요청 보내기">↑</button>
    </form>
  </main>
}

export default App
