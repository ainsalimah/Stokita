import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

const base = process.env.TEST_BASE_URL || 'http://localhost:3001'
const password = process.env.TEST_DEMO_PASSWORD
if (!password) throw new Error('Set TEST_DEMO_PASSWORD sesuai SEED_DEMO_PASSWORD.')

async function login(email: string) {
  const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  assert.equal(response.status, 200, `Login gagal: ${email}`)
  return response.headers.get('set-cookie')!.split(';')[0]
}
async function request(path: string, cookie: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}/api${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

const ownerA = await login('owner@tokomaju.demo')
const ownerB = await login('owner@tokoselatan.demo')
const managerA = await login('manager@tokomaju.demo')
const staffA = await login('staff@tokomaju.demo')
const suffix = randomBytes(4).toString('hex').toUpperCase()
const created = await request('/products', ownerA, 'POST', { sku: `TEST-${suffix}`, name: `Produk Uji ${suffix}`, category: 'Uji', price: 10000, minStock: 0 })
assert.equal(created.status, 201)
const productId = created.data.id as string

const ownerDashboard = await request('/dashboard', ownerA)
const managerDashboard = await request('/dashboard', managerA)
const staffDashboard = await request('/dashboard', staffA)
const otherStoreDashboard = await request('/dashboard', ownerB)
assert.equal(ownerDashboard.status, 200)
assert.equal(managerDashboard.status, 200)
assert.equal(staffDashboard.status, 200)
assert.equal(otherStoreDashboard.status, 200)
assert.equal(ownerDashboard.data.role, 'OWNER')
assert.equal(managerDashboard.data.role, 'MANAGER')
assert.equal(staffDashboard.data.role, 'STAFF')
assert.ok(ownerDashboard.data.activeUsers >= 3)
assert.equal('revenue' in staffDashboard.data, false, 'Dashboard staf tidak menampilkan nilai pesanan')
assert.equal('revenue' in managerDashboard.data, false, 'Dashboard manajer fokus operasional')
assert.ok(managerDashboard.data.lowStockProducts.some((x: { id: string }) => x.id === productId))
assert.ok(staffDashboard.data.lowStockProducts.some((x: { id: string }) => x.id === productId))
assert.ok(ownerDashboard.data.recent.some((x: { entityId: string }) => x.entityId === productId))
assert.ok(!otherStoreDashboard.data.recent.some((x: { entityId: string }) => x.entityId === productId), 'Dashboard toko lain tidak boleh memuat aktivitas toko A')

assert.equal((await request(`/products/${productId}`, ownerB, 'PATCH', { name: 'Tidak boleh' })).status, 404, 'Toko lain tidak boleh mengubah produk')
assert.equal((await request('/stock-movements', ownerB, 'POST', { productId, type: 'IN', quantity: 1, reason: 'Uji lintas toko' })).status, 404, 'Toko lain tidak boleh mengubah stok')
assert.equal((await request('/orders', ownerB, 'POST', { customerName: 'Pelanggan', items: [{ productId, quantity: 1 }] })).status, 400, 'Toko lain tidak boleh memakai produk')
assert.equal((await request('/products', staffA, 'POST', { sku: `NO-${suffix}`, name: 'Ditolak', price: 1, minStock: 0 })).status, 403, 'Staf tidak boleh menambah produk')

assert.equal((await request('/stock-movements', ownerA, 'POST', { productId, type: 'IN', quantity: 1, reason: 'Stok awal pengujian' })).status, 201)
const draft = async () => request('/orders', ownerA, 'POST', { customerName: `Pelanggan ${suffix}`, items: [{ productId, quantity: 1 }] })
const first = await draft(), second = await draft()
assert.equal(first.status, 201)
assert.equal(second.status, 201)
const results = await Promise.all([request(`/orders/${first.data.id}/confirm`, ownerA, 'POST'), request(`/orders/${second.data.id}/confirm`, ownerA, 'POST')])
assert.deepEqual(results.map(x => x.status).sort(), [200, 409], 'Hanya satu pesanan boleh mengambil stok terakhir')
const winner = results[0].status === 200 ? first.data.id : second.data.id
assert.equal((await request(`/orders/${winner}/confirm`, ownerA, 'POST')).status, 200, 'Konfirmasi ulang idempoten')
let products = await request(`/products?search=${suffix}`, ownerA)
assert.equal(products.data.items.find((x: { id: string }) => x.id === productId).stock, 0)
assert.equal((await request(`/orders/${winner}/cancel`, ownerA, 'POST')).status, 200)
assert.equal((await request(`/orders/${winner}/cancel`, ownerA, 'POST')).status, 200, 'Pembatalan ulang idempoten')
products = await request(`/products?search=${suffix}`, ownerA)
assert.equal(products.data.items.find((x: { id: string }) => x.id === productId).stock, 1)
console.log('Integrasi berhasil: isolasi toko, peran, konkurensi stok, dan idempotensi.')
