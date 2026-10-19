'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Label, inputClass } from '@/components/ui/Input'
import { cn } from '@/lib/utils'

// Shown after creating a freelancer/agency when the invitation email could not be
// sent: the API returns the invite link (or, with verification off, a temporary
// password) exactly once, so it must be handed to the admin to share manually.
export default function InviteCredentialsModal({ result, onClose, label = 'Freelancer' }) {
  const [copied, setCopied] = useState(false)
  const open = !!result && (!!result.link || !!result.tempPassword)
  const value = result?.link ?? result?.tempPassword ?? ''
  const isLink = !!result?.link

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success('Copied')
    } catch {
      toast.error('Copy failed — copy it manually')
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) { setCopied(false); onClose() } }}
      title="Invitation email not sent"
      description={`${label} created. Share this ${isLink ? 'activation link' : 'temporary password'} securely.`}
    >
      <div className="space-y-2">
        <Label>
          {isLink ? 'Activation link (valid 48 hours)' : `Temporary password for ${result?.data?.userId?.email ?? 'this account'}`}
        </Label>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={value}
            onFocus={e => e.target.select()}
            className={cn(inputClass, 'flex-1 bg-gray-50 font-mono text-gray-700')}
          />
          <Button variant="outline" onClick={copy}>
            {copied ? <Check /> : <Copy />} Copy
          </Button>
        </div>
        <p className="text-xs text-amber-600">Shown only once — copy it now.</p>
      </div>
      <ModalFooter>
        <Button onClick={() => { setCopied(false); onClose() }}>Done</Button>
      </ModalFooter>
    </Modal>
  )
}
