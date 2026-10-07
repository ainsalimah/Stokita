import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { orderTransition } from '../server/orderRules.ts'

describe('aturan status pesanan', () => {
  it('mengizinkan konfirmasi draft dan pengulangan tanpa perubahan baru', () => {
    assert.equal(orderTransition('DRAFT', 'confirm'), 'advance')
    assert.equal(orderTransition('CONFIRMED', 'confirm'), 'repeat')
  })
  it('mengizinkan pembatalan hanya sebelum pesanan selesai', () => {
    assert.equal(orderTransition('CONFIRMED', 'cancel'), 'advance')
    assert.equal(orderTransition('CANCELLED', 'cancel'), 'repeat')
    assert.equal(orderTransition('FULFILLED', 'cancel'), 'invalid')
  })
  it('menolak penyelesaian draft', () => {
    assert.equal(orderTransition('DRAFT', 'fulfill'), 'invalid')
  })
})
