import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import connectDB from '@/lib/mongodb'
import { Freelancer } from '@/models'
import FreelancerShell from './FreelancerShell'

export const metadata = { title: 'Freelancer Portal' }

export default async function FreelancerLayout({ children }) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.role !== 'FREELANCER') {
    redirect('/login')
  }

  await connectDB()
  const profile = await Freelancer.findOne({ userId: session.user.id }).select('type').lean()
  const portalType = profile?.type ?? 'FREELANCER'

  return (
    <FreelancerShell user={session.user} portalType={portalType}>
      {children}
    </FreelancerShell>
  )
}
