import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, Invoice, Milestone } from '@/models'
import { resolveActiveClient } from '@/lib/clientAccess'
import Link from 'next/link'
import {
  FolderOpen, FileText, Wallet, AlertCircle,
  ArrowRight, Clock,
} from 'lucide-react'
import ProjectStatusBadge from '@/components/portals/ProjectStatusBadge'
import { sumInvoiceMoneyBDT, INVOICE_MONEY_FIELDS } from '@/lib/clientStats'
import { formatMoney } from '@/lib/currencies'
import PageHeader from '@/components/ui/PageHeader'
import StatsCard from '@/components/ui/StatsCard'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { Card } from '@/components/ui/Card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { buttonVariants } from '@/components/ui/Button'

// Non-terminal statuses — what a client thinks of as "active / ongoing" work.
// Everything except DELIVERED / CANCELLED / RENEWED.
const ACTIVE_STATUSES = [
  'PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'REVISION', 'APPROVED',
  'FEEDBACK', 'SUBMITTED', 'ACTIVE', 'EXPIRING_SOON', 'ON_HOLD',
]

const OUTSTANDING = ['SENT', 'OVERDUE', 'PARTIALLY_PAID']

function InvoiceStatusBadge({ status }) {
  const map = {
    DRAFT:          { label: 'Draft',            variant: 'default' },
    SENT:           { label: 'Awaiting payment', variant: 'primary' },
    PARTIALLY_PAID: { label: 'Partial',          variant: 'warning' },
    PAID:           { label: 'Paid',             variant: 'success' },
    OVERDUE:        { label: 'Overdue',          variant: 'danger'  },
  }
  const s = map[status] || map.DRAFT
  return <Badge variant={s.variant}>{s.label}</Badge>
}

const fmtTk = (n) => `৳ ${(Number(n) || 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

function SectionHeader({ title, href }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <Link href={href} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
        View all <ArrowRight />
      </Link>
    </div>
  )
}

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
      billableInvoices = []

  if (hasCompany) {
    ;[activeProjects, invoices, activeCount, pendingInvoicesCount, billableInvoices] = await Promise.all([
      Project.find({ clientId, status: { $in: ACTIVE_STATUSES } })
        .select('name description status projectType deadline currentPeriodEnd updatedAt')
        .sort({ updatedAt: -1 })
        .limit(4)
        .lean(),
      Invoice.find({ clientId, status: { $nin: ['CANCELLED', 'DRAFT'] } })
        .select('invoiceNumber issueDate dueDate total paidAmount status currency')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      Project.countDocuments({ clientId, status: { $in: ACTIVE_STATUSES } }),
      Invoice.countDocuments({ clientId, status: { $in: OUTSTANDING } }),
      // Every issued, non-cancelled invoice — money received on partially paid /
      // overdue invoices counts towards Total Paid too.
      Invoice.find({ clientId, status: { $nin: ['CANCELLED', 'DRAFT'] } }).select(INVOICE_MONEY_FIELDS).lean(),
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

  // Invoices can be in different currencies: roll up in BDT (base currency)
  // using each invoice's own BDT equivalent, same as the admin client figures.
  const { totalRevenue: paidTotal, outstandingBalance: dueTotal } = sumInvoiceMoneyBDT(billableInvoices)

  const stats = [
    { label: 'Active projects',  value: activeCount,          icon: FolderOpen,  color: 'gray'  },
    { label: 'Pending invoices', value: pendingInvoicesCount, icon: FileText,    color: 'gray'  },
    { label: 'Total paid',       value: fmtTk(paidTotal),     icon: Wallet,      color: 'green' },
    { label: 'Due balance',      value: fmtTk(dueTotal),      icon: AlertCircle, color: Number(dueTotal) > 0 ? 'red' : 'gray' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${session.user.name?.split(' ')[0] ?? 'there'}`}
        description={client?.company
          ? <>{client.company}{client.clientCode && <span className="text-gray-400"> · {client.clientCode}</span>}</>
          : undefined}
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, icon, color }) => (
          <StatsCard key={label} title={label} value={value} icon={icon} color={color} />
        ))}
      </div>

      {/* Active projects */}
      <section>
        <SectionHeader title="Active projects" href="/client/projects" />

        {enrichedProjects.length === 0 ? (
          <Card>
            <EmptyState icon={FolderOpen} title="No active projects" />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {enrichedProjects.map((project) => (
              <Link
                key={project.id}
                href={`/client/projects/${project.id}`}
                className="group rounded-xl border border-gray-200/80 bg-white p-5 shadow-xs transition-colors hover:border-gray-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="line-clamp-1 text-sm font-semibold text-gray-900">{project.name}</h3>
                  <ProjectStatusBadge status={project.status} className="shrink-0" />
                </div>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {project.projectType === 'MONTHLY' ? 'Monthly' : 'Fixed'}
                </p>
                <div className="mt-4 flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  <Clock className="size-3.5 shrink-0 text-gray-400" />
                  {project.nextMilestone ? (
                    <>
                      <span className="truncate">Next: {project.nextMilestone.title}</span>
                      {project.nextMilestone.dueDate && (
                        <span className="ml-auto shrink-0 text-gray-400">{fmtDate(project.nextMilestone.dueDate)}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-gray-500">
                      {project.projectType === 'MONTHLY'
                        ? (project.currentPeriodEnd ? `Renews ${fmtDate(project.currentPeriodEnd)}` : 'No renewal date set')
                        : (project.deadline ? `Due ${fmtDate(project.deadline)}` : 'No deadline set')}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Recent invoices */}
      <section>
        <SectionHeader title="Recent invoices" href="/client/invoices" />

        <Card className="overflow-hidden">
          {invoices.length === 0 ? (
            <EmptyState icon={FileText} title="No invoices yet" />
          ) : (
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Due date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right"><span className="sr-only">Action</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => {
                  const id = invoice._id.toString()
                  const payable = OUTSTANDING.includes(invoice.status)
                  return (
                    <TableRow key={id}>
                      <TableCell>
                        <p className="font-medium text-gray-900">{invoice.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground">{fmtDate(invoice.issueDate)}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{fmtDate(invoice.dueDate)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-gray-900">
                        {formatMoney(invoice.total, invoice.currency)}
                      </TableCell>
                      <TableCell><InvoiceStatusBadge status={invoice.status} /></TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/client/invoices/${id}`}
                          className={buttonVariants({ variant: payable ? 'outline' : 'ghost', size: 'xs' })}
                        >
                          {payable ? 'Pay now' : 'View'}
                        </Link>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </section>
    </div>
  )
}
