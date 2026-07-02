import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, Invoice, Milestone } from '@/models'
import { resolveActiveClient } from '@/lib/clientAccess'
import Link from 'next/link'
import {
  FolderOpen, FileText, Wallet, AlertCircle,
  ArrowRight, Clock, Building2,
} from 'lucide-react'
import ProjectStatusBadge from '@/components/portals/ProjectStatusBadge'

// Non-terminal statuses — what a client thinks of as "active / ongoing" work.
// Everything except DELIVERED / CANCELLED / RENEWED.
const ACTIVE_STATUSES = [
  'PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'REVISION', 'APPROVED',
  'FEEDBACK', 'SUBMITTED', 'ACTIVE', 'EXPIRING_SOON', 'ON_HOLD',
]

const OUTSTANDING = ['SENT', 'OVERDUE', 'PARTIALLY_PAID']

function InvoiceStatusBadge({ status }) {
  const map = {
    DRAFT:          { label: 'Draft',            bg: 'bg-gray-100',   text: 'text-gray-700' },
    SENT:           { label: 'Awaiting Payment', bg: 'bg-blue-100',   text: 'text-blue-700' },
    PARTIALLY_PAID: { label: 'Partial',          bg: 'bg-yellow-100', text: 'text-yellow-800' },
    PAID:           { label: 'Paid',             bg: 'bg-green-100',  text: 'text-green-700' },
    OVERDUE:        { label: 'Overdue',          bg: 'bg-red-100',    text: 'text-red-700' },
  }
  const s = map[status] || map.DRAFT
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

const fmtTk = (n) => `৳ ${(Number(n) || 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default async function ClientDashboard() {
  const session = await getServerSession(authOptions)

  await connectDB()

  // Scope EVERYTHING to the company the client is currently signed into. Using
  // the legacy Client.findOne({userId}) here was the bug: projects showed a
  // single (wrong) company and invoices summed across all companies.
  const { client, clientId, error } = await resolveActiveClient(session)

  // 2+ companies and none chosen → send them to the chooser (middleware normally
  // catches this, but guard here too so we never render cross-company data).
  if (error === 'SELECT_COMPANY') redirect('/client/select-company')

  const hasCompany = !!clientId

  let activeProjects = [], invoices = [],
      activeCount = 0, pendingInvoicesCount = 0,
      paidInvoices = [], dueInvoices = []

  if (hasCompany) {
    ;[activeProjects, invoices, activeCount, pendingInvoicesCount, paidInvoices, dueInvoices] = await Promise.all([
      Project.find({ clientId, status: { $in: ACTIVE_STATUSES } })
        .select('name description status projectType deadline currentPeriodEnd updatedAt')
        .sort({ updatedAt: -1 })
        .limit(4)
        .lean(),
      Invoice.find({ clientId, status: { $nin: ['CANCELLED', 'DRAFT'] } })
        .select('invoiceNumber issueDate dueDate total paidAmount status')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Project.countDocuments({ clientId, status: { $in: ACTIVE_STATUSES } }),
      Invoice.countDocuments({ clientId, status: { $in: OUTSTANDING } }),
      Invoice.find({ clientId, status: 'PAID' }).select('total').lean(),
      Invoice.find({ clientId, status: { $in: OUTSTANDING } }).select('total paidAmount').lean(),
    ])
  }

  // Attach the next open milestone for each active project card.
  const projectIds = activeProjects.map(p => p._id)
  const milestones = projectIds.length
    ? await Milestone.find({ projectId: { $in: projectIds }, completed: false })
        .select('projectId title dueDate')
        .sort({ dueDate: 1 })
        .lean()
    : []

  const enrichedProjects = activeProjects.map(p => ({
    ...p,
    id: p._id.toString(),
    nextMilestone: milestones.find(m => m.projectId.toString() === p._id.toString()) ?? null,
  }))

  const paidTotal = paidInvoices.reduce((s, i) => s + (Number(i.total) || 0), 0)
  const dueTotal  = dueInvoices.reduce((s, i) => s + ((Number(i.total) || 0) - (Number(i.paidAmount) || 0)), 0)

  const stats = [
    { label: 'Active Projects',  value: activeCount,               icon: FolderOpen,  color: 'blue'   },
    { label: 'Pending Invoices', value: pendingInvoicesCount,      icon: FileText,    color: 'amber'  },
    { label: 'Total Paid',       value: fmtTk(paidTotal),          icon: Wallet,      color: 'green'  },
    { label: 'Due Balance',      value: fmtTk(dueTotal),           icon: AlertCircle, color: 'red'    },
  ]

  const colorMap = {
    blue:  { bg: 'bg-blue-50',  icon: 'text-blue-600'  },
    green: { bg: 'bg-green-50', icon: 'text-green-600' },
    amber: { bg: 'bg-amber-50', icon: 'text-amber-600' },
    red:   { bg: 'bg-red-50',   icon: 'text-red-500'   },
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back, {session.user.name?.split(' ')[0] ?? 'there'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1.5">
            {client?.company ? (
              <>
                <Building2 className="w-3.5 h-3.5 text-gray-400" />
                {client.company}
                {client.clientCode && <span className="text-gray-300">· {client.clientCode}</span>}
              </>
            ) : (
              'Here is an overview of your projects and account activity.'
            )}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {stats.map(({ label, value, icon: Icon, color }) => {
          const c = colorMap[color]
          return (
            <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-500">{label}</p>
                  <p className="text-lg sm:text-xl font-bold text-gray-900 mt-1 truncate">{value}</p>
                </div>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${c.bg}`}>
                  <Icon className={`w-5 h-5 ${c.icon}`} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Active Projects */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">Active Projects</h2>
          <Link href="/client/projects" className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
            View all <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {enrichedProjects.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
            <FolderOpen className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500 font-medium text-sm">No active projects</p>
            <p className="text-gray-400 text-xs mt-1">Your projects will appear here once they&apos;re created.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {enrichedProjects.map((project) => (
              <Link key={project.id} href={`/client/projects/${project.id}`}
                className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:border-blue-200 hover:shadow-md transition-all">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <h3 className="font-semibold text-gray-900 text-sm line-clamp-1">{project.name}</h3>
                  <ProjectStatusBadge status={project.status} className="shrink-0" />
                </div>
                <p className="text-xs text-gray-400 mb-3">
                  {project.projectType === 'MONTHLY' ? 'Monthly' : 'Fixed'} project
                </p>
                {project.nextMilestone ? (
                  <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                    <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <span className="truncate">Next: {project.nextMilestone.title}</span>
                    {project.nextMilestone.dueDate && (
                      <span className="text-gray-400 shrink-0 ml-auto">{fmtDate(project.nextMilestone.dueDate)}</span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {project.projectType === 'MONTHLY'
                        ? (project.currentPeriodEnd ? `Renews ${fmtDate(project.currentPeriodEnd)}` : 'No renewal date set')
                        : (project.deadline ? `Due ${fmtDate(project.deadline)}` : 'No deadline set')}
                    </span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Recent Invoices */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">Recent Invoices</h2>
          <Link href="/client/invoices" className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
            View all <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {invoices.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
            <FileText className="w-9 h-9 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No invoices yet</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="bg-gray-50/60 border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Invoice</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Due Date</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Amount</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="px-5 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoices.map((invoice) => {
                  const id = invoice._id.toString()
                  const payable = OUTSTANDING.includes(invoice.status)
                  return (
                    <tr key={id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-medium text-gray-900">{invoice.invoiceNumber}</p>
                        <p className="text-xs text-gray-400">{fmtDate(invoice.issueDate)}</p>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-gray-600">{fmtDate(invoice.dueDate)}</td>
                      <td className="px-5 py-3.5 text-right text-sm font-semibold text-gray-900">{fmtTk(invoice.total)}</td>
                      <td className="px-5 py-3.5"><InvoiceStatusBadge status={invoice.status} /></td>
                      <td className="px-5 py-3.5 text-right">
                        <Link href={`/client/invoices/${id}`}
                          className={payable
                            ? 'inline-flex items-center px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors'
                            : 'text-xs text-blue-600 hover:text-blue-700 font-medium'}>
                          {payable ? 'Pay Now' : 'View'}
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
