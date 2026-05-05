'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import CreateProjectForm from '@/components/admin/projects/CreateProjectForm'

export default function EditProjectPage() {
  const { id }    = useParams()
  const router    = useRouter()
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then(r => r.json())
      .then(j => { setProject(j.data); setLoading(false) })
  }, [id])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()}
            className="w-9 h-9 rounded-xl border border-gray-200 bg-white flex items-center justify-center hover:bg-gray-50 transition-colors shadow-sm">
            <ArrowLeft className="w-4 h-4 text-gray-500" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Edit Project</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {loading ? 'Loading…' : (project?.projectCode ?? project?.name ?? '—')}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 text-gray-300 animate-spin" />
          </div>
        ) : project ? (
          <CreateProjectForm project={project} />
        ) : (
          <div className="text-center py-24 text-gray-400">Project not found.</div>
        )}
      </div>
    </div>
  )
}
