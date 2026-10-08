import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { transferTransition } from '../server/transferRules.ts'

describe('aturan transfer stok', () => {
  it('mengirim draft dan menerima barang dalam perjalanan', () => {
    assert.equal(transferTransition('DRAFT', 'send'), 'advance')
    assert.equal(transferTransition('IN_TRANSIT', 'receive'), 'advance')
  })

  it('membuat pengulangan tindakan aman', () => {
    assert.equal(transferTransition('IN_TRANSIT', 'send'), 'repeat')
    assert.equal(transferTransition('RECEIVED', 'receive'), 'repeat')
    assert.equal(transferTransition('CANCELLED', 'cancel'), 'repeat')
  })

  it('menolak urutan yang tidak sesuai', () => {
    assert.equal(transferTransition('DRAFT', 'receive'), 'invalid')
    assert.equal(transferTransition('IN_TRANSIT', 'cancel'), 'invalid')
    assert.equal(transferTransition('RECEIVED', 'send'), 'invalid')
  })
})
