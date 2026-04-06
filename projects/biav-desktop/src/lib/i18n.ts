import zh from './locales/zh'
import en from './locales/en'
import ja from './locales/ja'

type Messages = Record<string, Record<string, string>>

const messages: Messages = { zh, en, ja }

const STORAGE_KEY = 'biav-locale'

let currentLocale: string =
  (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) || 'zh'

/** Translate a key using the current locale. Falls back to zh, then returns the key itself. */
export function t(key: string): string {
  return messages[currentLocale]?.[key] ?? messages.zh[key] ?? key
}

export function setLocale(locale: string): void {
  if (!messages[locale]) return
  currentLocale = locale
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, locale)
  }
}

export function getLocale(): string {
  return currentLocale
}

export const supportedLocales = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
] as const
