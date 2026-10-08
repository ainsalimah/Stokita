import type { OrderStatus, PaymentStatus } from '@prisma/client'

export type PaymentAction = 'pay' | 'refund'

export function paymentTransition(status: OrderStatus, paymentStatus: PaymentStatus, action: PaymentAction): 'advance' | 'repeat' | 'invalid' {
  if (action === 'pay') {
    if (paymentStatus === 'PAID') return 'repeat'
    return status === 'CONFIRMED' && paymentStatus === 'UNPAID' ? 'advance' : 'invalid'
  }
  if (paymentStatus === 'REFUNDED') return 'repeat'
  return status === 'CONFIRMED' && paymentStatus === 'PAID' ? 'advance' : 'invalid'
}

export function canFulfill(status: OrderStatus, paymentStatus: PaymentStatus) {
  return status === 'CONFIRMED' && paymentStatus === 'PAID'
}
