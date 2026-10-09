import type { TransferStatus } from '@prisma/client'

export type TransferAction = 'approve' | 'send' | 'receive' | 'cancel'

export function transferTransition(status: TransferStatus, action: TransferAction): 'advance' | 'repeat' | 'invalid' {
  const expected: Record<TransferAction, { from: TransferStatus; to: TransferStatus }> = {
    approve: { from: 'PENDING_APPROVAL', to: 'APPROVED' },
    send: { from: 'APPROVED', to: 'IN_TRANSIT' },
    receive: { from: 'IN_TRANSIT', to: 'RECEIVED' },
    cancel: { from: 'PENDING_APPROVAL', to: 'CANCELLED' }
  }
  if (action === 'approve' && status === 'DRAFT') return 'advance'
  if (action === 'cancel' && ['DRAFT', 'APPROVED'].includes(status)) return 'advance'
  return status === expected[action].to ? 'repeat' : status === expected[action].from ? 'advance' : 'invalid'
}
