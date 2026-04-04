import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Brain in a Vat',
  description: 'B.I.A.V. Studio AI Assistant',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh">
      <body className="bg-biav-bg text-biav-text antialiased">
        {children}
      </body>
    </html>
  )
}
