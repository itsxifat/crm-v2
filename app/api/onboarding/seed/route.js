export const dynamic = 'force-dynamic'
// DEV-ONLY — seeds 10 dummy onboarding records (5 original + 5 new)
// GET /api/onboarding/seed
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { EmployeeOnboarding } from '@/models'

const DUMMY = [
  {
    email: 'rafiqul.islam@en-tech.agency',
    status: 'SUBMITTED',
    submittedAt: new Date(Date.now() - 2 * 86400000),
    selfData: {
      name:             'Md. Rafiqul Islam',
      email:            'rafiqul.islam@en-tech.agency',
      phone:            '+8801711223344',
      secondaryPhone:   '+8801811223344',
      homePhone:        null,
      dateOfBirth:      new Date('1996-04-12'),
      nidNumber:        '1996123456789',
      address:          'House 7, Road 3, Mirpur-10, Dhaka-1216',
      emergencyContact: 'Md. Jalal Islam — +8801911223344',
      bloodGroup:       'A+',
      photo:            null,
      documents:        [],
    },
  },
  {
    email: 'nusrat.jahan@en-tech.agency',
    status: 'SUBMITTED',
    submittedAt: new Date(Date.now() - 1 * 86400000),
    selfData: {
      name:             'Nusrat Jahan',
      email:            'nusrat.jahan@en-tech.agency',
      phone:            '+8801612334455',
      secondaryPhone:   null,
      homePhone:        '+880255667788',
      dateOfBirth:      new Date('1998-09-25'),
      nidNumber:        '1998876543210',
      address:          'Apt 4B, Green Valley, Bashundhara R/A, Dhaka-1229',
      emergencyContact: 'Kamal Hossain — +8801712334455',
      bloodGroup:       'B+',
      photo:            null,
      documents:        [],
    },
  },
  {
    email: 'tanvir.ahmed@en-tech.agency',
    status: 'SUBMITTED',
    submittedAt: new Date(Date.now() - 3 * 86400000),
    selfData: {
      name:             'Tanvir Ahmed',
      email:            'tanvir.ahmed@en-tech.agency',
      phone:            '+8801955443322',
      secondaryPhone:   '+8801855443322',
      homePhone:        null,
      dateOfBirth:      new Date('1995-01-30'),
      nidNumber:        '1995567890123',
      address:          'House 22, Lane 5, Uttara Sector-7, Dhaka-1230',
      emergencyContact: 'Rina Begum — +8801655443322',
      bloodGroup:       'O+',
      photo:            null,
      documents:        [],
    },
  },
  {
    email: 'sumaiya.akter@en-tech.agency',
    status: 'PENDING_SUBMISSION',
    selfData: {
      name: null, email: null, phone: null, secondaryPhone: null,
      homePhone: null, dateOfBirth: null, nidNumber: null,
      address: null, emergencyContact: null, bloodGroup: null,
      photo: null, documents: [],
    },
  },
  {
    email: 'ariful.haque@en-tech.agency',
    status: 'PENDING_SUBMISSION',
    selfData: {
      name: null, email: null, phone: null, secondaryPhone: null,
      homePhone: null, dateOfBirth: null, nidNumber: null,
      address: null, emergencyContact: null, bloodGroup: null,
      photo: null, documents: [],
    },
  },
  // ── 5 new records ──────────────────────────────────────────────────────────
  {
    email: 'farhan.hossain@en-tech.agency',
    status: 'APPROVED',
    submittedAt: new Date(Date.now() - 4 * 86400000),
    approvedAt:  new Date(Date.now() - 4 * 86400000),
    selfData: {
      name:             'Farhan Hossain',
      email:            'farhan.hossain@en-tech.agency',
      phone:            '+8801688991122',
      secondaryPhone:   null,
      homePhone:        null,
      dateOfBirth:      new Date('1999-11-03'),
      nidNumber:        '1999001122334',
      address:          'Flat 3A, Sunshine Tower, Gulshan-2, Dhaka-1212',
      emergencyContact: 'Roksana Begum — +8801788991122',
      bloodGroup:       'AB+',
      photo:            null,
      documents:        [],
    },
  },
  {
    email: 'sabrina.sultana@en-tech.agency',
    status: 'APPROVED',
    submittedAt: new Date(Date.now() - 1 * 86400000),
    approvedAt:  new Date(Date.now() - 1 * 86400000),
    selfData: {
      name:             'Sabrina Sultana',
      email:            'sabrina.sultana@en-tech.agency',
      phone:            '+8801533445566',
      secondaryPhone:   '+8801633445566',
      homePhone:        null,
      dateOfBirth:      new Date('2000-07-19'),
      nidNumber:        '2000556677889',
      address:          'House 45, Block C, Aftabnagar, Dhaka-1212',
      emergencyContact: 'Kamal Sultana — +8801933445566',
      bloodGroup:       'O-',
      photo:            null,
      documents:        [],
    },
  },
  {
    email: 'jahirul.islam@en-tech.agency',
    status: 'PENDING_SUBMISSION',
    selfData: {
      name: null, email: null, phone: null, secondaryPhone: null,
      homePhone: null, dateOfBirth: null, nidNumber: null,
      address: null, emergencyContact: null, bloodGroup: null,
      photo: null, documents: [],
    },
  },
  {
    email: 'mim.akter@en-tech.agency',
    status: 'APPROVED',
    submittedAt: new Date(Date.now() - 6 * 86400000),
    approvedAt:  new Date(Date.now() - 6 * 86400000),
    selfData: {
      name:             'Mim Akter',
      email:            'mim.akter@en-tech.agency',
      phone:            '+8801877665544',
      secondaryPhone:   null,
      homePhone:        '+880244332211',
      dateOfBirth:      new Date('1997-03-08'),
      nidNumber:        '1997332211009',
      address:          'Road 12, Sector 6, Uttara, Dhaka-1230',
      emergencyContact: 'Rina Akter — +8801977665544',
      bloodGroup:       'B-',
      photo:            null,
      documents:        [],
    },
  },
  {
    email: 'rakibul.hassan@en-tech.agency',
    status: 'PENDING_SUBMISSION',
    selfData: {
      name: null, email: null, phone: null, secondaryPhone: null,
      homePhone: null, dateOfBirth: null, nidNumber: null,
      address: null, emergencyContact: null, bloodGroup: null,
      photo: null, documents: [],
    },
  },
  // ── 5 new records ──────────────────────────────────────────────────────────
  {
    email: 'nasrin.begum@en-tech.agency',
    status: 'SUBMITTED',
    submittedAt: new Date(Date.now() - 1 * 86400000),
    selfData: {
      name:             'Nasrin Begum',
      email:            'nasrin.begum@en-tech.agency',
      phone:            '+8801722334455',
      secondaryPhone:   null,
      homePhone:        '+880255443322',
      dateOfBirth:      new Date('1994-06-14'),
      nidNumber:        '1994445566778',
      address:          'House 9, Block B, Rayer Bazar, Dhaka-1209',
      emergencyContact: 'Abul Hossain — +8801822334455',
      bloodGroup:       'A-',
      photo:            null,
      documents:        [],
    },
  },
  {
    email: 'imran.chowdhury@en-tech.agency',
    status: 'SUBMITTED',
    submittedAt: new Date(Date.now() - 2 * 86400000),
    selfData: {
      name:             'Imran Chowdhury',
      email:            'imran.chowdhury@en-tech.agency',
      phone:            '+8801966778899',
      secondaryPhone:   '+8801866778899',
      homePhone:        null,
      dateOfBirth:      new Date('1993-11-22'),
      nidNumber:        '1993778899001',
      address:          'Flat 2C, Paltan Tower, Purana Paltan, Dhaka-1000',
      emergencyContact: 'Dilruba Chowdhury — +8801566778899',
      bloodGroup:       'B+',
      photo:            null,
      documents:        [],
    },
  },
  {
    email: 'tahmina.khatun@en-tech.agency',
    status: 'PENDING_SUBMISSION',
    selfData: {
      name: null, email: null, phone: null, secondaryPhone: null,
      homePhone: null, dateOfBirth: null, nidNumber: null,
      address: null, emergencyContact: null, bloodGroup: null,
      photo: null, documents: [],
    },
  },
  {
    email: 'mahfuzur.rahman@en-tech.agency',
    status: 'APPROVED',
    submittedAt: new Date(Date.now() - 5 * 86400000),
    approvedAt:  new Date(Date.now() - 5 * 86400000),
    selfData: {
      name:             'Mahfuzur Rahman',
      email:            'mahfuzur.rahman@en-tech.agency',
      phone:            '+8801344556677',
      secondaryPhone:   null,
      homePhone:        '+880244556677',
      dateOfBirth:      new Date('1992-03-17'),
      nidNumber:        '1992556677889',
      address:          'Road 4, Sector 11, Uttara, Dhaka-1230',
      emergencyContact: 'Salma Khatun — +8801444556677',
      bloodGroup:       'AB-',
      photo:            null,
      documents:        [],
    },
  },
  {
    email: 'sharmin.akter@en-tech.agency',
    status: 'PENDING_SUBMISSION',
    selfData: {
      name: null, email: null, phone: null, secondaryPhone: null,
      homePhone: null, dateOfBirth: null, nidNumber: null,
      address: null, emergencyContact: null, bloodGroup: null,
      photo: null, documents: [],
    },
  },
]

export async function GET(request) {
  if (process.env.NODE_ENV === 'production')
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })

  await connectDB()

  const created = []
  const origin  = request.headers.get('origin') || 'http://localhost:3000'

  for (const data of DUMMY) {
    try {
      const record = await new EmployeeOnboarding(data).save()
      created.push({
        name:   data.selfData?.name ?? data.email,
        status: record.status,
        token:  record.token,
        link:   `${origin}/onboarding/${record.token}`,
      })
    } catch (err) {
      created.push({ name: data.email, error: err.message })
    }
  }

  return NextResponse.json({
    message: `${created.filter(c => !c.error).length}/${DUMMY.length} onboarding records created`,
    submitted_count: created.filter(c => c.status === 'SUBMITTED').length,
    pending_count:   created.filter(c => c.status === 'PENDING_SUBMISSION').length,
    data: created,
  })
}
