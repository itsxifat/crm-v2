import './globals.css'
import { Inter } from 'next/font/google'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import Providers from '@/components/providers/Providers'

const inter = Inter({
  subsets:  ['latin'],
  variable: '--font-inter',
  display:  'swap',
})

export const metadata = {
  title: {
    default:  process.env.NEXT_PUBLIC_APP_NAME ?? 'Enfinito',
    template: `%s | ${process.env.NEXT_PUBLIC_APP_NAME ?? 'Enfinito'}`,
  },
  description: 'Enfinito CRM – Manage clients, projects, freelancers, invoices and more.',
  keywords:    ['CRM', 'Agency', 'Project Management', 'Invoicing', 'Freelancer'],
  authors:     [{ name: 'Enfinito' }],
  creator:     'Enfinito',
  icons: {
    icon: '/en-icon.png',
    apple: '/en-icon.png',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#3B82F6',
}

export default async function RootLayout({ children }) {
  const session = await getServerSession(authOptions)

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers session={session}>
          {children}
        </Providers>
      </body>
    </html>
  )
}
