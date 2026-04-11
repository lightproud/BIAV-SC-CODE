import { useState, useEffect, useCallback } from 'react'

export type Theme = 'dark' | 'light'
export type ThemeMode = 'light' | 'dark' | 'system'

function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(mode: ThemeMode): Theme {
  if (mode === 'system') return getSystemTheme()
  return mode
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem('bpt-theme-mode') as ThemeMode | null
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
    return 'system'
  })

  const [theme, setTheme] = useState<Theme>(() => resolveTheme(
    (localStorage.getItem('bpt-theme-mode') as ThemeMode) || 'system'
  ))

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode)
    localStorage.setItem('bpt-theme-mode', newMode)
  }, [])

  // Apply the resolved theme to <html>
  useEffect(() => {
    const resolved = resolveTheme(mode)
    setTheme(resolved)

    const root = document.documentElement
    if (resolved === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [mode])

  // Listen for browser-level prefers-color-scheme changes (web fallback)
  useEffect(() => {
    if (mode !== 'system') return

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => {
      const resolved: Theme = e.matches ? 'dark' : 'light'
      setTheme(resolved)
      const root = document.documentElement
      if (resolved === 'dark') {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
    }
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [mode])

  // Listen for Electron nativeTheme changes via IPC
  useEffect(() => {
    if (mode !== 'system') return
    if (!(window as any).bpt?.onSystemThemeChange) return

    const cleanup = (window as any).bpt.onSystemThemeChange((isDark: boolean) => {
      const resolved: Theme = isDark ? 'dark' : 'light'
      setTheme(resolved)
      const root = document.documentElement
      if (resolved === 'dark') {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
    })
    return cleanup
  }, [mode])

  return { theme, mode, setMode }
}
