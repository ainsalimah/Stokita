import { randomBytes, randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { PrismaClient, Role } from '@prisma/client'

export const demoAge = 24 * 60 * 60 * 1000
const maxActiveDemos = 150
const maxNewDemosPerMinute = 15

export async function cleanupExpiredDemos(db: PrismaClient, now = new Date()) {
  const expired = await db.store.findMany({ where: { isDemo: true, demoExpiresAt: { lte: now } }, select: { id: true }, take: 25 })
  if (!expired.length) return
  const ids = expired.map(store => store.id)
  await db.$transaction(async tx => {
    await tx.session.deleteMany({ where: { user: { storeId: { in: ids } } } })
    await tx.stockMovement.deleteMany({ where: { storeId: { in: ids } } })
    await tx.auditLog.deleteMany({ where: { storeId: { in: ids } } })
    await tx.order.deleteMany({ where: { storeId: { in: ids } } })
    await tx.product.deleteMany({ where: { storeId: { in: ids } } })
    await tx.user.deleteMany({ where: { storeId: { in: ids } } })
    await tx.store.deleteMany({ where: { id: { in: ids }, isDemo: true } })
  })
}

export async function demoHasCapacity(db: PrismaClient, now = new Date()) {
  const [active, recent] = await Promise.all([
    db.store.count({ where: { isDemo: true, demoExpiresAt: { gt: now } } }),
    db.store.count({ where: { isDemo: true, createdAt: { gt: new Date(now.getTime() - 60_000) } } })
  ])
  return active < maxActiveDemos && recent < maxNewDemosPerMinute
}

export async function createDemoSandbox(db: PrismaClient, role: Role, now = new Date()) {
  const id = `demo-${randomUUID()}`
  const passwordHash = await argon2.hash(randomBytes(32).toString('hex'))
  const catalog = [
    { sku: 'KOPI-001', name: 'Kopi Arabika 250g', category: 'Minuman', price: 68000, stock: 28, minStock: 8 },
    { sku: 'TEH-002', name: 'Teh Melati Premium', category: 'Minuman', price: 42000, stock: 12, minStock: 6 },
    { sku: 'MUG-003', name: 'Mug Keramik Putih', category: 'Aksesori', price: 95000, stock: 4, minStock: 5 },
    { sku: 'SIRUP-004', name: 'Sirup Vanila 750ml', category: 'Bahan', price: 120000, stock: 17, minStock: 5 }
  ]
  return db.$transaction(async tx => {
    const store = await tx.store.create({
      data: {
        id, name: 'Toko Demo', isDemo: true, demoExpiresAt: new Date(now.getTime() + demoAge),
        users: { create: [
          { name: 'Alya Pratama', email: `owner+${id}@demo.stokita.local`, passwordHash, role: 'OWNER' },
          { name: 'Bima Saputra', email: `manager+${id}@demo.stokita.local`, passwordHash, role: 'MANAGER' },
          { name: 'Citra Dewi', email: `staff+${id}@demo.stokita.local`, passwordHash, role: 'STAFF' }
        ] },
        products: { create: catalog }
      },
      include: { users: true, products: true }
    })
    const owner = store.users.find(user => user.role === 'OWNER')!
    const user = store.users.find(user => user.role === role)!
    const coffee = store.products.find(product => product.sku === 'KOPI-001')!
    const tea = store.products.find(product => product.sku === 'TEH-002')!
    await tx.stockMovement.createMany({ data: store.products.map(product => ({
      storeId: id, productId: product.id, userId: owner.id, type: 'IN',
      quantity: product.sku === 'TEH-002' ? 13 : product.stock,
      balanceAfter: product.sku === 'TEH-002' ? 13 : product.stock,
      reason: 'Stok awal demo'
    })) })
    const draft = await tx.order.create({ data: {
      storeId: id, number: 'ORD-DEMO-001', customerName: 'Nadia Putri', total: coffee.price * 2,
      items: { create: { productId: coffee.id, quantity: 2, unitPrice: coffee.price } }
    } })
    const confirmed = await tx.order.create({ data: {
      storeId: id, number: 'ORD-DEMO-002', customerName: 'Raka Santoso', status: 'CONFIRMED', total: tea.price,
      items: { create: { productId: tea.id, quantity: 1, unitPrice: tea.price } }
    } })
    await tx.stockMovement.create({ data: {
      storeId: id, productId: tea.id, orderId: confirmed.id, userId: owner.id,
      type: 'SALE', quantity: -1, balanceAfter: tea.stock, reason: 'Konfirmasi pesanan ORD-DEMO-002'
    } })
    await tx.auditLog.createMany({ data: [
      { storeId: id, userId: owner.id, action: 'CREATE', entity: 'ORDER', entityId: draft.id },
      { storeId: id, userId: owner.id, action: 'CONFIRM', entity: 'ORDER', entityId: confirmed.id }
    ] })
    return { user, store }
  }, { timeout: 20_000 })
}
