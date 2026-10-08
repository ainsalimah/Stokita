import type { TransferStatus } from '@prisma/client'

export type TransferAction = 'send' | 'receive' | 'cancel'

export function transferTransition(status: TransferStatus, action: TransferAction): 'advance' | 'repeat' | 'invalid' {
  const expected: Record<TransferAction, { from: TransferStatus; to: TransferStatus }> = {
    send: { from: 'DRAFT', to: 'IN_TRANSIT' },
    receive: { from: 'IN_TRANSIT', to: 'RECEIVED' },
    cancel: { from: 'DRAFT', to: 'CANCELLED' }
  }
  return status === expected[action].to ? 'repeat' : status === expected[action].from ? 'advance' : 'invalid'
}
