import { useEffect } from 'react'

type ShortcutMap = Record<string, (e: KeyboardEvent) => void>

/**
 * Register global keyboard shortcuts.
 * Keys use a canonical format: modifier+key, e.g. "mod+n", "mod+shift+b".
 * "mod" maps to Meta (Cmd) on macOS and Ctrl elsewhere.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().includes('MAC')

    function handler(e: KeyboardEvent) {
      const mod = isMac ? e.metaKey : e.ctrlKey
      const parts: string[] = []
      if (mod) parts.push('mod')
      if (e.shiftKey) parts.push('shift')
      if (e.altKey) parts.push('alt')

      // Normalize the key to lowercase
      const key = e.key.toLowerCase()
      parts.push(key)

      const combo = parts.join('+')

      const cb = shortcuts[combo]
      if (cb) {
        e.preventDefault()
        e.stopPropagation()
        cb(e)
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [shortcuts])
}
