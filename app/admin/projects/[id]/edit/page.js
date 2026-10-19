'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, FolderX } from 'lucide-react'
import CreateProjectForm from '@/components/admin/projects/CreateProjectForm'
import PageHeader from '@/components/ui/PageHeader'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import EmptyState from '@/components/ui/EmptyState'

export default function EditProjectPage() {
  const { id }    = useParams()
  const router    = useRouter()
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/projects/${id}`)
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(r.status === 404 ? 'Project not found.' : (j.error ?? `Failed to load project (${r.status})`))
        if (!cancelled) setProject(j.data ?? null)
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load project') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <button onClick={() => router.back()}
          className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-gray-900">
          <ArrowLeft className="size-3.5" /> Back
        </button>
        <PageHeader
          title="Edit project"
          description={loading ? 'Loading…' : (project?.projectCode ?? project?.name ?? '—')}
        />
      </div>

      {loading ? (
        <PageLoader />
      ) : error ? (
        <EmptyState icon={FolderX} title={error} />
      ) : project ? (
        <CreateProjectForm project={project} />
      ) : (
        <EmptyState icon={FolderX} title="Project not found" />
      )}
    </div>
  )
}
