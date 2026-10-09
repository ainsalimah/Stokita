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
import { transferTransition } from './transferRules.js'
import { purchaseTransition } from './purchaseRules.js'
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
const supplierBody = z.object({ name: z.string().trim().min(2).max(120), contactName: z.string().trim().max(100).optional().nullable(), email: z.string().trim().email().max(160).optional().nullable().or(z.literal('')), phone: z.string().trim().max(40).optional().nullable(), active: z.boolean().optional() })
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
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 20_000 })
  res.status(201).json(movement)
})

const transferInclude = {
  fromBranch: { select: { id: true, name: true, code: true } },
  toBranch: { select: { id: true, name: true, code: true } },
  createdBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
  receivedBy: { select: { name: true } },
  items: { include: { product: { select: { name: true, sku: true } } } }
} as const

app.get('/api/transfer-options', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const me = identity(req)
  const branches = await db.branch.findMany({ where: { storeId: me.storeId, active: true, id: { not: me.branchId } }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } })
  res.json(branches)
})

app.get('/api/transfers', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const me = identity(req)
  const { page, limit } = parse(pageSchema, req.query)
  const where: Prisma.StockTransferWhereInput = { storeId: me.storeId, ...(me.role === 'OWNER' ? {} : { OR: [{ fromBranchId: me.branchId }, { toBranchId: me.branchId }] }) }
  const [items, total] = await db.$transaction([
    db.stockTransfer.findMany({ where, include: transferInclude, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    db.stockTransfer.count({ where })
  ])
  res.json({ items, total, page, limit })
})

app.post('/api/transfers', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const me = identity(req)
  if (me.isDemo && await db.stockTransfer.count({ where: { storeId: me.storeId } }) >= 40) throw new ApiError(429, 'Batas transfer ruang demo tercapai.')
  const body = parse(z.object({
    toBranchId: z.string().min(1),
    note: z.string().trim().max(200).optional().nullable(),
    items: z.array(z.object({ productId: z.string().min(1), quantity: int.min(1).max(1_000_000) })).min(1).max(50)
  }), req.body)
  if (body.toBranchId === me.branchId) throw new ApiError(400, 'Cabang tujuan harus berbeda dari cabang asal.')
  if (new Set(body.items.map(item => item.productId)).size !== body.items.length) throw new ApiError(400, 'Produk yang sama hanya boleh muncul sekali.')
  const transfer = await db.$transaction(async tx => {
    const [destination, products] = await Promise.all([
      tx.branch.findFirst({ where: { id: body.toBranchId, storeId: me.storeId, active: true } }),
      tx.product.findMany({ where: { id: { in: body.items.map(item => item.productId) }, storeId: me.storeId, active: true }, select: { id: true } })
    ])
    if (!destination) throw new ApiError(404, 'Cabang tujuan tidak ditemukan.')
    if (products.length !== body.items.length) throw new ApiError(400, 'Ada produk yang tidak tersedia.')
    const created = await tx.stockTransfer.create({ data: {
      storeId: me.storeId, number: `TRF-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`,
      fromBranchId: me.branchId, toBranchId: destination.id, createdById: me.id, note: body.note || null,
      status: me.role === 'OWNER' ? 'APPROVED' : 'PENDING_APPROVAL',
      ...(me.role === 'OWNER' ? { approvedById: me.id, approvedAt: new Date() } : {}),
      items: { create: body.items }
    }, include: transferInclude })
    await audit(tx, me, 'CREATE', 'TRANSFER', created.id)
    if (me.role === 'OWNER') await audit(tx, me, 'APPROVE', 'TRANSFER', created.id)
    return created
  })
  res.status(201).json(transfer)
})

async function changeTransfer(req: Request, res: Response, action: 'approve' | 'send' | 'receive' | 'cancel') {
  const me = identity(req)
  const id = String(req.params.id)
  const transfer = await db.$transaction(async tx => {
    const current = await tx.stockTransfer.findFirst({ where: { id, storeId: me.storeId }, include: { items: true } })
    if (!current) throw new ApiError(404, 'Transfer stok tidak ditemukan.')
    if (action === 'approve' && me.role !== 'OWNER') throw new ApiError(403, 'Persetujuan transfer hanya dapat dilakukan pemilik.')
    if (action !== 'approve' && (action === 'receive' ? current.toBranchId !== me.branchId : current.fromBranchId !== me.branchId)) throw new ApiError(403, 'Pilih cabang yang sesuai untuk tindakan ini.')
    const transition = transferTransition(current.status, action)
    if (transition === 'repeat') return tx.stockTransfer.findUniqueOrThrow({ where: { id }, include: transferInclude })
    if (transition === 'invalid') throw new ApiError(409, 'Status transfer tidak mengizinkan tindakan ini.')

    if (action === 'send') {
      for (const item of [...current.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const changed = await tx.branchInventory.updateMany({ where: { branchId: current.fromBranchId, productId: item.productId, stock: { gte: item.quantity } }, data: { stock: { decrement: item.quantity } } })
        if (changed.count !== 1) throw new ApiError(409, 'Stok cabang asal tidak mencukupi.')
        const inventory = await tx.branchInventory.findUniqueOrThrow({ where: { branchId_productId: { branchId: current.fromBranchId, productId: item.productId } } })
        await tx.stockMovement.create({ data: { storeId: me.storeId, branchId: current.fromBranchId, productId: item.productId, transferId: id, userId: me.id, type: 'TRANSFER_OUT', quantity: -item.quantity, balanceAfter: inventory.stock, reason: `Pengiriman transfer ${current.number}` } })
      }
    }
    if (action === 'receive') {
      for (const item of [...current.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const inventory = await tx.branchInventory.upsert({ where: { branchId_productId: { branchId: current.toBranchId, productId: item.productId } }, create: { storeId: me.storeId, branchId: current.toBranchId, productId: item.productId, stock: item.quantity }, update: { stock: { increment: item.quantity } } })
        await tx.stockMovement.create({ data: { storeId: me.storeId, branchId: current.toBranchId, productId: item.productId, transferId: id, userId: me.id, type: 'TRANSFER_IN', quantity: item.quantity, balanceAfter: inventory.stock, reason: `Penerimaan transfer ${current.number}` } })
      }
    }
    const nextStatus = action === 'approve' ? 'APPROVED' : action === 'send' ? 'IN_TRANSIT' : action === 'receive' ? 'RECEIVED' : 'CANCELLED'
    const changed = await tx.stockTransfer.updateMany({ where: { id, status: current.status }, data: { status: nextStatus, ...(action === 'approve' ? { approvedAt: new Date(), approvedById: me.id } : {}), ...(action === 'send' ? { sentAt: new Date() } : {}), ...(action === 'receive' ? { receivedAt: new Date(), receivedById: me.id } : {}) } })
    if (changed.count !== 1) throw new ApiError(409, 'Transfer sudah berubah. Muat ulang halaman.')
    await audit(tx, me, action.toUpperCase(), 'TRANSFER', id)
    return tx.stockTransfer.findUniqueOrThrow({ where: { id }, include: transferInclude })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 20_000 })
  res.json(transfer)
}

app.post('/api/transfers/:id/send', requireRole('OWNER', 'MANAGER'), (req, res) => changeTransfer(req, res, 'send'))
app.post('/api/transfers/:id/receive', requireRole('OWNER', 'MANAGER'), (req, res) => changeTransfer(req, res, 'receive'))
app.post('/api/transfers/:id/cancel', requireRole('OWNER', 'MANAGER'), (req, res) => changeTransfer(req, res, 'cancel'))
app.post('/api/transfers/:id/approve', requireRole('OWNER'), (req, res) => changeTransfer(req, res, 'approve'))

const purchaseInclude = {
  branch: { select: { id: true, name: true, code: true } },
  supplier: { select: { id: true, name: true, contactName: true, phone: true } },
  createdBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
  receivedBy: { select: { name: true } },
  items: { include: { product: { select: { name: true, sku: true } } } }
} as const

app.get('/api/suppliers', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const me = identity(req)
  const suppliers = await db.supplier.findMany({ where: { storeId: me.storeId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] })
  res.json(suppliers)
})

app.post('/api/suppliers', requireRole('OWNER'), async (req, res) => {
  const me = identity(req)
  if (me.isDemo && await db.supplier.count({ where: { storeId: me.storeId } }) >= 20) throw new ApiError(429, 'Batas pemasok ruang demo tercapai.')
  const body = parse(supplierBody, req.body)
  const supplier = await db.$transaction(async tx => {
    const created = await tx.supplier.create({ data: { storeId: me.storeId, name: body.name, contactName: body.contactName || null, email: body.email || null, phone: body.phone || null, active: body.active ?? true } })
    await audit(tx, me, 'CREATE', 'SUPPLIER', created.id)
    return created
  })
  res.status(201).json(supplier)
})

app.patch('/api/suppliers/:id', requireRole('OWNER'), async (req, res) => {
  const me = identity(req)
  const id = String(req.params.id)
  const body = parse(supplierBody.partial(), req.body)
  const existing = await db.supplier.findFirst({ where: { id, storeId: me.storeId } })
  if (!existing) throw new ApiError(404, 'Pemasok tidak ditemukan.')
  const supplier = await db.$transaction(async tx => {
    const updated = await tx.supplier.update({ where: { id }, data: { ...body, ...(body.contactName !== undefined ? { contactName: body.contactName || null } : {}), ...(body.email !== undefined ? { email: body.email || null } : {}), ...(body.phone !== undefined ? { phone: body.phone || null } : {}) } })
    await audit(tx, me, 'UPDATE', 'SUPPLIER', id)
    return updated
  })
  res.json(supplier)
})

app.get('/api/purchase-options', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const me = identity(req)
  const [suppliers, lowStock] = await Promise.all([
    db.supplier.findMany({ where: { storeId: me.storeId, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.$queryRaw<Array<{ id: string; name: string; sku: string; stock: number; minStock: number; recommendedQty: number }>>`
      SELECT p.id, p.name, p.sku, COALESCE(i.stock, 0)::integer AS stock, p."minStock",
        GREATEST(p."minStock" * 2 - COALESCE(i.stock, 0), 1)::integer AS "recommendedQty"
      FROM "Product" p
      LEFT JOIN "BranchInventory" i ON i."productId" = p.id AND i."branchId" = ${me.branchId}
      WHERE p."storeId" = ${me.storeId} AND p.active = true AND COALESCE(i.stock, 0) <= p."minStock"
      ORDER BY (p."minStock" - COALESCE(i.stock, 0)) DESC, p.name ASC
      LIMIT 12
    `
  ])
  res.json({ suppliers, lowStock })
})

app.get('/api/purchase-orders', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const me = identity(req)
  const { page, limit } = parse(pageSchema, req.query)
  const where: Prisma.PurchaseOrderWhereInput = { storeId: me.storeId, ...(me.role === 'OWNER' ? {} : { branchId: me.branchId }) }
  const [items, total] = await db.$transaction([
    db.purchaseOrder.findMany({ where, include: purchaseInclude, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    db.purchaseOrder.count({ where })
  ])
  res.json({ items, total, page, limit })
})

app.post('/api/purchase-orders', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const me = identity(req)
  if (me.isDemo && await db.purchaseOrder.count({ where: { storeId: me.storeId } }) >= 40) throw new ApiError(429, 'Batas purchase order ruang demo tercapai.')
  const body = parse(z.object({
    supplierId: z.string().min(1), expectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(), note: z.string().trim().max(200).optional().nullable(),
    items: z.array(z.object({ productId: z.string().min(1), quantity: int.min(1).max(1_000_000), unitCost: int.min(0).max(1_000_000_000) })).min(1).max(50)
  }), req.body)
  if (new Set(body.items.map(item => item.productId)).size !== body.items.length) throw new ApiError(400, 'Produk yang sama hanya boleh muncul sekali.')
  const purchaseOrder = await db.$transaction(async tx => {
    const [supplier, products] = await Promise.all([
      tx.supplier.findFirst({ where: { id: body.supplierId, storeId: me.storeId, active: true } }),
      tx.product.findMany({ where: { id: { in: body.items.map(item => item.productId) }, storeId: me.storeId, active: true }, select: { id: true } })
    ])
    if (!supplier) throw new ApiError(404, 'Pemasok tidak ditemukan atau tidak aktif.')
    if (products.length !== body.items.length) throw new ApiError(400, 'Ada produk yang tidak tersedia.')
    const totalCost = body.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0)
    if (!Number.isSafeInteger(totalCost) || totalCost > 2_147_483_647) throw new ApiError(400, 'Total purchase order terlalu besar.')
    const created = await tx.purchaseOrder.create({ data: {
      storeId: me.storeId, branchId: me.branchId, supplierId: supplier.id, createdById: me.id,
      number: `PO-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`,
      status: me.role === 'OWNER' ? 'APPROVED' : 'PENDING_APPROVAL',
      ...(me.role === 'OWNER' ? { approvedById: me.id, approvedAt: new Date() } : {}),
      totalCost, expectedAt: body.expectedAt ? new Date(`${body.expectedAt}T12:00:00.000Z`) : null, note: body.note || null,
      items: { create: body.items }
    }, include: purchaseInclude })
    await audit(tx, me, 'CREATE', 'PURCHASE_ORDER', created.id)
    if (me.role === 'OWNER') await audit(tx, me, 'APPROVE', 'PURCHASE_ORDER', created.id)
    return created
  })
  res.status(201).json(purchaseOrder)
})

async function changePurchaseOrder(req: Request, res: Response, action: 'approve' | 'order' | 'receive' | 'cancel') {
  const me = identity(req)
  const id = String(req.params.id)
  const purchaseOrder = await db.$transaction(async tx => {
    const current = await tx.purchaseOrder.findFirst({ where: { id, storeId: me.storeId, ...(action === 'approve' && me.role === 'OWNER' ? {} : { branchId: me.branchId }) }, include: { items: true } })
    if (!current) throw new ApiError(404, 'Purchase order tidak ditemukan atau cabang aktif tidak sesuai.')
    if (action === 'approve' && me.role !== 'OWNER') throw new ApiError(403, 'Persetujuan purchase order hanya dapat dilakukan pemilik.')
    const transition = purchaseTransition(current.status, action)
    if (transition === 'repeat') return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: purchaseInclude })
    if (transition === 'invalid') throw new ApiError(409, 'Status purchase order tidak mengizinkan tindakan ini.')
    const nextStatus = action === 'approve' ? 'APPROVED' : action === 'order' ? 'ORDERED' : action === 'receive' ? 'RECEIVED' : 'CANCELLED'
    const changed = await tx.purchaseOrder.updateMany({ where: { id, status: current.status }, data: { status: nextStatus, ...(action === 'approve' ? { approvedAt: new Date(), approvedById: me.id } : {}), ...(action === 'order' ? { orderedAt: new Date() } : {}), ...(action === 'receive' ? { receivedAt: new Date(), receivedById: me.id } : {}) } })
    if (changed.count !== 1) throw new ApiError(409, 'Purchase order sudah berubah. Muat ulang halaman.')
    if (action === 'receive') {
      for (const item of [...current.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const inventory = await tx.branchInventory.upsert({ where: { branchId_productId: { branchId: me.branchId, productId: item.productId } }, create: { storeId: me.storeId, branchId: me.branchId, productId: item.productId, stock: item.quantity }, update: { stock: { increment: item.quantity } } })
        await tx.stockMovement.create({ data: { storeId: me.storeId, branchId: me.branchId, productId: item.productId, purchaseOrderId: id, userId: me.id, type: 'PURCHASE_RECEIPT', quantity: item.quantity, balanceAfter: inventory.stock, reason: `Penerimaan purchase order ${current.number}` } })
      }
    }
    await audit(tx, me, action.toUpperCase(), 'PURCHASE_ORDER', id)
    return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: purchaseInclude })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 20_000 })
  res.json(purchaseOrder)
}

app.post('/api/purchase-orders/:id/order', requireRole('OWNER', 'MANAGER'), (req, res) => changePurchaseOrder(req, res, 'order'))
app.post('/api/purchase-orders/:id/receive', requireRole('OWNER', 'MANAGER'), (req, res) => changePurchaseOrder(req, res, 'receive'))
app.post('/api/purchase-orders/:id/cancel', requireRole('OWNER', 'MANAGER'), (req, res) => changePurchaseOrder(req, res, 'cancel'))
app.post('/api/purchase-orders/:id/approve', requireRole('OWNER'), (req, res) => changePurchaseOrder(req, res, 'approve'))

app.get('/api/orders', async (req, res) => {
  const me = identity(req)
  const { page, limit, search } = parse(pageSchema, req.query)
  const status = req.query.status ? parse(z.enum(['DRAFT', 'CONFIRMED', 'FULFILLED', 'CANCELLED']), req.query.status) : undefined
  const where: Prisma.OrderWhereInput = { storeId: me.storeId, branchId: me.branchId, ...(status ? { status } : {}), ...(search ? { OR: [{ number: { contains: search, mode: 'insensitive' } }, { customerName: { contains: search, mode: 'insensitive' } }] } : {}) }
  const [items, total] = await db.$transaction([db.order.findMany({ where, include: { items: { include: { product: { select: { name: true, sku: true } } } }, returns: { include: { items: true }, orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), db.order.count({ where })])
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
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 20_000 })
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
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 20_000 })
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
      data: { status: 'CANCELLED', paymentStatus: 'REFUNDED', refundedAt: new Date(), refundedTotal: current.total }
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
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 20_000 })
  res.json(order)
})

app.post('/api/orders/:id/returns', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const me = identity(req)
  const id = String(req.params.id)
  const body = parse(z.object({
    reason: z.string().trim().min(3).max(200),
    items: z.array(z.object({ productId: z.string().min(1), quantity: int.min(1).max(100_000) })).min(1).max(50)
  }), req.body)
  if (new Set(body.items.map(item => item.productId)).size !== body.items.length) throw new ApiError(400, 'Produk retur tidak boleh berulang.')
  const result = await db.$transaction(async tx => {
    const order = await tx.order.findFirst({ where: { id, storeId: me.storeId, branchId: me.branchId }, include: { items: true, returns: { include: { items: true } } } })
    if (!order) throw new ApiError(404, 'Pesanan tidak ditemukan.')
    if (order.status !== 'FULFILLED' || !['PAID', 'PARTIALLY_REFUNDED'].includes(order.paymentStatus)) throw new ApiError(409, 'Retur hanya tersedia untuk pesanan selesai yang masih memiliki nilai dibayar.')
    const orderedByProduct = new Map(order.items.map(item => [item.productId, item]))
    const returnedByProduct = new Map<string, number>()
    for (const previous of order.returns) for (const item of previous.items) returnedByProduct.set(item.productId, (returnedByProduct.get(item.productId) || 0) + item.quantity)
    const rows = body.items.map(item => {
      const ordered = orderedByProduct.get(item.productId)
      if (!ordered) throw new ApiError(400, 'Produk retur tidak ada dalam pesanan.')
      const available = ordered.quantity - (returnedByProduct.get(item.productId) || 0)
      if (item.quantity > available) throw new ApiError(409, `Jumlah retur melebihi sisa untuk salah satu produk.`)
      return { productId: item.productId, quantity: item.quantity, unitPrice: ordered.unitPrice }
    })
    const total = rows.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
    const refundedTotal = order.refundedTotal + total
    if (refundedTotal > order.total) throw new ApiError(409, 'Nilai retur melebihi total pesanan.')
    const salesReturn = await tx.salesReturn.create({ data: {
      storeId: me.storeId, branchId: me.branchId, orderId: order.id, userId: me.id,
      number: `RTR-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`,
      total, reason: body.reason, items: { create: rows }
    }, include: { items: true } })
    for (const item of rows.sort((a, b) => a.productId.localeCompare(b.productId))) {
      const inventory = await tx.branchInventory.upsert({ where: { branchId_productId: { branchId: me.branchId, productId: item.productId } }, create: { storeId: me.storeId, branchId: me.branchId, productId: item.productId, stock: item.quantity }, update: { stock: { increment: item.quantity } } })
      await tx.stockMovement.create({ data: { storeId: me.storeId, branchId: me.branchId, productId: item.productId, orderId: order.id, salesReturnId: salesReturn.id, userId: me.id, type: 'RETURN', quantity: item.quantity, balanceAfter: inventory.stock, reason: `Retur ${salesReturn.number}: ${body.reason}` } })
    }
    const fullyRefunded = refundedTotal === order.total
    await tx.order.update({ where: { id: order.id }, data: { refundedTotal, paymentStatus: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED', refundedAt: new Date() } })
    await audit(tx, me, 'RETURN', 'ORDER', order.id)
    return tx.salesReturn.findUniqueOrThrow({ where: { id: salesReturn.id }, include: { items: { include: { product: { select: { name: true, sku: true } } } } } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 20_000 })
  res.status(201).json(result)
})

app.get('/api/reports/summary', requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const me = identity(req)
  const branchId = me.branchId
  const [products, lowStock, orders, confirmed, paid, unpaid, revenue, recent] = await Promise.all([
    db.product.count({ where: { storeId: me.storeId, active: true } }),
    db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "Product" p LEFT JOIN "BranchInventory" i ON i."productId" = p.id AND i."branchId" = ${branchId} WHERE p."storeId" = ${me.storeId} AND p.active = true AND COALESCE(i.stock, 0) <= p."minStock"`,
    db.order.count({ where: { storeId: me.storeId, branchId } }),
    db.order.count({ where: { storeId: me.storeId, branchId, status: { in: ['CONFIRMED', 'FULFILLED'] } } }),
    db.order.count({ where: { storeId: me.storeId, branchId, paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } }),
    db.order.count({ where: { storeId: me.storeId, branchId, status: 'CONFIRMED', paymentStatus: 'UNPAID' } }),
    db.order.aggregate({ where: { storeId: me.storeId, branchId, paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] } }, _sum: { total: true, refundedTotal: true } }),
    db.auditLog.findMany({ where: { storeId: me.storeId, branchId }, include: { user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 8 })
  ])
  res.json({ products, lowStock: Number(lowStock[0].count), orders, confirmed, paid, unpaid, revenue: (revenue._sum.total || 0) - (revenue._sum.refundedTotal || 0), recent })
})
app.get('/api/dashboard', async (req, res) => {
  const me = identity(req)
  const storeId = me.storeId
  const branchId = me.branchId
  const lowStockProducts = () => db.$queryRaw<Array<{ id: string; name: string; sku: string; stock: number; minStock: number; totalLowStock: number }>>`
    SELECT p.id, p.name, p.sku, COALESCE(i.stock, 0)::integer AS stock, p."minStock", COUNT(*) OVER()::integer AS "totalLowStock" FROM "Product" p
    LEFT JOIN "BranchInventory" i ON i."productId" = p.id AND i."branchId" = ${branchId}
    WHERE p."storeId" = ${storeId} AND p.active = true AND COALESCE(i.stock, 0) <= p."minStock"
    ORDER BY stock ASC, p.name ASC LIMIT 5
  `
  if (me.role === 'OWNER') {
    const [products, activeUsers, pendingTransfers, pendingPurchases, recent, branches] = await Promise.all([
      db.product.count({ where: { storeId, active: true } }),
      db.user.count({ where: { storeId, active: true } }),
      db.stockTransfer.count({ where: { storeId, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } } }),
      db.purchaseOrder.count({ where: { storeId, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } } }),
      db.auditLog.findMany({ where: { storeId }, include: { user: { select: { name: true } }, branch: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 6 }),
      db.$queryRaw<Array<{ id: string; name: string; code: string; active: boolean; orders: bigint; confirmed: bigint; revenue: bigint; lowStock: bigint }>>`
        SELECT b.id, b.name, b.code, b.active,
          COALESCE(o.orders, 0)::bigint AS orders,
          COALESCE(o.confirmed, 0)::bigint AS confirmed,
          COALESCE(o.revenue, 0)::bigint AS revenue,
          COALESCE(s."lowStock", 0)::bigint AS "lowStock"
        FROM "Branch" b
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS orders,
            COUNT(*) FILTER (WHERE status IN ('CONFIRMED', 'FULFILLED')) AS confirmed,
            COALESCE(SUM(total - "refundedTotal") FILTER (WHERE "paymentStatus" IN ('PAID', 'PARTIALLY_REFUNDED')), 0) AS revenue
          FROM "Order" WHERE "branchId" = b.id
        ) o ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS "lowStock" FROM "Product" p
          LEFT JOIN "BranchInventory" i ON i."productId" = p.id AND i."branchId" = b.id
          WHERE p."storeId" = ${storeId} AND p.active = true AND COALESCE(i.stock, 0) <= p."minStock"
        ) s ON true
        WHERE b."storeId" = ${storeId}
        ORDER BY b."createdAt" ASC
      `
    ])
    return res.json({ role: me.role, products, lowStock: branches.reduce((sum, row) => sum + Number(row.lowStock), 0), orders: branches.reduce((sum, row) => sum + Number(row.orders), 0), confirmed: branches.reduce((sum, row) => sum + Number(row.confirmed), 0), revenue: branches.reduce((sum, row) => sum + Number(row.revenue), 0), activeUsers, pendingTransfers, pendingPurchases, recent,
      branchCount: branches.filter(branch => branch.active).length,
      branches: branches.map(branch => ({ id: branch.id, name: branch.name, code: branch.code, active: branch.active, revenue: Number(branch.revenue), lowStock: Number(branch.lowStock) })) })
  }
  const [products, orderCounts] = await Promise.all([
    lowStockProducts(),
    db.order.groupBy({ by: ['status'], where: { storeId, branchId, status: { in: ['DRAFT', 'CONFIRMED'] } }, _count: { _all: true } })
  ])
  const lowStock = products[0]?.totalLowStock ?? 0
  const draftOrders = orderCounts.find(row => row.status === 'DRAFT')?._count._all ?? 0
  const confirmedOrders = orderCounts.find(row => row.status === 'CONFIRMED')?._count._all ?? 0
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
    if (error.code === 'P2028') {
      console.error('Prisma transaction error', { code: error.code, message: error.message, meta: error.meta })
      return res.status(503).json({ error: 'Database masih menyiapkan transaksi. Silakan coba lagi.' })
    }
  }
  console.error(error)
  res.status(500).json({ error: 'Terjadi kesalahan server.' })
})
