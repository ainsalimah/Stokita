import type { PurchaseOrderStatus } from '@prisma/client'

export type PurchaseAction = 'approve' | 'order' | 'receive' | 'cancel'

export function purchaseTransition(status: PurchaseOrderStatus, action: PurchaseAction): 'advance' | 'repeat' | 'invalid' {
  const expected: Record<PurchaseAction, { from: PurchaseOrderStatus; to: PurchaseOrderStatus }> = {
    approve: { from: 'PENDING_APPROVAL', to: 'APPROVED' },
    order: { from: 'APPROVED', to: 'ORDERED' },
    receive: { from: 'ORDERED', to: 'RECEIVED' },
    cancel: { from: 'PENDING_APPROVAL', to: 'CANCELLED' }
  }
  if (action === 'approve' && status === 'DRAFT') return 'advance'
  if (action === 'cancel' && ['DRAFT', 'APPROVED', 'ORDERED'].includes(status)) return 'advance'
  return status === expected[action].to ? 'repeat' : status === expected[action].from ? 'advance' : 'invalid'
}
