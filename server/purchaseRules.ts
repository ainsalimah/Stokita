import type { PurchaseOrderStatus } from '@prisma/client'

export type PurchaseAction = 'order' | 'receive' | 'cancel'

export function purchaseTransition(status: PurchaseOrderStatus, action: PurchaseAction): 'advance' | 'repeat' | 'invalid' {
  const expected: Record<PurchaseAction, { from: PurchaseOrderStatus; to: PurchaseOrderStatus }> = {
    order: { from: 'DRAFT', to: 'ORDERED' },
    receive: { from: 'ORDERED', to: 'RECEIVED' },
    cancel: { from: 'DRAFT', to: 'CANCELLED' }
  }
  if (action === 'cancel' && status === 'ORDERED') return 'advance'
  return status === expected[action].to ? 'repeat' : status === expected[action].from ? 'advance' : 'invalid'
}
