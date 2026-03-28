import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Client, Project, Invoice, Milestone, Task, Message } from '@/models'
import Link from 'next/link'
import {
  FolderOpen, FileText, DollarSign, MessageSquare,
  ArrowRight, Clock, CheckCircle, AlertCircle, TrendingUp
} from 'lucide-react'
import ProgressBar from '@/components/portals/ProgressBar'

function StatusBadge({ status }) {
  const map = {
    PLANNING:    { label: 'Planning',     bg: 'bg-gray-100',   text: 'text-gray-700' },
    IN_PROGRESS: { label: 'In Progress',  bg: 'bg-blue-100',   text: 'text-blue-700' },
    ON_HOLD:     { label: 'On Hold',      bg: 'bg-yellow-100', text: 'text-yellow-700' },
    COMPLETED:   { label: 'Completed',    bg: 'bg-green-100',  text: 'text-green-700' },
    CANCELLED:   { label: 'Cancelled',    bg: 'bg-red-100',    text: 'text-red-700' },
  }
  const s = map[status] || map.PLANNING
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

function InvoiceStatusBadge({ status }) {
  const map = {
    DRAFT:          { label: 'Draft',          bg: 'bg-gray-100',   text: 'text-gray-700' },
    SENT:           { label: 'Awaiting Payment',bg: 'bg-blue-100',   text: 'text-blue-700' },
    PARTIALLY_PAID: { label: 'Partial',         bg: 'bg-yellow-100', text: 'text-yellow-700' },
    PAID:           { label: 'Paid',            bg: 'bg-green-100',  text: 'text-green-700' },
    OVERDUE:        { label: 'Overdue',         bg: 'bg-red-100',    text: 'text-red-700' },
  }
  const s = map[status] || map.DRAFT
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

function calcProgress(project) {
  const tasks = project.tasks || []
  if (!tasks.length) return 0
  const done = tasks.filter((t) => t.status === 'COMPLETED').length
  return Math.round((done / tasks.length) * 100)
}

export default async function ClientDashboard() {
  const session = await getServerSession(authOptions)

  await connectDB()

  const client = await Client.findOne({ userId: session.user.id })
    .populate({ path: 'userId', select: 'name email' })
    .lean()

  if (!client) return <div className="text-center py-20 text-gray-500">Client profile not found.</div>

  const clientId = client._id

  const [activeProjects, invoices, allProjects, pendingInvoicesCount, paidAgg, unreadMessages] = await Promise.all([
    Project.find({ clientId, status: { $in: ['PLANNING', 'IN_PROGRESS', 'ON_HOLD'] } })
      .sort({ updatedAt: -1 })
      .limit(4)
      .lean(),
    Invoice.find({ clientId, status: { $ne: 'CANCELLED' } })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    Project.countDocuments({ clientId, status: { $in: ['PLANNING', 'IN_PROGRESS', 'ON_HOLD'] } }),
    Invoice.countDocuments({ clientId, status: { $in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID'] } }),
    Invoice.aggregate([{ $match: { clientId, status: 'PAID' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    Message.countDocuments({ receiverId: session.user.id, isRead: false }),
  ])

  // Enrich projects with task statuses and milestones
  const projectIds = activeProjects.map(p => p._id)
  const [tasksByProject, milestonesByProject] = await Promise.all([
    Task.find({ projectId: { $in: projectIds } }).select('projectId status isClientVisible').lean(),
    Milestone.find({ projectId: { $in: projectIds } }).select('projectId completed title dueDate').lean(),
  ])

  const enrichedProjects = activeProjects.map(p => ({
    ...p,
    id: p._id.toString(),
    tasks:      tasksByProject.filter(t => t.projectId.toString() === p._id.toString()),
    milestones: milestonesByProject.filter(m => m.projectId.toString() === p._id.toString()),
  }))

  const paidTotal = paidAgg[0]?.total ?? 0
  const pendingInvoices = pendingInvoicesCount

  const stats = [
    { label: 'Active Projects',   value: allProjects,                              icon: FolderOpen,    color: 'blue' },
    { label: 'Pending Invoices',  value: pendingInvoices,                          icon: FileText,      color: 'yellow' },
    { label: 'Total Paid',        value: `$${paidTotal.toLocaleString()}`,          icon: DollarSign,    color: 'green' },
    { label: 'Unread Messages',   value: unreadMessages,                           icon: MessageSquare, color: 'purple' },
  ]

  const colorMap = {
    blue:   { bg: 'bg-blue-50',   icon: 'text-blue-600',   ring: 'ring-blue-100' },
    green:  { bg: 'bg-green-50',  icon: 'text-green-600',  ring: 'ring-green-100' },
    purple: { bg: 'bg-purple-50', icon: 'text-purple-600', ring: 'ring-purple-100' },
    yellow: { bg: 'bg-yellow-50', icon: 'text-yellow-600', ring: 'ring-yellow-100' },
  }

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-8 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-blue-200 text-sm font-medium mb-1">Welcome back</p>
            <h1 className="text-3xl font-bold">{client.userId?.name}</h1>
            {client.company && (
              <p className="text-blue-200 mt-1 text-sm">{client.company}</p>
            )}
          </div>
          <div className="hidden sm:block w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center">
            <TrendingUp className="w-8 h-8 text-white" />
          </div>
        </div>
        <p className="text-blue-100 text-sm mt-4">
          Here&apos;s an overview of your projects and account activity.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, color }) => {
          const c = colorMap[color]
          return (
            <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">{label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
                </div>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ring-2 ${c.bg} ${c.ring}`}>
                  <Icon className={`w-6 h-6 ${c.icon}`} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Active Projects */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Active Projects</h2>
          <Link href="/client/projects" className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
            View all <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {enrichedProjects.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
            <FolderOpen className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No active projects</p>
            <p className="text-gray-400 text-sm mt-1">Your projects will appear here once they&apos;re created.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {enrichedProjects.map((project) => {
              const progress = calcProgress(project)
              const nextMilestone = project.milestones.find((m) => !m.completed)
              return (
                <Link key={project.id} href={`/client/projects/${project.id}`}>
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 hover:shadow-md hover:border-blue-100 transition-all duration-200 cursor-pointer h-full">
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="font-semibold text-gray-900 text-base line-clamp-1">{project.name}</h3>
                      <StatusBadge status={project.status} />
                    </div>

                    {project.description && (
                      <p className="text-sm text-gray-500 mb-4 line-clamp-2">{project.description}</p>
                    )}

                    <div className="mb-4">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs text-gray-500">Progress</span>
                        <span className="text-xs font-semibold text-gray-700">{progress}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    {nextMilestone && (
                      <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                        <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        <span>Next: {nextMilestone.title}</span>
                        {nextMilestone.dueDate && (
                          <span className="text-gray-400">
                            &bull; {new Date(nextMilestone.dueDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* Recent Invoices */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Recent Invoices</h2>
          <Link href="/client/invoices" className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
            View all <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {invoices.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500">No invoices yet</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Invoice</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Due Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoices.map((invoice) => (
                  <tr key={invoice._id?.toString() ?? invoice.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-gray-900">{invoice.invoiceNumber}</p>
                      <p className="text-xs text-gray-400">{new Date(invoice.issueDate).toLocaleDateString()}</p>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-semibold text-gray-900">${invoice.total.toLocaleString()}</p>
                    </td>
                    <td className="px-6 py-4">
                      <InvoiceStatusBadge status={invoice.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link href={`/client/invoices/${invoice.id}`}>
                        {['SENT', 'OVERDUE', 'PARTIALLY_PAID'].includes(invoice.status) ? (
                          <span className="inline-flex items-center px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors">
                            Pay Now
                          </span>
                        ) : (
                          <span className="text-xs text-blue-600 hover:text-blue-700 font-medium">View</span>
                        )}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Messages preview */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Messages</h2>
          <Link href="/client/messages" className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
            Open chat <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
          <MessageSquare className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">
            {unreadMessages > 0
              ? `You have ${unreadMessages} unread message${unreadMessages > 1 ? 's' : ''}`
              : 'No new messages'}
          </p>
          <Link href="/client/messages">
            <button className="mt-3 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
              Go to Messages
            </button>
          </Link>
        </div>
      </div>
    </div>
  )
}
