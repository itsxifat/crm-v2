'use client'
import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import CreateProjectForm from '@/components/admin/projects/CreateProjectForm'
import PageHeader from '@/components/ui/PageHeader'

export default function NewProjectPage() {
  const router = useRouter()
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <button onClick={() => router.back()}
          className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-gray-900">
          <ArrowLeft className="size-3.5" /> Back
        </button>
        <PageHeader title="New project" />
      </div>
      <CreateProjectForm />
    </div>
  )
}
