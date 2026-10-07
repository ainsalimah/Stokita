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
import { buildOrderWorkbook } from './reportWorkbook.js'

if (fs.existsSync('.env')) loadEnvFile('.env')
export const db = new PrismaClient()
export const app = express()
const day = 24 * 60 * 60 * 1000
const sessionAge = 7 * day
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex')

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

type Identity = { id: string; storeId: string; role: Role; name: string; email: string; storeName: string }
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
const publicUser = (user: { id: string; name: string; email: string; role: Role; active: boolean }) => ({ id: user.id, name: user.name, email: user.email, role: user.role, active: user.active })

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
  const token = randomBytes(32).toString('hex')
  await db.session.create({ data: { userId: user.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + sessionAge) } })
  res.cookie('stokita_session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: sessionAge, path: '/' })
  res.json({ user: publicUser(user), store: { id: user.store.id, name: user.store.name } })
})

app.use('/api', async (req: AuthedRequest, _res, next) => {
  try {
    const token = req.cookies?.stokita_session
    if (!token || typeof token !== 'string') throw new ApiError(401, 'Silakan masuk terlebih dahulu.')
    const session = await db.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: { include: { store: true } } } })
    if (!session || session.expiresAt <= new Date() || !session.user.active) throw new ApiError(401, 'Sesi berakhir. Silakan masuk kembali.')
    req.identity = { id: session.user.id, storeId: session.user.storeId, role: session.user.role, name: session.user.name, email: session.user.email, storeName: session.user.store.name }
    req.sessionToken = token
    next()
  } catch (error) { next(error) }
})
app.get('/api/auth/me', (req, res) => { const me = identity(req); res.json({ user: { id: me.id, name: me.name, email: me.email, role: me.role }, store: { id: me.storeId, name: me.storeName } }) })
app.post('/api/auth/logout', async (req: AuthedRequest, res) => {
  if (req.sessionToken) await db.session.deleteMany({ where: { tokenHash: tokenHash(req.sessionToken) } })
  res.clearCookie('stokita_session', { path: '/' })
  res.status(204).end()
})

function requireRole(...roles: Role[]) { return (req: Request, _res: Response, next: NextFunction) => roles.includes(identity(req).role) ? next() : next(new ApiError(403, 'Anda tidak memiliki akses untuk tindakan ini.')) }
async function audit(tx: Prisma.TransactionClient, me: Identity, action: string, entity: string, entityId: string) {
  await tx.auditLog.create({ data: { storeId: me.storeId, userId: me.id, action, entity, entityId } })
}

app.get('/api/users', requireRole('OWNER'), async (req, res) => {
  const me = identity(req)
  const users = await db.user.findMany({ where: { storeId: me.storeId }, orderBy: { createdAt: 'asc' } })
  res.json(users.map(publicUser))
})
app.post('/api/users', requireRole('OWNER'), async (req, res) => {
  const me = identity(req)
  const body = parse(z.object({ name: z.string().trim().min(2).max(100), email: z.email(), password: z.string().min(12).max(128), role: z.enum(['MANAGER', 'STAFF']) }), req.body)
  const user = await db.$transaction(async tx => {
    const created = await tx.user.create({ data: { storeId: me.storeId, name: body.name, email: body.email.toLowerCase(), passwordHash: await argon2.hash(body.password), role: body.role } })
    await audit(tx, me, 'CREATE', 'USER', created.id)
    return created
  })
  res.status(201).json(publicUser(user))
})
app.patch('/api/users/:id', requireRole('OWNER'), async (req, res) => {
  const me = identity(req)
  const id = String(req.params.id)
  const body = parse(z.object({ active: z.boolean() }), req.body)
  if (id === me.id && !body.active) throw new ApiError(400, 'Akun sendiri tidak dapat dinonaktifkan.')
  const target = await db.user.findFirst({ where: { id, storeId: me.storeId } })
  if (!target) throw new ApiError(404, 'Pengguna tidak ditemukan.')
  if (target.role === 'OWNER') throw new ApiError(400, 'Akun owner tidak dapat diubah.')
  const updated = await db.$transaction(async tx => {
    const user = await tx.user.update({ where: { id }, data: { active: body.active } })
    if (!body.active) await tx.session.deleteMany({ where: { userId: id } })
    await audit(tx, me, body.active ? 'ACTIVATE' : 'DEACTIVATE', 'USER', id)
    return user
  })
  res.json(publicUser(updated))
})

app.get('/api/products', async (req, res) => {
  const me = identity(req)
  const { page, limit, search } = parse(pageSchema, req.query)
  const where: Prisma.ProductWhereInput = { storeId: me.storeId, ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { sku: { contains: search, mode: 'insensitive' } }] } : {}) }
  const [items, total] = await db.$transaction([db.product.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), db.product.count({ where })])
  res.json({ items, total, page, limit })
})
app.post('/api/products', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const me = identity(req)
  const body = parse(productBody, req.body)
  const item = await db.$transaction(async tx => {
    const created = await tx.product.create({ data: { storeId: me.storeId, sku: body.sku.toUpperCase(), name: body.name, category: body.category || null, price: body.price, minStock: body.minStock, active: body.active ?? true } })
    await audit(tx, me, 'CREATE', 'PRODUCT', created.id)
    return created
  })
  res.status(201).json(item)
})
app.patch('/api/products/:id', requireRole('OWNER', 'MANAGER'), async (req, res) => {
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
  res.json(item)
})

app.get('/api/stock-movements', async (req, res) => {
  const me = identity(req)
  const { page, limit } = parse(pageSchema, req.query)
  const where = { storeId: me.storeId }
  const [items, total] = await db.$transaction([db.stockMovement.findMany({ where, include: { product: { select: { name: true, sku: true } }, user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), db.stockMovement.count({ where })])
  res.json({ items, total, page, limit })
})
app.post('/api/stock-movements', async (req, res) => {
  const me = identity(req)
  const body = parse(z.object({ productId: z.string().min(1), type: z.enum(['IN', 'ADJUSTMENT']), quantity: int.min(-1_000_000).max(1_000_000), reason: z.string().trim().min(3).max(200) }), req.body)
  if (body.type === 'IN' && body.quantity <= 0) throw new ApiError(400, 'Stok masuk harus lebih dari nol.')
  if (body.type === 'ADJUSTMENT' && body.quantity === 0) throw new ApiError(400, 'Koreksi stok tidak boleh nol.')
  const movement = await db.$transaction(async tx => {
    const product = await tx.product.findFirst({ where: { id: body.productId, storeId: me.storeId, active: true } })
    if (!product) throw new ApiError(404, 'Produk tidak ditemukan.')
    const changed = await tx.product.updateMany({ where: { id: product.id, storeId: me.storeId, ...(body.quantity < 0 ? { stock: { gte: -body.quantity } } : { stock: { lte: 2_147_483_647 - body.quantity } }) }, data: { stock: { increment: body.quantity } } })
    if (changed.count !== 1) throw new ApiError(409, 'Perubahan stok tidak dapat diterapkan karena batas saldo.')
    const after = await tx.product.findUniqueOrThrow({ where: { id: product.id } })
    const result = await tx.stockMovement.create({ data: { storeId: me.storeId, productId: product.id, userId: me.id, type: body.type, quantity: body.quantity, balanceAfter: after.stock, reason: body.reason } })
    await audit(tx, me, body.type, 'PRODUCT', product.id)
    return result
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  res.status(201).json(movement)
})

app.get('/api/orders', async (req, res) => {
  const me = identity(req)
  const { page, limit, search } = parse(pageSchema, req.query)
  const status = req.query.status ? parse(z.enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']), req.query.status) : undefined
  const where: Prisma.OrderWhereInput = { storeId: me.storeId, ...(status ? { status } : {}), ...(search ? { OR: [{ number: { contains: search, mode: 'insensitive' } }, { customerName: { contains: search, mode: 'insensitive' } }] } : {}) }
  const [items, total] = await db.$transaction([db.order.findMany({ where, include: { items: { include: { product: { select: { name: true, sku: true } } } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), db.order.count({ where })])
  res.json({ items, total, page, limit })
})
app.post('/api/orders', async (req, res) => {
  const me = identity(req)
  const body = parse(z.object({ customerName: z.string().trim().min(2).max(100), items: z.array(z.object({ productId: z.string().min(1), quantity: int.min(1).max(100000) })).min(1).max(50) }), req.body)
  if (new Set(body.items.map(x => x.productId)).size !== body.items.length) throw new ApiError(400, 'Produk yang sama hanya boleh muncul sekali.')
  const products = await db.product.findMany({ where: { id: { in: body.items.map(x => x.productId) }, storeId: me.storeId, active: true } })
  if (products.length !== body.items.length) throw new ApiError(400, 'Ada produk yang tidak tersedia di toko ini.')
  const byId = new Map(products.map(x => [x.id, x]))
  const rows = body.items.map(x => ({ productId: x.productId, quantity: x.quantity, unitPrice: byId.get(x.productId)!.price }))
  const total = rows.reduce((sum, x) => sum + x.quantity * x.unitPrice, 0)
  if (!Number.isSafeInteger(total) || total > 2_147_483_647) throw new ApiError(400, 'Total pesanan terlalu besar.')
  const order = await db.$transaction(async tx => {
    const created = await tx.order.create({ data: { storeId: me.storeId, number: `ORD-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`, customerName: body.customerName, total, items: { create: rows } }, include: { items: true } })
    await audit(tx, me, 'CREATE', 'ORDER', created.id)
    return created
  })
  res.status(201).json(order)
})

async function changeOrder(req: Request, res: Response, action: 'confirm' | 'cancel' | 'fulfill') {
  const me = identity(req)
  const id = String(req.params.id)
  const order = await db.$transaction(async tx => {
    const current = await tx.order.findFirst({ where: { id, storeId: me.storeId }, include: { items: true } })
    if (!current) throw new ApiError(404, 'Pesanan tidak ditemukan.')
    const from: OrderStatus = action === 'confirm' ? 'DRAFT' : 'CONFIRMED'
    const to: OrderStatus = action === 'confirm' ? 'CONFIRMED' : action === 'cancel' ? 'CANCELLED' : 'FULFILLED'
    const transition = orderTransition(current.status, action)
    if (transition === 'repeat') return current
    if (transition === 'invalid') throw new ApiError(409, 'Status pesanan tidak mengizinkan tindakan ini.')
    const changed = await tx.order.updateMany({ where: { id, storeId: me.storeId, status: from }, data: { status: to } })
    if (changed.count !== 1) throw new ApiError(409, 'Pesanan sudah berubah. Muat ulang halaman.')
    if (action !== 'fulfill') {
      for (const item of [...current.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const delta = action === 'confirm' ? -item.quantity : item.quantity
        const updated = await tx.product.updateMany({ where: { id: item.productId, storeId: me.storeId, ...(delta < 0 ? { stock: { gte: -delta } } : {}) }, data: { stock: { increment: delta } } })
        if (updated.count !== 1) throw new ApiError(409, `Stok tidak mencukupi untuk salah satu produk.`)
        const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } })
        await tx.stockMovement.create({ data: { storeId: me.storeId, productId: item.productId, orderId: id, userId: me.id, type: action === 'confirm' ? 'SALE' : 'RETURN', quantity: delta, balanceAfter: product.stock, reason: `${action === 'confirm' ? 'Konfirmasi' : 'Pembatalan'} pesanan ${current.number}` } })
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

app.get('/api/reports/summary', async (req, res) => {
  const me = identity(req)
  const [products, lowStock, orders, confirmed, revenue, recent] = await Promise.all([
    db.product.count({ where: { storeId: me.storeId, active: true } }),
    db.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*)::bigint AS count FROM "Product" WHERE "storeId" = ${me.storeId} AND active = true AND stock <= "minStock"`,
    db.order.count({ where: { storeId: me.storeId } }),
    db.order.count({ where: { storeId: me.storeId, status: { in: ['CONFIRMED', 'FULFILLED'] } } }),
    db.order.aggregate({ where: { storeId: me.storeId, status: { in: ['CONFIRMED', 'FULFILLED'] } }, _sum: { total: true } }),
    db.auditLog.findMany({ where: { storeId: me.storeId }, include: { user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 8 })
  ])
  res.json({ products, lowStock: Number(lowStock[0].count), orders, confirmed, revenue: revenue._sum.total || 0, recent })
})
app.get('/api/reports/orders.xlsx', async (req, res) => {
  const me = identity(req)
  const orders = await db.order.findMany({ where: { storeId: me.storeId }, orderBy: { createdAt: 'desc' } })
  const workbook = buildOrderWorkbook(me.storeName, orders)

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="laporan-pesanan.xlsx"')
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
