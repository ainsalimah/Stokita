import { PrismaClient, Role } from '@prisma/client'
import argon2 from 'argon2'
import fs from 'node:fs'
import { loadEnvFile } from 'node:process'

if (fs.existsSync('.env')) loadEnvFile('.env')
const db = new PrismaClient()
const password = process.env.SEED_DEMO_PASSWORD
if (!password || password.length < 12) throw new Error('Set SEED_DEMO_PASSWORD minimal 12 karakter sebelum menjalankan seed.')

try {
  const storeId = 'demo-store-maju'
  await db.store.upsert({ where: { id: storeId }, update: { name: 'Stokita Demo' }, create: { id: storeId, name: 'Stokita Demo' } })
  const branches = []
  for (const item of [{ code: 'PUSAT', name: 'Jakarta Pusat' }, { code: 'SELATAN', name: 'Jakarta Selatan' }, { code: 'BARAT', name: 'Jakarta Barat' }]) {
    branches.push(await db.branch.upsert({ where: { storeId_code: { storeId, code: item.code } }, update: { name: item.name }, create: { storeId, ...item } }))
  }
  const hash = await argon2.hash(password)
  const users: { name: string; email: string; role: Role; branchId: string | null }[] = [
    { name: 'Alya Pratama', email: 'owner@tokomaju.demo', role: 'OWNER', branchId: null },
    { name: 'Bima Saputra', email: 'manager@tokomaju.demo', role: 'MANAGER', branchId: branches[1].id },
    { name: 'Citra Dewi', email: 'staff@tokomaju.demo', role: 'STAFF', branchId: branches[2].id }
  ]
  for (const user of users) await db.user.upsert({ where: { email: user.email }, update: { name: user.name, role: user.role, branchId: user.branchId, passwordHash: hash, active: true }, create: { ...user, storeId, passwordHash: hash } })
  const owner = await db.user.findUniqueOrThrow({ where: { email: users[0].email } })
  const catalog = [
    { sku: 'KOPI-001', name: 'Kopi Arabika 250g', category: 'Minuman', price: 68000, stocks: [28, 17, 9], minStock: 8 },
    { sku: 'TEH-002', name: 'Teh Melati Premium', category: 'Minuman', price: 42000, stocks: [13, 9, 5], minStock: 6 },
    { sku: 'MUG-003', name: 'Mug Keramik Putih', category: 'Aksesori', price: 95000, stocks: [4, 11, 3], minStock: 5 },
    { sku: 'SIRUP-004', name: 'Sirup Vanila 750ml', category: 'Bahan', price: 120000, stocks: [17, 8, 6], minStock: 5 }
  ]
  for (const item of catalog) {
    const product = await db.product.upsert({ where: { storeId_sku: { storeId, sku: item.sku } }, update: { name: item.name, category: item.category, price: item.price, minStock: item.minStock }, create: { storeId, sku: item.sku, name: item.name, category: item.category, price: item.price, minStock: item.minStock } })
    for (const [index, branch] of branches.entries()) {
      const existing = await db.branchInventory.findUnique({ where: { branchId_productId: { branchId: branch.id, productId: product.id } } })
      if (!existing) {
        await db.branchInventory.create({ data: { storeId, branchId: branch.id, productId: product.id, stock: item.stocks[index] } })
        await db.stockMovement.create({ data: { storeId, branchId: branch.id, productId: product.id, userId: owner.id, type: 'IN', quantity: item.stocks[index], balanceAfter: item.stocks[index], reason: 'Stok awal demo' } })
      }
    }
  }
  const coffee = await db.product.findUniqueOrThrow({ where: { storeId_sku: { storeId, sku: 'KOPI-001' } } })
  await db.order.upsert({ where: { storeId_number: { storeId, number: 'ORD-DEMO-001' } }, update: {}, create: { storeId, branchId: branches[0].id, number: 'ORD-DEMO-001', customerName: 'Nadia Putri', total: coffee.price * 2, items: { create: { productId: coffee.id, quantity: 2, unitPrice: coffee.price } } } })
  console.log('Demo tiga cabang siap. Password diambil dari SEED_DEMO_PASSWORD.')
} finally { await db.$disconnect() }
