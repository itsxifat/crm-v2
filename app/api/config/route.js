import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Setting } from '@/models'

const CONFIG_KEY = 'crm_config'

// Default config structure
const DEFAULT_CONFIG = {
  ventures: [
    { id: 'ENSTUDIO', label: 'Enstudio', description: 'Creative Services', active: true },
    { id: 'ENTECH',   label: 'Entech',   description: 'Web & Tech',         active: true },
    { id: 'ENMARK',   label: 'Enmark',   description: 'Marketing Services', active: true },
  ],
  services: {
    ENSTUDIO: [
      {
        id: 'graphic-design', label: 'Graphic Design',
        subcategories: ['Logo & Branding', 'Social Media Graphics', 'Print & Packaging', 'Illustration', 'Infographics'],
      },
      {
        id: 'video-production', label: 'Video Production',
        subcategories: ['Corporate Video', 'Product Video', 'Reels & Shorts', 'Motion Graphics', 'Video Editing'],
      },
      {
        id: 'cgi-3d', label: 'CGI & 3D',
        subcategories: ['3D Modeling', 'Product Visualization', 'Architectural Visualization', 'Animation'],
      },
      {
        id: 'photography', label: 'Photography',
        subcategories: ['Product Photography', 'Event Coverage', 'Portrait', 'Commercial'],
      },
    ],
    ENTECH: [
      {
        id: 'web-development', label: 'Web Development',
        subcategories: ['Landing Page', 'Corporate Website', 'E-commerce', 'Web App', 'API Development', 'CMS Integration'],
      },
      {
        id: 'ui-ux-design', label: 'UI/UX Design',
        subcategories: ['Website UI', 'Mobile App UI', 'Dashboard Design', 'Prototyping', 'Design System'],
      },
      {
        id: 'mobile-development', label: 'Mobile Development',
        subcategories: ['iOS App', 'Android App', 'Cross-Platform'],
      },
      {
        id: 'maintenance', label: 'Maintenance',
        subcategories: ['Bug Fixes', 'Performance Optimization', 'Security Audit', 'Updates'],
      },
    ],
    ENMARK: [
      {
        id: 'social-media', label: 'Social Media Management',
        subcategories: ['Content Calendar', 'Post Scheduling', 'Community Management', 'Full Management'],
      },
      {
        id: 'paid-advertising', label: 'Paid Advertising',
        subcategories: ['Meta Ads', 'Google Ads', 'TikTok Ads', 'LinkedIn Ads'],
      },
      {
        id: 'strategy', label: 'Strategy & Consulting',
        subcategories: ['Brand Strategy', 'Marketing Audit', 'Competitor Analysis', 'Growth Strategy'],
      },
      {
        id: 'seo', label: 'SEO',
        subcategories: ['On-Page SEO', 'Technical SEO', 'Link Building', 'Local SEO'],
      },
    ],
  },
}

// GET /api/config
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const setting = await Setting.findOne({ key: CONFIG_KEY }).lean()
    if (!setting) {
      return NextResponse.json({ data: DEFAULT_CONFIG })
    }

    return NextResponse.json({ data: JSON.parse(setting.value) })
  } catch (err) {
    console.error('[GET /api/config]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/config
export async function PUT(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body = await request.json()
    await Setting.findOneAndUpdate(
      { key: CONFIG_KEY },
      { key: CONFIG_KEY, value: JSON.stringify(body), group: 'config' },
      { upsert: true, new: true }
    )

    return NextResponse.json({ data: body })
  } catch (err) {
    console.error('[PUT /api/config]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
