import { PrismaClient, Role } from '@prisma/client'
import argon2 from 'argon2'
import fs from 'node:fs'
import { loadEnvFile } from 'node:process'

if (fs.existsSync('.env')) loadEnvFile('.env')
const db = new PrismaClient()
const password = process.env.SEED_DEMO_PASSWORD
if (!password || password.length < 12) throw new Error('Set SEED_DEMO_PASSWORD minimal 12 karakter sebelum menjalankan seed.')

async function seedStore(id: string, name: string, prefix: string) {
  await db.store.upsert({ where: { id }, update: { name }, create: { id, name } })
  const hash = await argon2.hash(password!)
  const users: { name: string; email: string; role: Role }[] = [
    { name: 'Alya Pratama', email: `owner@${prefix}.demo`, role: 'OWNER' },
    { name: 'Bima Saputra', email: `manager@${prefix}.demo`, role: 'MANAGER' },
    { name: 'Citra Dewi', email: `staff@${prefix}.demo`, role: 'STAFF' }
  ]
  for (const user of users) await db.user.upsert({ where: { email: user.email }, update: { name: user.name, role: user.role, passwordHash: hash, active: true }, create: { ...user, storeId: id, passwordHash: hash } })
  const owner = await db.user.findUniqueOrThrow({ where: { email: users[0].email } })
  const catalog = prefix === 'tokomaju' ? [
    { sku: 'KOPI-001', name: 'Kopi Arabika 250g', category: 'Minuman', price: 68000, stock: 28, minStock: 8 },
    { sku: 'TEH-002', name: 'Teh Melati Premium', category: 'Minuman', price: 42000, stock: 13, minStock: 6 },
    { sku: 'MUG-003', name: 'Mug Keramik Putih', category: 'Aksesori', price: 95000, stock: 4, minStock: 5 },
    { sku: 'SIRUP-004', name: 'Sirup Vanila 750ml', category: 'Bahan', price: 120000, stock: 17, minStock: 5 }
  ] : [
    { sku: 'BUKU-001', name: 'Jurnal Harian', category: 'Alat tulis', price: 55000, stock: 21, minStock: 4 },
    { sku: 'PENA-002', name: 'Pulpen Gel Hitam', category: 'Alat tulis', price: 18000, stock: 36, minStock: 10 }
  ]
  for (const item of catalog) {
    const product = await db.product.upsert({ where: { storeId_sku: { storeId: id, sku: item.sku } }, update: { name: item.name, category: item.category, price: item.price, minStock: item.minStock }, create: { storeId: id, sku: item.sku, name: item.name, category: item.category, price: item.price, minStock: item.minStock, stock: item.stock } })
    const hasMovement = await db.stockMovement.count({ where: { productId: product.id } })
    if (!hasMovement) await db.stockMovement.create({ data: { storeId: id, productId: product.id, userId: owner.id, type: 'IN', quantity: item.stock, balanceAfter: item.stock, reason: 'Stok awal demo' } })
  }
  if (prefix === 'tokomaju') {
    const product = await db.product.findUniqueOrThrow({ where: { storeId_sku: { storeId: id, sku: 'KOPI-001' } } })
    await db.order.upsert({ where: { storeId_number: { storeId: id, number: 'ORD-DEMO-001' } }, update: {}, create: { storeId: id, number: 'ORD-DEMO-001', customerName: 'Nadia Putri', status: 'DRAFT', total: product.price * 2, items: { create: { productId: product.id, quantity: 2, unitPrice: product.price } } } })
  }
}

try {
  await seedStore('demo-store-maju', 'Toko Maju', 'tokomaju')
  await seedStore('demo-store-selatan', 'Toko Selatan', 'tokoselatan')
  console.log('Demo data siap. Password diambil dari SEED_DEMO_PASSWORD.')
} finally { await db.$disconnect() }
