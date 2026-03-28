'use client'
import CreateProjectForm from '@/components/admin/projects/CreateProjectForm'

export default function NewProjectPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">New Project</h1>
        <p className="text-sm text-gray-500 mt-0.5">Create a project for any venture</p>
      </div>
      <CreateProjectForm />
    </div>
  )
}
