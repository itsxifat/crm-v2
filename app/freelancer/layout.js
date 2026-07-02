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

  // Note: the config-driven KYC gate (verification.freelancer) is enforced in
  // middleware.js, which redirects unverified freelancers to /freelancer/verification
  // while letting that page through. We don't gate here because the verification page
  // renders under this same layout (a layout-level redirect would infinite-loop).

  await connectDB()
  const profile = await Freelancer.findOne({ userId: session.user.id }).select('type').lean()
  const portalType = profile?.type ?? 'FREELANCER'

  return (
    <FreelancerShell user={session.user} portalType={portalType}>
      {children}
    </FreelancerShell>
  )
}
