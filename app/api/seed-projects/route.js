// DEV-ONLY — seeds 5 dummy projects with real client references
// GET /api/seed-projects
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Client, Project } from '@/models'

export async function GET(request) {
  if (process.env.NODE_ENV === 'production')
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })

  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  await connectDB()

  // Grab up to 5 real clients to attach projects to
  const clients = await Client.find({}).limit(5).lean()
  if (clients.length === 0)
    return NextResponse.json({ error: 'No clients found — create at least one client first' }, { status: 422 })

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
  function client() { return pick(clients) }

  const now = new Date()
  const daysFromNow = (d) => new Date(now.getTime() + d * 86400000)

  const seeds = [
    {
      clientId:    client()._id,
      venture:     'ENSTUDIO',
      name:        'Brand Identity & Visual Design',
      description: 'Complete brand overhaul — logo, colour palette, typography, brand guidelines PDF.',
      category:    'Branding',
      subcategory: 'Logo & Identity',
      projectType: 'FIXED',
      status:      'IN_PROGRESS',
      priority:    'HIGH',
      budget:      85000,
      discount:    5000,
      paidAmount:  40000,
      startDate:   daysFromNow(-10),
      deadline:    daysFromNow(20),
    },
    {
      clientId:    client()._id,
      venture:     'ENTECH',
      name:        'E-Commerce Platform Development',
      description: 'Full-stack e-commerce site with product management, cart, Stripe payments and admin panel.',
      category:    'Web Development',
      subcategory: 'E-Commerce',
      projectType: 'FIXED',
      status:      'PENDING',
      priority:    'URGENT',
      budget:      220000,
      discount:    10000,
      paidAmount:  55000,
      startDate:   daysFromNow(3),
      deadline:    daysFromNow(60),
    },
    {
      clientId:    client()._id,
      venture:     'ENMARK',
      name:        'Social Media Management — Monthly',
      description: 'Monthly content calendar, 20 posts/month across Facebook & Instagram, ad management up to ৳15k spend.',
      category:    'Digital Marketing',
      subcategory: 'Social Media',
      projectType: 'MONTHLY',
      status:      'ACTIVE',
      priority:    'MEDIUM',
      budget:      18000,
      discount:    0,
      paidAmount:  18000,
      startDate:   daysFromNow(-30),
      billingDay:  1,
      currentPeriodStart: daysFromNow(-30),
      currentPeriodEnd:   daysFromNow(1),
      nextBillingDate:    daysFromNow(1),
      renewalStatus: 'ACTIVE',
    },
    {
      clientId:    client()._id,
      venture:     'ENSTUDIO',
      name:        'Corporate Website Redesign',
      description: '6-page responsive website redesign with CMS integration, SEO optimisation and 1-month support.',
      category:    'Web Design',
      subcategory: 'UI/UX',
      projectType: 'FIXED',
      status:      'IN_REVIEW',
      priority:    'MEDIUM',
      budget:      55000,
      discount:    0,
      paidAmount:  55000,
      startDate:   daysFromNow(-45),
      deadline:    daysFromNow(-5),
    },
    {
      clientId:    client()._id,
      venture:     'ENTECH',
      name:        'CRM Integration & API Development',
      description: 'Custom REST API to sync HubSpot CRM with the client internal ERP. Includes webhooks, data mapping and docs.',
      category:    'Software Development',
      subcategory: 'API / Integration',
      projectType: 'FIXED',
      status:      'APPROVED',
      priority:    'HIGH',
      budget:      140000,
      discount:    0,
      paidAmount:  70000,
      startDate:   daysFromNow(-20),
      deadline:    daysFromNow(30),
    },
  ]

  const created = []
  for (const seed of seeds) {
    try {
      const proj = await new Project(seed).save()
      created.push({ id: proj.id, projectCode: proj.projectCode, name: proj.name })
    } catch (err) {
      created.push({ error: err.message, name: seed.name })
    }
  }

  return NextResponse.json({ message: `${created.filter(c => !c.error).length} projects created`, data: created })
}
