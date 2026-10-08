import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

const base = process.env.TEST_BASE_URL || 'http://localhost:3001'
const password = process.env.TEST_DEMO_PASSWORD
if (!password) throw new Error('Set TEST_DEMO_PASSWORD sesuai SEED_DEMO_PASSWORD.')
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('Pengujian integrasi hanya untuk server lokal.')

async function login(email: string) {
  const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  assert.equal(response.status, 200, `Login gagal: ${email}`)
  return response.headers.get('set-cookie')!.split(';')[0]
}
async function request(path: string, cookie: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}/api${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, data: await response.json().catch(() => null) }
}

const owner = await login('owner@tokomaju.demo')
const manager = await login('manager@tokomaju.demo')
const staff = await login('staff@tokomaju.demo')
const branches = await request('/branches', owner)
assert.equal(branches.status, 200)
assert.ok(branches.data.length >= 3)
const me = await request('/auth/me', owner)
const pusat = branches.data.find((branch: { id: string }) => branch.id === me.data.activeBranch.id)
const selatan = branches.data.find((branch: { code: string }) => branch.code === 'SELATAN')
const barat = branches.data.find((branch: { code: string }) => branch.code === 'BARAT')
assert.ok(pusat && selatan && barat)
assert.equal((await request('/branches', manager)).data.length, 1)
assert.equal((await request('/auth/active-branch', manager, 'PATCH', { branchId: pusat.id })).status, 403)
assert.equal((await request('/branches', staff, 'POST', { code: 'ILEGAL', name: 'Ilegal' })).status, 403)

const suffix = randomBytes(4).toString('hex').toUpperCase()
const created = await request('/products', owner, 'POST', { sku: `TEST-${suffix}`, name: `Produk Uji ${suffix}`, category: 'Uji', price: 10000, minStock: 0 })
assert.equal(created.status, 201)
const productId = created.data.id as string
assert.equal((await request('/products', manager, 'POST', { sku: `NO-${suffix}`, name: 'Ditolak', price: 1, minStock: 0 })).status, 403)
assert.equal((await request('/stock-movements', staff, 'POST', { productId, type: 'ADJUSTMENT', quantity: 1, reason: 'Koreksi tanpa izin' })).status, 403)
assert.equal((await request('/stock-movements', owner, 'POST', { productId, type: 'IN', quantity: 1, reason: 'Stok pengujian pusat' })).status, 201)
assert.equal((await request('/auth/active-branch', owner, 'PATCH', { branchId: selatan.id })).status, 200)
let products = await request(`/products?search=${suffix}`, owner)
assert.equal(products.data.items[0].stock, 0, 'Stok cabang baru terpisah dari pusat')
assert.equal((await request('/stock-movements', manager, 'POST', { productId, type: 'IN', quantity: 2, reason: 'Stok pengujian selatan' })).status, 201)
products = await request(`/products?search=${suffix}`, owner)
assert.equal(products.data.items[0].stock, 2)
assert.equal((await request('/auth/active-branch', owner, 'PATCH', { branchId: pusat.id })).status, 200)
products = await request(`/products?search=${suffix}`, owner)
assert.equal(products.data.items[0].stock, 1)

const draft = async () => request('/orders', owner, 'POST', { customerName: `Pelanggan ${suffix}`, items: [{ productId, quantity: 1 }] })
const first = await draft(), second = await draft()
assert.equal(first.status, 201)
assert.equal(second.status, 201)
assert.equal((await request(`/orders/${first.data.id}/confirm`, manager, 'POST')).status, 404, 'Manajer cabang lain tidak boleh mengubah pesanan')
const results = await Promise.all([request(`/orders/${first.data.id}/confirm`, owner, 'POST'), request(`/orders/${second.data.id}/confirm`, owner, 'POST')])
assert.deepEqual(results.map(result => result.status).sort(), [200, 409], 'Satu stok terakhir hanya dipakai satu pesanan')
const winner = results[0].status === 200 ? first.data.id : second.data.id
assert.equal((await request(`/orders/${winner}/confirm`, owner, 'POST')).status, 200)
assert.equal((await request(`/orders/${winner}/pay`, owner, 'POST', { method: 'QRIS' })).status, 200)
assert.equal((await request(`/orders/${winner}/pay`, owner, 'POST', { method: 'QRIS' })).status, 200)
assert.equal((await request(`/orders/${winner}/cancel`, owner, 'POST')).status, 409)
assert.equal((await request(`/orders/${winner}/refund`, owner, 'POST')).status, 200)
assert.equal((await request(`/orders/${winner}/refund`, owner, 'POST')).status, 200)
products = await request(`/products?search=${suffix}`, owner)
assert.equal(products.data.items[0].stock, 1)

assert.equal((await request('/stock-movements', owner, 'POST', { productId, type: 'IN', quantity: 2, reason: 'Stok untuk retur' })).status, 201)
const returnedOrder = await request('/orders', owner, 'POST', { customerName: `Retur ${suffix}`, items: [{ productId, quantity: 2 }] })
assert.equal((await request(`/orders/${returnedOrder.data.id}/confirm`, owner, 'POST')).status, 200)
assert.equal((await request(`/orders/${returnedOrder.data.id}/pay`, owner, 'POST', { method: 'TRANSFER' })).status, 200)
assert.equal((await request(`/orders/${returnedOrder.data.id}/fulfill`, owner, 'POST')).status, 200)
assert.equal((await request(`/orders/${returnedOrder.data.id}/returns`, staff, 'POST', { reason: 'Ditolak pelanggan', items: [{ productId, quantity: 1 }] })).status, 403)
assert.equal((await request(`/orders/${returnedOrder.data.id}/returns`, owner, 'POST', { reason: 'Kemasan rusak', items: [{ productId, quantity: 1 }] })).status, 201)
let returnedOrderState = await request(`/orders?search=Retur%20${suffix}`, owner)
assert.equal(returnedOrderState.data.items[0].paymentStatus, 'PARTIALLY_REFUNDED')
assert.equal(returnedOrderState.data.items[0].refundedTotal, 10000)

const transfer = await request('/transfers', owner, 'POST', { toBranchId: selatan.id, note: 'Transfer pengujian', items: [{ productId, quantity: 1 }] })
assert.equal(transfer.status, 201)
assert.equal((await request(`/transfers/${transfer.data.id}/send`, owner, 'POST')).status, 200)
assert.equal((await request('/auth/active-branch', owner, 'PATCH', { branchId: selatan.id })).status, 200)
assert.equal((await request(`/transfers/${transfer.data.id}/receive`, owner, 'POST')).status, 200)
assert.equal((await request(`/transfers/${transfer.data.id}/receive`, owner, 'POST')).status, 200)
assert.equal((await request('/auth/active-branch', owner, 'PATCH', { branchId: pusat.id })).status, 200)

const dashboard = await request('/dashboard', owner)
assert.equal(dashboard.status, 200)
assert.ok(dashboard.data.branchCount >= 3)
assert.equal(dashboard.data.branches.length, branches.data.length)
assert.equal(dashboard.data.lowStock, dashboard.data.branches.reduce((sum: number, branch: { lowStock: number }) => sum + branch.lowStock, 0))
assert.equal((await request('/reports/network.xlsx', manager)).status, 403)
assert.equal((await request('/reports/summary', manager)).status, 200)
assert.equal((await request('/reports/summary', staff)).status, 403)
const workbook = await fetch(`${base}/api/reports/network.xlsx`, { headers: { Cookie: owner } })
assert.equal(workbook.status, 200)
assert.match(workbook.headers.get('content-type') || '', /spreadsheet/)
console.log('Integrasi berhasil: isolasi cabang, peran, pembayaran, refund, retur, transfer stok, laporan pusat, dan idempotensi.')
