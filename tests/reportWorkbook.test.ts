import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { buildOrderWorkbook } from '../server/reportWorkbook.ts'

describe('unduhan laporan Excel', () => {
  it('menyimpan angka, tanggal, filter, dan warna status sebagai workbook Excel', async () => {
    const exported = buildOrderWorkbook('Toko Maju', [
      { number: 'ORD-001', customerName: 'Pelanggan A', status: 'CONFIRMED', total: 125000, createdAt: new Date('2026-10-07T10:00:00.000Z') },
      { number: 'ORD-002', customerName: 'Pelanggan B', status: 'CANCELLED', total: 25000, createdAt: new Date('2026-10-06T10:00:00.000Z') }
    ])
    const file = await exported.xlsx.writeBuffer()
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(file as Buffer)
    const sheet = reopened.getWorksheet('Pesanan')!
    assert.equal(sheet.getCell('A1').value, 'LAPORAN PESANAN')
    assert.equal(sheet.getCell('A3').value, 'Toko: Toko Maju')
    assert.equal(sheet.getCell('D7').value, 125000)
    assert.equal(sheet.getCell('D7').alignment?.horizontal, 'right')
    assert.ok(sheet.getCell('E7').value instanceof Date)
    assert.equal(sheet.getCell('C7').value, 'Dikonfirmasi')
    assert.equal(sheet.getCell('C8').value, 'Dibatalkan')
    assert.notEqual(sheet.getCell('C7').fill, sheet.getCell('C8').fill)
    assert.equal(sheet.pageSetup.fitToWidth, 1)
    assert.equal(sheet.views[0]?.state, 'frozen')
    assert.equal(sheet.autoFilter, 'A6:E8')
  })

  it('tetap membuat file yang jelas ketika belum ada pesanan', async () => {
    const sheet = buildOrderWorkbook('Toko Kosong', []).getWorksheet('Pesanan')!
    assert.equal(sheet.getCell('A7').value, 'Belum ada pesanan untuk toko ini.')
  })

  it('menambahkan cabang pada laporan jaringan', async () => {
    const workbook = buildOrderWorkbook('Jaringan Uji', [
      { number: 'ORD-003', customerName: 'Pelanggan C', status: 'FULFILLED', total: 50000, createdAt: new Date('2026-10-08T10:00:00.000Z'), branchName: 'Jakarta Selatan' }
    ])
    const file = await workbook.xlsx.writeBuffer()
    const reopened = new ExcelJS.Workbook()
    await reopened.xlsx.load(file as Buffer)
    const sheet = reopened.getWorksheet('Seluruh Cabang')!
    assert.equal(sheet.getCell('A1').value, 'Cabang')
    assert.equal(sheet.getCell('A2').value, 'Jakarta Selatan')
    assert.equal(sheet.getCell('E2').value, 50000)
  })
})
