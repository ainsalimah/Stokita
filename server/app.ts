import express, { type Request, type Response, type NextFunction } from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import argon2 from 'argon2'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { loadEnvFile } from 'node:process'
import { PrismaClient, Prisma, Role, OrderStatus } from '@prisma/client'
import { z, ZodError } from 'zod'
import { orderTransition } from './orderRules.js'
import { canFulfill, paymentTransition } from './paymentRules.js'
import { buildOrderWorkbook } from './reportWorkbook.js'
import { cleanupExpiredDemos, createDemoSandbox, demoAge, demoHasCapacity } from './demoSandbox.js'

if (fs.existsSync('.env')) loadEnvFile('.env')
export const db = new PrismaClient()
export const app = express()
const day = 24 * 60 * 60 * 1000
const sessionAge = 7 * day
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex')

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

type Identity = { id: string; storeId: string; branchId: string; branchName: string; role: Role; name: string; email: string; storeName: string; isDemo: boolean }
type AuthedRequest = Request & { identity?: Identity; sessionToken?: string }
const identity = (req: Request): Identity => {
  const value = (req as AuthedRequest).identity
  if (!value) throw new ApiError(401, 'Silakan masuk terlebih dahulu.')
  return value
}
const parse = <T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> => schema.parse(value)
const int = z.coerce.number().int()
const pageSchema = z.object({ page: int.min(1).default(1), limit: int.min(1).max(100).default(20), search: z.string().trim().max(100).default('') })
const productBody = z.object({ sku: z.string().trim().min(1).max(40), name: z.string().trim().min(2).max(120), category: z.string().trim().max(80).optional().nullable(), price: int.min(0).max(1_000_000_000), minStock: int.min(0).max(1_000_000), active: z.boolean().optional() })
const publicUser = (user: { id: string; name: string; email: string; role: Role; active: boolean; branchId?: string | null; branch?: { name: string } | null }) => ({ id: user.id, name: user.name, email: user.email, role: user.role, active: user.active, branchId: user.branchId ?? null, branchName: user.branch?.name ?? null })
async function issueSession(res: Response, user: { id: string; name: string; email: string; role: Role; active: boolean; branchId: string | null }, store: { id: string; name: string; isDemo: boolean; demoExpiresAt: Date | null }, age: number) {
  const token = randomBytes(32).toString('hex')
  const branch = user.branchId ? await db.branch.findFirst({ where: { id: user.branchId, storeId: store.id, active: true } }) : await db.branch.findFirst({ where: { storeId: store.id, active: true }, orderBy: { createdAt: 'asc' } })
  if (!branch) throw new ApiError(403, 'Tidak ada cabang aktif untuk akun ini.')
  await db.session.create({ data: { userId: user.id, activeBranchId: branch.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + age) } })
  res.cookie('stokita_session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: age, path: '/' })
  res.setHeader('Cache-Control', 'no-store')
  res.json({ user: publicUser(user), store: { id: store.id, name: store.name, isDemo: store.isDemo, demoExpiresAt: store.demoExpiresAt }, activeBranch: { id: branch.id, name: branch.name, code: branch.code } })
}

app.disable('x-powered-by')
app.use(helmet({ contentSecurityPolicy: false }))
app.use(express.json({ limit: '100kb' }))
app.use(cookieParser())
app.use((req, _res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin) {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    try { if (new URL(req.headers.origin).host !== host) throw new ApiError(403, 'Asal permintaan tidak diizinkan.') }
    catch (e) { return next(e instanceof ApiError ? e : new ApiError(403, 'Asal permintaan tidak valid.')) }
  }
  next()
})

app.get('/api/health', async (_req, res) => {
  try { await db.$queryRaw`SELECT 1`; res.json({ ok: true }) }
  catch { res.status(503).json({ ok: false }) }
})
app.post('/api/auth/login', async (req, res) => {
  const body = parse(z.object({ email: z.email(), password: z.string().min(1) }), req.body)
  const user = await db.user.findUnique({ where: { email: body.email.toLowerCase() }, include: { store: true } })
  if (!user || !user.active || !(await argon2.verify(user.passwordHash, body.password))) throw new ApiError(401, 'Email atau kata sandi salah.')
  await issueSession(res, user, user.store, sessionAge)
})
app.post('/api/auth/demo', async (req, res) => {
  const { role } = parse(z.object({ role: z.enum(['OWNER', 'MANAGER', 'STAFF']) }), req.body)
  await cleanupExpiredDemos(db)
  if (!(await demoHasCapacity(db))) throw new ApiError(429, 'Ruang demo sedang penuh. Silakan coba beberapa saat lagi.')
  const { user, store } = await createDemoSandbox(db, role)
  res.status(201)
  await issueSession(res, user, store, demoAge)
})

app.use('/api', async (req: AuthedRequest, _res, next) => {
  try {
    const token = req.cookies?.stokita_session
    if (!token || typeof token !== 'string') throw new ApiError(401, 'Silakan masuk terlebih dahulu.')
    const session = await db.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { activeBranch: true, user: { include: { store: true, branch: true } } } })
    if (!session || session.expiresAt <= new Date() || !session.user.active || (session.user.store.isDemo && (!session.user.store.demoExpiresAt || session.user.store.demoExpiresAt <= new Date()))) throw new ApiError(401, 'Sesi berakhir. Silakan masuk kembali.')
    const branch = session.user.role === 'OWNER' ? session.activeBranch : session.user.branch
    if (!branch || !branch.active || branch.storeId !== session.user.storeId) throw new ApiError(403, 'Cabang akun ini tidak tersedia.')
    req.identity = { id: session.user.id, storeId: session.user.storeId, branchId: branch.id, branchName: branch.name, role: session.user.role, name: session.user.name, email: session.user.email, storeName: session.user.store.name, isDemo: session.user.store.isDemo }
    req.sessionToken = token
    next()
  } catch (error) { next(error) }
})
app.get('/api/auth/me', (req, res) => { const me = identity(req); res.setHeader('Cache-Control', 'no-store'); res.json({ user: { id: me.id, name: me.name, email: me.email, role: me.role }, store: { id: me.storeId, name: me.storeName, isDemo: me.isDemo }, activeBranch: { id: me.branchId, name: me.branchName } }) })
app.patch('/api/auth/active-branch', requireRole('OWNER'), async (req: AuthedRequest, res) => {
  const me = identity(req)
  const { branchId } = parse(z.object({ branchId: z.string().min(1) }), req.body)
  const branch = await db.branch.findFirst({ where: { id: branchId, storeId: me.storeId, active: true } })
  if (!branch) throw new ApiError(404, 'Cabang aktif tidak ditemukan.')
  await db.session.update({ where: { tokenHash: tokenHash(req.sessionToken!) }, data: { activeBranchId: branch.id } })
  res.json({ activeBranch: { id: branch.id, name: branch.name, code: branch.code } })
})
app.post('/api/auth/logout', async (req: AuthedRequest, res) => {
  if (req.sessionToken) await db.session.deleteMany({ where: { tokenHash: tokenHash(req.sessionToken) } })
  res.clearCookie('stokita_session', { path: '/' })
  res.status(204).end()
})

function requireRole(...roles: Role[]) { return (req: Request, _res: Response, next: NextFunction) => roles.includes(identity(req).role) ? next() : next(new ApiError(403, 'Anda tidak memiliki akses untuk tindakan ini.')) }
async function audit(tx: Prisma.TransactionClient, me: Identity, action: string, entity: string, entityId: string) {
  await tx.auditLog.create({ data: { storeId: me.storeId, branchId: me.branchId, userId: me.id, action, entity, entityId } })
}

app.get('/api/branches', async (req, res) => {
  const me = identity(req)
  const branches = await db.branch.findMany({ where: { storeId: me.storeId, ...(me.role === 'OWNER' ? {} : { id: me.branchId }) }, orderBy: { createdAt: 'asc' } })
  res.json(branches)
})
app.post('/api/branches', requireRole('OWNER'), async (req, res) => {
  const me = identity(req)
  if (me.isDemo && await db.branch.count({ where: { storeId: me.storeId } }) >= 6) throw new ApiError(429, 'Batas cabang ruang demo tercapai.')
  const body = parse(z.object({ code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9-]+$/), name: z.string().trim().min(2).max(100), address: z.string().trim().max(200).optional() }), req.body)
  const branch = await db.$transaction(async tx => {
    const created = await tx.branch.create({ data: { storeId: me.storeId, code: body.code.toUpperCase(), name: body.name, address: body.address || null } })
    await audit(tx, me, 'CREATE', 'BRANCH', created.id)
    return created
  })
  res.status(201).json(branch)
})
app.patch('/api/branches/:id', requireRole('OWNER'), async (req, res) => {
  const me = identity(req)
  const id = String(req.params.id)
  const body = parse(z.object({ name: z.string().trim().min(2).max(100).optional(), address: z.string().trim().max(200).nullable().optional(), active: z.boolean().optional() }), req.body)
  const current = await db.branch.findFirst({ where: { id, storeId: me.storeId } })
  if (!current) throw new ApiError(404, 'Cabang tidak ditemukan.')
  if (body.active === false) {
    if (id === me.branchId) throw new ApiError(400, 'Pilih cabang lain sebelum menonaktifkan cabang ini.')
    if (await db.user.count({ where: { branchId: id, active: true } })) throw new ApiError(409, 'Pindahkan atau nonaktifkan pengguna cabang ini terlebih dahulu.')
    if (await db.order.count({ where: { branchId: id, status: { in: ['DRAFT', 'CONFIRMED'] } } })) throw new ApiError(409, 'Selesaikan pesanan aktif cabang ini terlebih dahulu.')
  }
  const branch = await db.$transaction(async tx => {
    const updated = await tx.branch.update({ where: { id }, data: body })
    await audit(tx, me, 'UPDATE', 'BRANCH', id)
    return updated
  })
  res.json(branch)
})

app.get('/api/users', requireRole('OWNER'), async (req, res) => {
  const me = identity(req)
  const users = await db.user.findMany({ where: { storeId: me.storeId }, include: { branch: { select: { name: true } } }, orderBy: { createdAt: 'asc' } })
  res.json(users.map(publicUser))
})
app.post('/api/users', requireRole('OWNER'), async (req, res) => {
  const me = identity(req)
  if (me.isDemo && await db.user.count({ where: { storeId: me.storeId } }) >= 8) throw new ApiError(429, 'Batas pengguna ruang demo tercapai.')
  const body = parse(z.object({ name: z.string().trim().min(2).max(100), email: z.email(), password: z.string().min(12).max(128), role: z.enum(['MANAGER', 'STAFF']), branchId: z.string().min(1) }), req.body)
  const branch = await db.branch.findFirst({ where: { id: body.branchId, storeId: me.storeId, active: true } })
  if (!branch) throw new ApiError(400, 'Cabang pengguna tidak valid.')
  const user = await db.$transaction(async tx => {
    const created = await tx.user.create({ data: { storeId: me.storeId, branchId: branch.id, name: body.name, email: body.email.toLowerCase(), passwordHash: await argon2.hash(body.password), role: body.role }, include: { branch: { select: { name: true } } } })
    await audit(tx, me, 'CREATE', 'USER', created.id)
    return created
  })
  res.status(201).json(publicUser(user))
})
app.patch('/api/users/:id', requireRole('OWNER'), async (req, res) => {
  const me = identity(req)
  const id = String(req.params.id)
  const body = parse(z.object({ active: z.boolean().optional(), branchId: z.string().min(1).optional() }), req.body)
  if (id === me.id && body.active === false) throw new ApiError(400, 'Akun sendiri tidak dapat dinonaktifkan.')
  const target = await db.user.findFirst({ where: { id, storeId: me.storeId } })
  if (!target) throw new ApiError(404, 'Pengguna tidak ditemukan.')
  if (target.role === 'OWNER') throw new ApiError(400, 'Akun owner tidak dapat diubah.')
  if (body.branchId && !await db.branch.findFirst({ where: { id: body.branchId, storeId: me.storeId, active: true } })) throw new ApiError(400, 'Cabang pengguna tidak valid.')
  const updated = await db.$transaction(async tx => {
    const user = await tx.user.update({ where: { id }, data: body, include: { branch: { select: { name: true } } } })
    if (body.active === false || body.branchId) await tx.session.deleteMany({ where: { userId: id } })
    await audit(tx, me, body.branchId ? 'TRANSFER' : body.active ? 'ACTIVATE' : 'DEACTIVATE', 'USER', id)
    return user
  })
  res.json(publicUser(updated))
})

app.get('/api/products', async (req, res) => {
  const me = identity(req)
  const { page, limit, search } = parse(pageSchema, req.query)
  const where: Prisma.ProductWhereInput = { storeId: me.storeId, ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { sku: { contains: search, mode: 'insensitive' } }] } : {}) }
  const [items, total] = await db.$transaction([db.product.findMany({ where, include: { inventories: { where: { branchId: me.branchId }, select: { stock: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), db.product.count({ where })])
  res.json({ items: items.map(({ inventories, ...product }) => ({ ...product, stock: inventories[0]?.stock ?? 0 })), total, page, limit })
})
app.post('/api/products', requireRole('OWNER'), async (req, res) => {
  const me = identity(req)
  if (me.isDemo && await db.product.count({ where: { storeId: me.storeId } }) >= 30) throw new ApiError(429, 'Batas produk ruang demo tercapai.')
  const body = parse(productBody, req.body)
  const item = await db.$transaction(async tx => {
    const created = await tx.product.create({ data: { storeId: me.storeId, sku: body.sku.toUpperCase(), name: body.name, category: body.category || null, price: body.price, minStock: body.minStock, active: body.active ?? true } })
    await tx.branchInventory.create({ data: { storeId: me.storeId, branchId: me.branchId, productId: created.id, stock: 0 } })
    await audit(tx, me, 'CREATE', 'PRODUCT', created.id)
    return created
  })
  res.status(201).json({ ...item, stock: 0 })
})
app.patch('/api/products/:id', requireRole('OWNER'), async (req, res) => {
  const me = identity(req)
  const id = String(req.params.id)
  const body = parse(productBody.partial(), req.body)
  const existing = await db.product.findFirst({ where: { id, storeId: me.storeId } })
  if (!existing) throw new ApiError(404, 'Produk tidak ditemukan.')
  const item = await db.$transaction(async tx => {
    const updated = await tx.product.update({ where: { id }, data: { ...body, ...(body.sku ? { sku: body.sku.toUpperCase() } : {}), ...(body.category !== undefined ? { category: body.category || null } : {}) } })
    await audit(tx, me, 'UPDATE', 'PRODUCT', id)
    return updated
  })
  const inventory = await db.branchInventory.findUnique({ where: { branchId_productId: { branchId: me.branchId, productId: id } } })
  res.json({ ...item, stock: inventory?.stock ?? 0 })
})

app.get('/api/stock-movements', async (req, res) => {
  const me = identity(req)
  const { page, limit } = parse(pageSchema, req.query)
  const where = { storeId: me.storeId, branchId: me.branchId }
  const [items, total] = await db.$transaction([db.stockMovement.findMany({ where, include: { product: { select: { name: true, sku: true } }, user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), db.stockMovement.count({ where })])
  res.json({ items, total, page, limit })
})
app.post('/api/stock-movements', async (req, res) => {
  const me = identity(req)
  if (me.isDemo && await db.stockMovement.count({ where: { storeId: me.storeId } }) >= 200) throw new ApiError(429, 'Batas catatan stok ruang demo tercapai.')
  const body = parse(z.object({ productId: z.string().min(1), type: z.enum(['IN', 'ADJUSTMENT']), quantity: int.min(-1_000_000).max(1_000_000), reason: z.string().trim().min(3).max(200) }), req.body)
  if (me.role === 'STAFF' && body.type === 'ADJUSTMENT') throw new ApiError(403, 'Koreksi stok hanya dapat dilakukan manajer atau pemilik.')
  if (body.type === 'IN' && body.quantity <= 0) throw new ApiError(400, 'Stok masuk harus lebih dari nol.')
  if (body.type === 'ADJUSTMENT' && body.quantity === 0) throw new ApiError(400, 'Koreksi stok tidak boleh nol.')
  const movement = await db.$transaction(async tx => {
    const product = await tx.product.findFirst({ where: { id: body.productId, storeId: me.storeId, active: true } })
    if (!product) throw new ApiError(404, 'Produk tidak ditemukan.')
    await tx.branchInventory.upsert({ where: { branchId_productId: { branchId: me.branchId, productId: product.id } }, create: { storeId: me.storeId, branchId: me.branchId, productId: product.id, stock: 0 }, update: {} })
    const changed = await tx.branchInventory.updateMany({ where: { branchId: me.branchId, productId: product.id, ...(body.quantity < 0 ? { stock: { gte: -body.quantity } } : { stock: { lte: 2_147_483_647 - body.quantity } }) }, data: { stock: { increment: body.quantity } } })
    if (changed.count !== 1) throw new ApiError(409, 'Perubahan stok tidak dapat diterapkan karena batas saldo.')
    const after = await tx.branchInventory.findUniqueOrThrow({ where: { branchId_productId: { branchId: me.branchId, productId: product.id } } })
    const result = await tx.stockMovement.create({ data: { storeId: me.storeId, branchId: me.branchId, productId: product.id, userId: me.id, type: body.type, quantity: body.quantity, balanceAfter: after.stock, reason: body.reason } })
    await audit(tx, me, body.type, 'PRODUCT', product.id)
    return result
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  res.status(201).json(movement)
})

app.get('/api/orders', async (req, res) => {
  const me = identity(req)
  const { page, limit, search } = parse(pageSchema, req.query)
  const status = req.query.status ? parse(z.enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']), req.query.status) : undefined
  const where: Prisma.OrderWhereInput = { storeId: me.storeId, branchId: me.branchId, ...(status ? { status } : {}), ...(search ? { OR: [{ number: { contains: search, mode: 'insensitive' } }, { customerName: { contains: search, mode: 'insensitive' } }] } : {}) }
  const [items, total] = await db.$transaction([db.order.findMany({ where, include: { items: { include: { product: { select: { name: true, sku: true } } } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), db.order.count({ where })])
  res.json({ items, total, page, limit })
})
app.post('/api/orders', async (req, res) => {
  const me = identity(req)
  if (me.isDemo && await db.order.count({ where: { storeId: me.storeId } }) >= 60) throw new ApiError(429, 'Batas pesanan ruang demo tercapai.')
  const body = parse(z.object({ customerName: z.string().trim().min(2).max(100), items: z.array(z.object({ productId: z.string().min(1), quantity: int.min(1).max(100000) })).min(1).max(50) }), req.body)
  if (new Set(body.items.map(x => x.productId)).size !== body.items.length) throw new ApiError(400, 'Produk yang sama hanya boleh muncul sekali.')
  const products = await db.product.findMany({ where: { id: { in: body.items.map(x => x.productId) }, storeId: me.storeId, active: true } })
  if (products.length !== body.items.length) throw new ApiError(400, 'Ada produk yang tidak tersedia di toko ini.')
  const byId = new Map(products.map(x => [x.id, x]))
  const rows = body.items.map(x => ({ productId: x.productId, quantity: x.quantity, unitPrice: byId.get(x.productId)!.price }))
  const total = rows.reduce((sum, x) => sum + x.quantity * x.unitPrice, 0)
  if (!Number.isSafeInteger(total) || total > 2_147_483_647) throw new ApiError(400, 'Total pesanan terlalu besar.')
  const order = await db.$transaction(async tx => {
    const created = await tx.order.create({ data: { storeId: me.storeId, branchId: me.branchId, number: `ORD-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`, customerName: body.customerName, total, items: { create: rows } }, include: { items: true } })
    await audit(tx, me, 'CREATE', 'ORDER', created.id)
    return created
  })
  res.status(201).json(order)
})

async function changeOrder(req: Request, res: Response, action: 'confirm' | 'cancel' | 'fulfill') {
  const me = identity(req)
  if (action === 'cancel' && me.role === 'STAFF') throw new ApiError(403, 'Pembatalan pesanan hanya dapat dilakukan manajer atau pemilik.')
  const id = String(req.params.id)
  const order = await db.$transaction(async tx => {
    const current = await tx.order.findFirst({ where: { id, storeId: me.storeId, branchId: me.branchId }, include: { items: true } })
    if (!current) throw new ApiError(404, 'Pesanan tidak ditemukan.')
    const from: OrderStatus = action === 'confirm' ? 'DRAFT' : 'CONFIRMED'
    const to: OrderStatus = action === 'confirm' ? 'CONFIRMED' : action === 'cancel' ? 'CANCELLED' : 'FULFILLED'
    const transition = orderTransition(current.status, action)
    if (transition === 'repeat') return current
    if (transition === 'invalid') throw new ApiError(409, 'Status pesanan tidak mengizinkan tindakan ini.')
    if (action === 'cancel' && current.paymentStatus !== 'UNPAID') throw new ApiError(409, 'Pesanan yang sudah dibayar harus diproses sebagai refund.')
    if (action === 'fulfill' && !canFulfill(current.status, current.paymentStatus)) throw new ApiError(409, 'Catat pembayaran sebelum menyelesaikan pesanan.')
    const changed = await tx.order.updateMany({ where: { id, storeId: me.storeId, branchId: me.branchId, status: from }, data: { status: to } })
    if (changed.count !== 1) throw new ApiError(409, 'Pesanan sudah berubah. Muat ulang halaman.')
    if (action !== 'fulfill') {
      for (const item of [...current.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const delta = action === 'confirm' ? -item.quantity : item.quantity
        await tx.branchInventory.upsert({ where: { branchId_productId: { branchId: me.branchId, productId: item.productId } }, create: { storeId: me.storeId, branchId: me.branchId, productId: item.productId, stock: 0 }, update: {} })
        const updated = await tx.branchInventory.updateMany({ where: { branchId: me.branchId, productId: item.productId, ...(delta < 0 ? { stock: { gte: -delta } } : { stock: { lte: 2_147_483_647 - delta } }) }, data: { stock: { increment: delta } } })
        if (updated.count !== 1) throw new ApiError(409, `Stok tidak mencukupi untuk salah satu produk.`)
        const inventory = await tx.branchInventory.findUniqueOrThrow({ where: { branchId_productId: { branchId: me.branchId, productId: item.productId } } })
        await tx.stockMovement.create({ data: { storeId: me.storeId, branchId: me.branchId, productId: item.productId, orderId: id, userId: me.id, type: action === 'confirm' ? 'SALE' : 'RETURN', quantity: delta, balanceAfter: inventory.stock, reason: `${action === 'confirm' ? 'Konfirmasi' : 'Pembatalan'} pesanan ${current.number}` } })
      }
    }
    await audit(tx, me, action.toUpperCase(), 'ORDER', id)
    return tx.order.findUniqueOrThrow({ where: { id }, include: { items: true } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  res.json(order)
}
app.post('/api/orders/:id/confirm', (req, res) => changeOrder(req, res, 'confirm'))
app.post('/api/orders/:id/cancel', (req, res) => changeOrder(req, res, 'cancel'))
app.post('/api/orders/:id/fulfill', (req, res) => changeOrder(req, res, 'fulfill'))

app.post('/api/orders/:id/pay', async (req, res) => {
  const me = identity(req)
  const id = String(req.params.id)
  const { method } = parse(z.object({ method: z.enum(['CASH', 'TRANSFER', 'QRIS', 'CARD']) }), req.body)
  const order = await db.$transaction(async tx => {
    const current = await tx.order.findFirst({ where: { id, storeId: me.storeId, branchId: me.branchId } })
    if (!current) throw new ApiError(404, 'Pesanan tidak ditemukan.')
    const transition = paymentTransition(current.status, current.paymentStatus, 'pay')
    if (transition === 'repeat') return current
    if (transition === 'invalid') throw new ApiError(409, 'Pesanan ini belum dapat dibayar.')
    const changed = await tx.order.updateMany({
      where: { id, storeId: me.storeId, branchId: me.branchId, status: 'CONFIRMED', paymentStatus: 'UNPAID' },
      data: { paymentStatus: 'PAID', paymentMethod: method, paidAt: new Date() }
    })
    if (changed.count !== 1) throw new ApiError(409, 'Pembayaran sudah berubah. Muat ulang halaman.')
    await audit(tx, me, 'PAY', 'ORDER', id)
    return tx.order.findUniqueOrThrow({ where: { id }, include: { items: { include: { product: { select: { name: true, sku: true } } } } } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  res.json(order)
})

app.post('/api/orders/:id/refund', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const me = identity(req)
  const id = String(req.params.id)
  const order = await db.$transaction(async tx => {
    const current = await tx.order.findFirst({ where: { id, storeId: me.storeId, branchId: me.branchId }, include: { items: true } })
    if (!current) throw new ApiError(404, 'Pesanan tidak ditemukan.')
    const transition = paymentTransition(current.status, current.paymentStatus, 'refund')
    if (transition === 'repeat') return current
    if (transition === 'invalid') throw new ApiError(409, 'Hanya pesanan dibayar yang belum selesai yang dapat direfund.')
    const changed = await tx.order.updateMany({
      where: { id, storeId: me.storeId, branchId: me.branchId, status: 'CONFIRMED', paymentStatus: 'PAID' },
      data: { status: 'CANCELLED', paymentStatus: 'REFUNDED', refundedAt: new Date() }
    })
    if (changed.count !== 1) throw new ApiError(409, 'Pesanan sudah berubah. Muat ulang halaman.')
    for (const item of [...current.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const inventory = await tx.branchInventory.update({
        where: { branchId_productId: { branchId: me.branchId, productId: item.productId } },
        data: { stock: { increment: item.quantity } }
      })
      await tx.stockMovement.create({ data: { storeId: me.storeId, branchId: me.branchId, productId: item.productId, orderId: id, userId: me.id, type: 'RETURN', quantity: item.quantity, balanceAfter: inventory.stock, reason: `Refund pesanan ${current.number}` } })
    }
    await audit(tx, me, 'REFUND', 'ORDER', id)
    return tx.order.findUniqueOrThrow({ where: { id }, include: { items: { include: { product: { select: { name: true, sku: true } } } } } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  res.json(order)
})

app.get('/api/reports/summary', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const me = identity(req)
  const branchId = me.branchId
  const [products, lowStock, orders, confirmed, paid, unpaid, revenue, recent] = await Promise.all([
    db.product.count({ where: { storeId: me.storeId, active: true } }),
    db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Product" p LEFT JOIN "BranchInventory" i ON i."productId" = p.id AND i."branchId" = ${branchId} WHERE p."storeId" = ${me.storeId} AND p.active = true AND COALESCE(i.stock, 0) <= p."minStock"`,
    db.order.count({ where: { storeId: me.storeId, branchId } }),
    db.order.count({ where: { storeId: me.storeId, branchId, status: { in: ['CONFIRMED', 'FULFILLED'] } } }),
    db.order.count({ where: { storeId: me.storeId, branchId, paymentStatus: 'PAID' } }),
    db.order.count({ where: { storeId: me.storeId, branchId, status: 'CONFIRMED', paymentStatus: 'UNPAID' } }),
    db.order.aggregate({ where: { storeId: me.storeId, branchId, paymentStatus: 'PAID' }, _sum: { total: true } }),
    db.auditLog.findMany({ where: { storeId: me.storeId, branchId }, include: { user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 8 })
  ])
  res.json({ products, lowStock: Number(lowStock[0].count), orders, confirmed, paid, unpaid, revenue: revenue._sum.total || 0, recent })
})
app.get('/api/dashboard', async (req, res) => {
  const me = identity(req)
  const storeId = me.storeId
  const branchId = me.branchId
  const lowStockProducts = () => db.$queryRaw<Array<{ id: string; name: string; sku: string; stock: number; minStock: number }>>`
    SELECT p.id, p.name, p.sku, COALESCE(i.stock, 0)::integer AS stock, p."minStock" FROM "Product" p
    LEFT JOIN "BranchInventory" i ON i."productId" = p.id AND i."branchId" = ${branchId}
    WHERE p."storeId" = ${storeId} AND p.active = true AND COALESCE(i.stock, 0) <= p."minStock"
    ORDER BY stock ASC, p.name ASC LIMIT 5
  `
  const lowStockCount = async () => Number((await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM "Product" p
    LEFT JOIN "BranchInventory" i ON i."productId" = p.id AND i."branchId" = ${branchId}
    WHERE p."storeId" = ${storeId} AND p.active = true AND COALESCE(i.stock, 0) <= p."minStock"
  `)[0].count)
  if (me.role === 'OWNER') {
    const [products, orders, confirmed, revenue, activeUsers, recent, branches, branchAlerts] = await Promise.all([
      db.product.count({ where: { storeId, active: true } }),
      db.order.count({ where: { storeId } }),
      db.order.count({ where: { storeId, status: { in: ['CONFIRMED', 'FULFILLED'] } } }),
      db.order.aggregate({ where: { storeId, paymentStatus: 'PAID' }, _sum: { total: true } }),
      db.user.count({ where: { storeId, active: true } }),
      db.auditLog.findMany({ where: { storeId }, include: { user: { select: { name: true } }, branch: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 6 }),
      db.branch.findMany({ where: { storeId }, include: { orders: { where: { paymentStatus: 'PAID' }, select: { total: true } } }, orderBy: { createdAt: 'asc' } }),
      db.$queryRaw<Array<{ branchId: string; count: bigint }>>`SELECT b.id AS "branchId", COUNT(p.id)::bigint AS count FROM "Branch" b CROSS JOIN "Product" p LEFT JOIN "BranchInventory" i ON i."branchId" = b.id AND i."productId" = p.id WHERE b."storeId" = ${storeId} AND p."storeId" = ${storeId} AND p.active = true AND COALESCE(i.stock, 0) <= p."minStock" GROUP BY b.id`
    ])
    return res.json({ role: me.role, products, lowStock: branchAlerts.reduce((sum, row) => sum + Number(row.count), 0), orders, confirmed, revenue: revenue._sum.total || 0, activeUsers, recent,
      branchCount: branches.filter(branch => branch.active).length,
      branches: branches.map(branch => ({ id: branch.id, name: branch.name, code: branch.code, active: branch.active, revenue: branch.orders.reduce((sum, order) => sum + order.total, 0), lowStock: Number(branchAlerts.find(row => row.branchId === branch.id)?.count ?? 0) })) })
  }
  const [lowStock, products, draftOrders, confirmedOrders] = await Promise.all([
    lowStockCount(), lowStockProducts(),
    db.order.count({ where: { storeId, branchId, status: 'DRAFT' } }),
    db.order.count({ where: { storeId, branchId, status: 'CONFIRMED' } })
  ])
  if (me.role === 'MANAGER') {
    const recent = await db.auditLog.findMany({ where: { storeId, branchId }, include: { user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 6 })
    return res.json({ role: me.role, lowStock, lowStockProducts: products, draftOrders, confirmedOrders, recent })
  }
  const queue = await db.order.findMany({
    where: { storeId, branchId, status: { in: ['DRAFT', 'CONFIRMED'] } },
    select: { id: true, number: true, customerName: true, status: true, paymentStatus: true, createdAt: true },
    orderBy: { createdAt: 'asc' }, take: 6
  })
  return res.json({ role: me.role, lowStock, lowStockProducts: products, draftOrders, confirmedOrders, queue })
})
app.get('/api/reports/orders.xlsx', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const me = identity(req)
  const orders = await db.order.findMany({ where: { storeId: me.storeId, branchId: me.branchId }, orderBy: { createdAt: 'desc' } })
  const workbook = buildOrderWorkbook(`${me.storeName} / ${me.branchName}`, orders)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="laporan-pesanan.xlsx"')
  await workbook.xlsx.write(res)
  res.end()
})
app.get('/api/reports/network.xlsx', requireRole('OWNER'), async (req, res) => {
  const me = identity(req)
  const orders = await db.order.findMany({ where: { storeId: me.storeId }, include: { branch: { select: { name: true } } }, orderBy: { createdAt: 'desc' } })
  const workbook = buildOrderWorkbook(me.storeName, orders.map(({ branch, ...order }) => ({ ...order, branchName: branch.name })))
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="laporan-jaringan.xlsx"')
  await workbook.xlsx.write(res)
  res.end()
})

app.use('/api', (_req, _res, next) => next(new ApiError(404, 'Endpoint tidak ditemukan.')))
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) return res.status(400).json({ error: 'Data tidak valid.', details: error.issues.map(x => ({ field: x.path.join('.'), message: x.message })) })
  if (error instanceof ApiError) return res.status(error.status).json({ error: error.message })
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'Data dengan nilai tersebut sudah ada.' })
    if (error.code === 'P2034') return res.status(409).json({ error: 'Data sedang berubah. Silakan coba lagi.' })
  }
  console.error(error)
  res.status(500).json({ error: 'Terjadi kesalahan server.' })
})
