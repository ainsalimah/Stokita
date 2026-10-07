import type { OrderStatus } from '@prisma/client'

export type OrderAction = 'confirm' | 'cancel' | 'fulfill'
export function orderTransition(status: OrderStatus, action: OrderAction): 'advance' | 'repeat' | 'invalid' {
  const expected: Record<OrderAction, { from: OrderStatus; to: OrderStatus }> = {
    confirm: { from: 'DRAFT', to: 'CONFIRMED' },
    cancel: { from: 'CONFIRMED', to: 'CANCELLED' },
    fulfill: { from: 'CONFIRMED', to: 'FULFILLED' }
  }
  return status === expected[action].to ? 'repeat' : status === expected[action].from ? 'advance' : 'invalid'
}
