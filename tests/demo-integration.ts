import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

const base = process.env.TEST_BASE_URL || 'http://localhost:3001'
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base) && process.env.ALLOW_REMOTE_DEMO_TEST !== '1') {
  throw new Error('Pengujian demo membuat data. Gunakan server lokal atau set ALLOW_REMOTE_DEMO_TEST=1 secara sengaja.')
}

async function request(path: string, cookie = '', method = 'GET', body?: unknown) {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return { status: response.status, data: await response.json().catch(() => null), cookie: response.headers.get('set-cookie')?.split(';')[0] || '' }
}

const open = async (role: 'OWNER' | 'MANAGER' | 'STAFF') => {
  const result = await request('/auth/demo', '', 'POST', { role })
  assert.equal(result.status, 201, JSON.stringify(result.data))
  assert.ok(result.cookie.startsWith('stokita_session='))
  assert.equal(result.data.user.role, role)
  assert.equal(result.data.store.isDemo, true)
  return result
}

const owner = await open('OWNER')
const manager = await open('MANAGER')
const staff = await open('STAFF')
assert.equal(new Set([owner.data.store.id, manager.data.store.id, staff.data.store.id]).size, 3)

for (const account of [owner, manager, staff]) {
  const me = await request('/auth/me', account.cookie)
  const dashboard = await request('/dashboard', account.cookie)
  const products = await request('/products', account.cookie)
  assert.equal(me.status, 200)
  assert.equal(me.data.store.isDemo, true)
  assert.equal(dashboard.status, 200)
  assert.equal(dashboard.data.role, account.data.user.role)
  assert.equal(products.data.total, 12)
  const branches = await request('/branches', account.cookie)
  assert.equal(branches.status, 200)
  assert.equal(branches.data.length, account.data.user.role === 'OWNER' ? 3 : 1)
  assert.ok(me.data.activeBranch.id)
}

const suffix = randomBytes(3).toString('hex').toUpperCase()
const created = await request('/products', owner.cookie, 'POST', { sku: `TEST-${suffix}`, name: 'Produk Demo Uji', price: 10000, minStock: 0 })
assert.equal(created.status, 201)
assert.equal((await request(`/products?search=${suffix}`, owner.cookie)).data.total, 1)
assert.equal((await request(`/products?search=${suffix}`, manager.cookie)).data.total, 0)
assert.equal((await request(`/products?search=${suffix}`, staff.cookie)).data.total, 0)
assert.equal((await request('/users', owner.cookie)).data.length, 7)
assert.equal((await request('/users', staff.cookie)).status, 403)
assert.equal((await request('/reports/summary', staff.cookie)).status, 403)
assert.equal((await request('/auth/active-branch', staff.cookie, 'PATCH', { branchId: owner.data.activeBranch.id })).status, 403)
assert.equal((await request('/auth/active-branch', owner.cookie, 'PATCH', { branchId: manager.data.activeBranch.id })).status, 404)
assert.equal((await request('/products', staff.cookie, 'POST', { sku: 'FORBIDDEN', name: 'Dilarang', price: 1, minStock: 0 })).status, 403)

const invalid = await request('/auth/demo', '', 'POST', { role: 'ADMIN' })
assert.equal(invalid.status, 400)
console.log('Demo sekali klik berhasil: tiga peran, toko pribadi, data awal, dan pembatasan akses.')
