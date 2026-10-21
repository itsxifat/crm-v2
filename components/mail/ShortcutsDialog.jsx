'use client'

import Modal from '@/components/ui/Modal'
import { Kbd } from './ui'

const GROUPS = [
  {
    title: 'Navigation',
    items: [
      [['j'], 'Older message'],
      [['k'], 'Newer message'],
      [['Enter'], 'Open'],
      [['o'], 'Open'],
      [['u'], 'Back to list'],
      [['/'], 'Search'],
      [['x'], 'Select'],
      [['Esc'], 'Clear selection'],
      [['?'], 'Shortcuts'],
    ],
  },
  {
    title: 'Actions',
    items: [
      [['c'], 'Compose'],
      [['r'], 'Reply'],
      [['a'], 'Reply all'],
      [['f'], 'Forward'],
      [['e'], 'Archive'],
      [['#'], 'Delete'],
      [['!'], 'Report spam'],
      [['s'], 'Star'],
      [['Shift', 'I'], 'Mark as read'],
      [['Shift', 'U'], 'Mark as unread'],
    ],
  },
]

export default function ShortcutsDialog({ open, onOpenChange }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" size="lg">
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {GROUPS.map(g => (
          <div key={g.title}>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">{g.title}</h3>
            <ul className="divide-y divide-gray-100">
              {g.items.map(([keys, label]) => (
                <li key={`${label}-${keys.join('+')}`} className="flex items-center justify-between gap-3 py-1.5 text-sm text-gray-700">
                  <span>{label}</span>
                  <span className="flex items-center gap-1">
                    {keys.map(k => <Kbd key={k}>{k}</Kbd>)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  )
}
