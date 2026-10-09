import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { purchaseTransition } from '../server/purchaseRules.ts'

describe('aturan purchase order', () => {
  it('mengikuti pengajuan, persetujuan, pemesanan, lalu penerimaan', () => {
    assert.equal(purchaseTransition('PENDING_APPROVAL', 'approve'), 'advance')
    assert.equal(purchaseTransition('APPROVED', 'order'), 'advance')
    assert.equal(purchaseTransition('ORDERED', 'receive'), 'advance')
  })

  it('dapat dibatalkan sebelum diterima', () => {
    assert.equal(purchaseTransition('PENDING_APPROVAL', 'cancel'), 'advance')
    assert.equal(purchaseTransition('APPROVED', 'cancel'), 'advance')
    assert.equal(purchaseTransition('ORDERED', 'cancel'), 'advance')
    assert.equal(purchaseTransition('RECEIVED', 'cancel'), 'invalid')
  })

  it('aman ketika tindakan berhasil diulang', () => {
    assert.equal(purchaseTransition('APPROVED', 'approve'), 'repeat')
    assert.equal(purchaseTransition('ORDERED', 'order'), 'repeat')
    assert.equal(purchaseTransition('RECEIVED', 'receive'), 'repeat')
    assert.equal(purchaseTransition('CANCELLED', 'cancel'), 'repeat')
  })
})
