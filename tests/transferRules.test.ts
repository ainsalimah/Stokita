import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { transferTransition } from '../server/transferRules.ts'

describe('aturan transfer stok', () => {
  it('menyetujui pengajuan, mengirim, lalu menerima barang', () => {
    assert.equal(transferTransition('PENDING_APPROVAL', 'approve'), 'advance')
    assert.equal(transferTransition('APPROVED', 'send'), 'advance')
    assert.equal(transferTransition('IN_TRANSIT', 'receive'), 'advance')
  })

  it('membuat pengulangan tindakan aman', () => {
    assert.equal(transferTransition('APPROVED', 'approve'), 'repeat')
    assert.equal(transferTransition('IN_TRANSIT', 'send'), 'repeat')
    assert.equal(transferTransition('RECEIVED', 'receive'), 'repeat')
    assert.equal(transferTransition('CANCELLED', 'cancel'), 'repeat')
  })

  it('menolak urutan yang tidak sesuai', () => {
    assert.equal(transferTransition('PENDING_APPROVAL', 'send'), 'invalid')
    assert.equal(transferTransition('APPROVED', 'receive'), 'invalid')
    assert.equal(transferTransition('IN_TRANSIT', 'cancel'), 'invalid')
    assert.equal(transferTransition('RECEIVED', 'send'), 'invalid')
  })
})
