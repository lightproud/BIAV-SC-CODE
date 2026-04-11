import { useState, useCallback } from 'react'
import { t as translate, setLocale as setI18nLocale, getLocale, supportedLocales } from '../lib/i18n'

/**
 * Hook that provides i18n utilities and triggers re-render on locale change.
 */
export function useLocale() {
  const [locale, _setLocale] = useState(getLocale)

  const setLocale = useCallback((newLocale: string) => {
    setI18nLocale(newLocale)
    _setLocale(newLocale)
  }, [])

  // t is stable for a given locale — re-renders when locale changes via the state above
  const t = useCallback(
    (key: string) => translate(key),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  )

  return { locale, setLocale, t, supportedLocales }
}
