'use client'
import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import CreateProjectForm from '@/components/admin/projects/CreateProjectForm'

export default function NewProjectPage() {
  const router = useRouter()
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()}
            className="w-9 h-9 rounded-xl border border-gray-200 bg-white flex items-center justify-center hover:bg-gray-50 transition-colors shadow-sm">
            <ArrowLeft className="w-4 h-4 text-gray-500" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">New Project</h1>
            <p className="text-sm text-gray-400 mt-0.5">Create a project for any venture</p>
          </div>
        </div>
        <CreateProjectForm />
      </div>
    </div>
  )
}
