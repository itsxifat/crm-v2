'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal, { ModalFooter } from '@/components/ui/Modal'

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
      toast.error('Copy failed — select the text and copy it manually')
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { if (!o) { setCopied(false); onClose() } }}
      title="Invitation email not sent"
      description={`${label} created, but the email could not be delivered. Share this ${isLink ? 'activation link' : 'temporary password'} with them securely.`}
    >
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          {isLink ? 'Activation link (valid for 48 hours)' : `Temporary password for ${result?.data?.userId?.email ?? 'this account'}`}
        </label>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={value}
            onFocus={e => e.target.select()}
            className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono bg-gray-50 text-gray-700 focus:outline-none"
          />
          <button type="button" onClick={copy}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} Copy
          </button>
        </div>
        <p className="text-xs text-gray-400">This is shown only once. Check the email settings to avoid this in future.</p>
      </div>
      <ModalFooter>
        <button type="button" onClick={() => { setCopied(false); onClose() }}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          Done
        </button>
      </ModalFooter>
    </Modal>
  )
}
