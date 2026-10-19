'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Loader2, CheckCheck, MessageSquare } from 'lucide-react'
import Button from '@/components/ui/Button'
import { textareaClass } from '@/components/ui/Input'
import { cn } from '@/lib/utils'

function formatTime(date) {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(date) {
  const d = new Date(date)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ChatInterface({ apiUrl, currentUserId, recipientName = 'Agency', placeholder = 'Type a message...' }) {
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const messagesEndRef = useRef(null)
  const pollRef = useRef(null)

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(apiUrl)
      if (!res.ok) throw new Error('Failed to load messages')
      const data = await res.json()
      setMessages(data.messages || [])
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [apiUrl])

  useEffect(() => {
    fetchMessages()
    pollRef.current = setInterval(fetchMessages, 10000)
    return () => clearInterval(pollRef.current)
  }, [fetchMessages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    const content = newMessage.trim()
    if (!content || sending) return

    setSending(true)
    setNewMessage('')

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error('Failed to send message')
      await fetchMessages()
    } catch (err) {
      setError(err.message)
      setNewMessage(content)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Group messages by date
  const groupedMessages = messages.reduce((groups, msg) => {
    const date = formatDate(msg.createdAt)
    if (!groups[date]) groups[date] = []
    groups[date].push(msg)
    return groups
  }, {})

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="flex h-full max-h-[700px] min-h-[500px] flex-col">
      {/* Chat header */}
      <div className="flex items-center gap-3 rounded-t-xl border-b border-gray-100 px-4 py-3">
        <div className="flex size-8 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-700">
          {recipientName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{recipientName}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Online
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4 scrollbar-thin">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-center text-sm text-red-700">
            {error}
          </div>
        )}

        {Object.keys(groupedMessages).length === 0 && !error && (
          <div className="flex h-full flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-gray-200/80 bg-white shadow-xs">
              <MessageSquare className="size-5 text-gray-500" />
            </div>
            <p className="text-sm font-semibold text-gray-900">No messages yet</p>
          </div>
        )}

        {Object.entries(groupedMessages).map(([date, msgs]) => (
          <div key={date}>
            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-gray-100" />
              <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">{date}</span>
              <div className="h-px flex-1 bg-gray-100" />
            </div>

            {msgs.map((msg) => {
              const isOwn = msg.senderId === currentUserId
              return (
                <div
                  key={msg.id}
                  className={cn('mb-3 flex', isOwn ? 'justify-end' : 'justify-start')}
                >
                  {!isOwn && (
                    <div className="mr-2 flex size-7 shrink-0 items-center justify-center self-end rounded-full bg-gray-100 text-[11px] font-semibold text-gray-600">
                      {(msg.sender?.name || 'A').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className={cn('flex max-w-[70%] flex-col', isOwn ? 'items-end' : 'items-start')}>
                    <div
                      className={cn(
                        'whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                        isOwn
                          ? 'rounded-br-md bg-gray-900 text-white'
                          : 'rounded-bl-md bg-gray-100 text-gray-900'
                      )}
                    >
                      {msg.content}
                    </div>
                    <span className="mt-1 flex items-center gap-1 text-[11px] text-gray-400">
                      {formatTime(msg.createdAt)}
                      {isOwn && msg.isRead && <CheckCheck className="size-3.5 text-gray-500" aria-label="Read" />}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="rounded-b-xl border-t border-gray-100 bg-white p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            title="Enter to send · Shift+Enter for a new line"
            rows={1}
            className={cn(textareaClass, 'max-h-32 min-h-9 flex-1 resize-none overflow-y-auto')}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!newMessage.trim() || sending}
            aria-label="Send message"
          >
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
      </div>
    </div>
  )
}
