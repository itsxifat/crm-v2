import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import connectDB from '@/lib/mongodb'
import User from '@/models/User'
import Employee, { generateEmployeeId } from '@/models/Employee'

const DUMMY = [
  {
    user: {
      name:  'Ariful Islam',
      email: 'ariful.islam@en-tech.agency',
      phone: '+8801711223344',
      role:  'EMPLOYEE',
    },
    employee: {
      venture:     'ENTECH',
      department:  'DEV',
      position:    'Full Stack Developer',
      designation: 'Junior Developer',
      salary:      45000,
      hireDate:    new Date('2026-03-01'),
      dateOfBirth: new Date('1998-05-12'),
      bloodGroup:  'B+',
      nidNumber:   '1998112233445',
      address:     'House 12, Road 5, Mirpur-10, Dhaka-1216',
      emergencyContact: 'Rabiul Islam — +8801611223344',
      panelAccessGranted: true,
    },
  },
  {
    user: {
      name:  'Sumaiya Akter',
      email: 'sumaiya.akter@en-tech.agency',
      phone: '+8801855667788',
      role:  'EMPLOYEE',
    },
    employee: {
      venture:     'ENMARK',
      department:  'MKT',
      position:    'Marketing Executive',
      designation: 'Executive',
      salary:      38000,
      hireDate:    new Date('2026-03-05'),
      dateOfBirth: new Date('1997-09-22'),
      bloodGroup:  'A+',
      nidNumber:   '1997556677889',
      address:     'Flat 3A, Green View, Banani, Dhaka-1213',
      emergencyContact: 'Rofiq Akter — +8801755667788',
      panelAccessGranted: true,
    },
  },
  {
    user: {
      name:  'Tanvir Hossain',
      email: 'tanvir.hossain@en-tech.agency',
      phone: '+8801933445566',
      role:  'EMPLOYEE',
    },
    employee: {
      venture:     'ENSTUDIO',
      department:  'DSN',
      position:    'UI/UX Designer',
      designation: 'Senior Designer',
      salary:      55000,
      hireDate:    new Date('2026-02-15'),
      dateOfBirth: new Date('1995-03-30'),
      bloodGroup:  'O+',
      nidNumber:   '1995334455667',
      address:     'Road 8, Block C, Bashundhara, Dhaka-1229',
      emergencyContact: 'Mina Hossain — +8801833445566',
      panelAccessGranted: true,
    },
  },
  {
    user: {
      name:  'Fariha Noor',
      email: 'fariha.noor@en-tech.agency',
      phone: '+8801622334455',
      role:  'EMPLOYEE',
    },
    employee: {
      venture:     'ENTECH',
      department:  'HRM',
      position:    'HR Officer',
      designation: 'HR Executive',
      salary:      40000,
      hireDate:    new Date('2026-01-10'),
      dateOfBirth: new Date('1996-11-18'),
      bloodGroup:  'AB+',
      nidNumber:   '1996223344556',
      address:     'House 4, Sector 6, Uttara, Dhaka-1230',
      emergencyContact: 'Karim Noor — +8801522334455',
      panelAccessGranted: true,
    },
  },
  {
    user: {
      name:  'Rakibul Hasan',
      email: 'rakibul.hasan@en-tech.agency',
      phone: '+8801744556677',
      role:  'EMPLOYEE',
    },
    employee: {
      venture:     'ENTECH',
      department:  'ACC',
      position:    'Accountant',
      designation: 'Accounts Officer',
      salary:      42000,
      hireDate:    new Date('2026-03-10'),
      dateOfBirth: new Date('1994-07-05'),
      bloodGroup:  'A-',
      nidNumber:   '1994445566778',
      address:     'Flat 2B, Paltan Tower, Purana Paltan, Dhaka-1000',
      emergencyContact: 'Selina Hasan — +8801644556677',
      panelAccessGranted: true,
    },
  },
  {
    user: {
      name:  'Mehedi Hassan',
      email: 'mehedi.hassan@en-tech.agency',
      phone: '+8801966778899',
      role:  'EMPLOYEE',
    },
    employee: {
      venture:     'ENMARK',
      department:  'SLS',
      position:    'Sales Executive',
      designation: 'Executive',
      salary:      36000,
      hireDate:    new Date('2026-03-15'),
      dateOfBirth: new Date('1999-01-25'),
      bloodGroup:  'B-',
      nidNumber:   '1999667788990',
      address:     'House 7, Kalabagan, Dhaka-1205',
      emergencyContact: 'Laila Hassan — +8801866778899',
      panelAccessGranted: true,
    },
  },
  {
    user: {
      name:  'Nusrat Jahan',
      email: 'nusrat.jahan@en-tech.agency',
      phone: '+8801311223344',
      role:  'EMPLOYEE',
    },
    employee: {
      venture:     'ENSTUDIO',
      department:  'OPS',
      position:    'Operations Coordinator',
      designation: 'Coordinator',
      salary:      48000,
      hireDate:    new Date('2026-02-01'),
      dateOfBirth: new Date('1993-08-14'),
      bloodGroup:  'O-',
      nidNumber:   '1993112233445',
      address:     'Road 3, Sector 10, Uttara, Dhaka-1230',
      emergencyContact: 'Jalal Jahan — +8801211223344',
      panelAccessGranted: true,
    },
  },
]

export async function GET() {
  if (process.env.NODE_ENV === 'production')
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })

  await connectDB()

  const results = []
  const defaultPassword = await bcrypt.hash('Employee@123', 10)

  for (const { user: ud, employee: ed } of DUMMY) {
    try {
      // Skip if user already exists
      const exists = await User.findOne({ email: ud.email }).lean()
      if (exists) { results.push({ email: ud.email, status: 'skipped (already exists)' }); continue }

      const user = await new User({
        ...ud,
        password: defaultPassword,
        isActive: true,
      }).save()

      // Generate employee ID
      let employeeId = null
      try {
        employeeId = await generateEmployeeId({
          department: ed.department,
          hireDate:   ed.hireDate,
          phone:      ud.phone,
        })
      } catch (e) {
        console.warn('employeeId gen failed:', e.message)
      }

      await new Employee({
        userId:     user._id,
        phone:      ud.phone,
        employeeId,
        ...ed,
      }).save()

      results.push({ email: ud.email, employeeId, status: 'created' })
    } catch (err) {
      results.push({ email: ud.email, status: 'error', message: err.message })
    }
  }

  return NextResponse.json({
    message: `${results.filter(r => r.status === 'created').length}/${DUMMY.length} employees created`,
    defaultPassword: 'Employee@123',
    results,
  })
}
