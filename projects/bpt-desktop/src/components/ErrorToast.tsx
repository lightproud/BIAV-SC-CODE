import { useState, useEffect } from 'react'

interface ErrorToastProps {
  message: string
  type: 'error' | 'warning'
  onDismiss?: () => void
}

export default function ErrorToast({ message, type, onDismiss }: ErrorToastProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false)
      onDismiss?.()
    }, 5000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  if (!visible) return null

  const accent = type === 'error'
    ? 'border-bpt-danger bg-bpt-danger/10 text-bpt-danger'
    : 'border-bpt-gold bg-bpt-gold/10 text-bpt-gold'

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur transition-opacity ${accent}`}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <span className="flex-1">{message}</span>
        <button
          onClick={() => { setVisible(false); onDismiss?.() }}
          className="ml-2 opacity-60 hover:opacity-100 transition-opacity"
          aria-label="关闭"
        >
          &times;
        </button>
      </div>
    </div>
  )
}
