import { useState, useEffect } from 'react'

export default function UpdateNotice() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [updateDownloaded, setUpdateDownloaded] = useState(false)
  const [version, setVersion] = useState('')
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    const offAvailable = window.biav.onUpdateAvailable((info) => {
      setVersion(info.version)
      setUpdateAvailable(true)
    })

    const offDownloaded = window.biav.onUpdateDownloaded(() => {
      setUpdateDownloaded(true)
      setDownloading(false)
    })

    return () => {
      offAvailable()
      offDownloaded()
    }
  }, [])

  if (!updateAvailable) return null

  function handleDownload() {
    setDownloading(true)
    window.biav.downloadUpdate()
  }

  function handleInstall() {
    window.biav.installUpdate()
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-biav-gold/10 border border-biav-gold/30 px-4 py-3 text-sm text-biav-gold shadow-lg backdrop-blur">
      {updateDownloaded ? (
        <div className="flex items-center gap-3">
          <span>更新已下载，重启后生效</span>
          <button
            onClick={handleInstall}
            className="rounded bg-biav-gold/20 px-3 py-1 text-biav-gold hover:bg-biav-gold/30 transition-colors"
          >
            立即重启
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span>新版本可用 {version && `(v${version})`}</span>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="rounded bg-biav-gold/20 px-3 py-1 text-biav-gold hover:bg-biav-gold/30 transition-colors disabled:opacity-50"
          >
            {downloading ? '下载中...' : '下载'}
          </button>
        </div>
      )}
    </div>
  )
}
