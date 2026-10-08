import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { canFulfill, paymentTransition } from '../server/paymentRules.ts'

describe('aturan pembayaran', () => {
  it('menerima pembayaran hanya untuk pesanan terkonfirmasi yang belum dibayar', () => {
    assert.equal(paymentTransition('CONFIRMED', 'UNPAID', 'pay'), 'advance')
    assert.equal(paymentTransition('CONFIRMED', 'PAID', 'pay'), 'repeat')
    assert.equal(paymentTransition('DRAFT', 'UNPAID', 'pay'), 'invalid')
  })

  it('mengizinkan refund satu kali sebelum pesanan selesai', () => {
    assert.equal(paymentTransition('CONFIRMED', 'PAID', 'refund'), 'advance')
    assert.equal(paymentTransition('CANCELLED', 'REFUNDED', 'refund'), 'repeat')
    assert.equal(paymentTransition('FULFILLED', 'PAID', 'refund'), 'invalid')
  })

  it('menyelesaikan pesanan hanya setelah pembayaran diterima', () => {
    assert.equal(canFulfill('CONFIRMED', 'PAID'), true)
    assert.equal(canFulfill('CONFIRMED', 'UNPAID'), false)
    assert.equal(canFulfill('DRAFT', 'PAID'), false)
  })
})
