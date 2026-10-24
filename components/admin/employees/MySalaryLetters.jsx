'use client'

import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import TkAmt from '@/components/ui/TkAmt'

/** Own profile: the employee's approved increments / promotions with their letters. Hidden when there are none. */
export default function MySalaryLetters() {
  const [rows, setRows] = useState([])
  useEffect(() => {
    fetch('/api/employee/salary-revisions').then(r => (r.ok ? r.json() : null)).then(j => setRows(j?.data ?? [])).catch(() => {})
  }, [])
  if (!rows.length) return null
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-gray-100">
        <div>
          <CardTitle>Salary letters</CardTitle>
          <CardDescription>Your increments and promotions</CardDescription>
        </div>
      </CardHeader>
      <div className="divide-y divide-gray-100">
        {rows.map(r => (
          <div key={r.id} className="flex flex-col gap-1.5 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              <p className="text-gray-900">
                <span className="font-medium">{r.typeLabel}</span> · <TkAmt value={r.newSalary} /> a month from {r.effectiveLabel}
              </p>
              {r.newDesignation && <p className="text-xs text-muted-foreground">New designation: {r.newDesignation}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!r.inEffect && <Badge variant="primary">Starts {r.effectiveLabel}</Badge>}
              {r.letterNo && (
                <a href={`/api/salary-revisions/${r.id}/letter`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-gray-700 underline-offset-4 hover:underline">
                  <FileText className="size-3.5" /> Letter
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
