'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import CreateProjectForm from '@/components/admin/projects/CreateProjectForm'

export default function EditProjectPage() {
  const { id }    = useParams()
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then(r => r.json())
      .then(j => { setProject(j.data); setLoading(false) })
  }, [id])

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Edit Project</h1>
        <p className="text-sm text-gray-500 mt-0.5">{project?.name}</p>
      </div>
      {project && <CreateProjectForm project={project} />}
    </div>
  )
}
