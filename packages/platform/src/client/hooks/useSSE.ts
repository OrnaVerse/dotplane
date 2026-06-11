import { useCallback, useEffect, useRef, useState } from 'react'
import { getSseUrl } from '../lib/api'

export interface UseSSEOptions {
  enabled?: boolean
  onEvent: (data: unknown) => void
  onError?: (error: Error) => void
  onOpen?: () => void
  onClose?: () => void
}

export function useSSE(path: string, options: UseSSEOptions): {
  connected: boolean
  close: () => void
} {
  const { enabled = true, onEvent, onError, onOpen, onClose } = options
  const [connected, setConnected] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)
  const callbacksRef = useRef({ onEvent, onError, onOpen, onClose })

  callbacksRef.current = { onEvent, onError, onOpen, onClose }

  const close = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
    setConnected(false)
  }, [])

  useEffect(() => {
    if (!enabled) {
      close()
      return
    }

    const token = localStorage.getItem('dotplane_access_token')
    const url = new URL(getSseUrl(path), window.location.origin)
    if (token) {
      url.searchParams.set('token', token)
    }

    const source = new EventSource(url.toString(), { withCredentials: true })
    sourceRef.current = source

    source.onopen = () => {
      setConnected(true)
      callbacksRef.current.onOpen?.()
    }

    source.onmessage = (event: MessageEvent<string>) => {
      try {
        callbacksRef.current.onEvent(JSON.parse(event.data))
      } catch {
        callbacksRef.current.onEvent(event.data)
      }
    }

    source.onerror = () => {
      setConnected(false)
      callbacksRef.current.onError?.(new Error('SSE connection error'))
    }

    return () => {
      source.close()
      sourceRef.current = null
      setConnected(false)
      callbacksRef.current.onClose?.()
    }
  }, [path, enabled, close])

  return { connected, close }
}
