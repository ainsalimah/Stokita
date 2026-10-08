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
    await tx.branchInventory.deleteMany({ where: { storeId: { in: ids } } })
    await tx.product.deleteMany({ where: { storeId: { in: ids } } })
    await tx.user.deleteMany({ where: { storeId: { in: ids } } })
    await tx.branch.deleteMany({ where: { storeId: { in: ids } } })
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
    { sku: 'KOPI-001', name: 'Kopi Arabika 250g', category: 'Bahan Baku', price: 68000, stock: 45, minStock: 10 },
    { sku: 'TEH-002', name: 'Teh Melati Premium', category: 'Bahan Baku', price: 42000, stock: 30, minStock: 10 },
    { sku: 'MUG-003', name: 'Mug Keramik Putih', category: 'Aksesori', price: 95000, stock: 8, minStock: 15 },
    { sku: 'SIRUP-004', name: 'Sirup Vanila 750ml', category: 'Bahan Baku', price: 120000, stock: 17, minStock: 5 },
    { sku: 'KUE-005', name: 'Kue Cokelat Kering', category: 'Makanan', price: 35000, stock: 25, minStock: 10 },
    { sku: 'ROTI-006', name: 'Roti Gandum', category: 'Makanan', price: 22000, stock: 12, minStock: 5 },
    { sku: 'SUSU-007', name: 'Susu UHT 1L', category: 'Bahan Baku', price: 18000, stock: 50, minStock: 20 },
    { sku: 'GELAS-008', name: 'Gelas Kaca Es', category: 'Peralatan', price: 45000, stock: 5, minStock: 10 },
    { sku: 'MESIN-009', name: 'Filter Kopi V60', category: 'Peralatan', price: 85000, stock: 14, minStock: 5 },
    { sku: 'TAS-010', name: 'Totebag Kanvas', category: 'Aksesori', price: 65000, stock: 2, minStock: 8 },
    { sku: 'SNACK-011', name: 'Keripik Kentang', category: 'Makanan', price: 15000, stock: 30, minStock: 10 },
    { sku: 'KEMASAN-012', name: 'Cup Plastik 16oz', category: 'Bahan Baku', price: 800, stock: 500, minStock: 100 }
  ]

  return db.$transaction(async tx => {
    const store = await tx.store.create({
      data: {
        id, name: 'Toko Demo', isDemo: true, demoExpiresAt: new Date(now.getTime() + demoAge),
        branches: { create: [
          { code: 'PUSAT', name: 'Jakarta Pusat' },
          { code: 'SELATAN', name: 'Jakarta Selatan' },
          { code: 'BARAT', name: 'Jakarta Barat' }
        ] },
        products: { create: catalog.map(({ stock, ...product }) => product) }
      },
      include: { branches: true, products: true }
    })
    
    const [pusat, selatan, barat] = ['PUSAT', 'SELATAN', 'BARAT'].map(code => store.branches.find(branch => branch.code === code)!)
    
    const owner = await tx.user.create({ data: { storeId: id, name: 'Alya Pratama', email: `owner+${id}@demo.stokita.local`, passwordHash, role: 'OWNER' } })
    const mgrPst = await tx.user.create({ data: { storeId: id, branchId: pusat.id, name: 'Arman Hakim', email: `manager.pst+${id}@demo.stokita.local`, passwordHash, role: 'MANAGER' } })
    const staffPst = await tx.user.create({ data: { storeId: id, branchId: pusat.id, name: 'Bunga Citra', email: `staff.pst+${id}@demo.stokita.local`, passwordHash, role: 'STAFF' } })
    const mgrSel = await tx.user.create({ data: { storeId: id, branchId: selatan.id, name: 'Bima Saputra', email: `manager.sel+${id}@demo.stokita.local`, passwordHash, role: 'MANAGER' } })
    const staffSel = await tx.user.create({ data: { storeId: id, branchId: selatan.id, name: 'Citra Dewi', email: `staff.sel+${id}@demo.stokita.local`, passwordHash, role: 'STAFF' } })
    const mgrBar = await tx.user.create({ data: { storeId: id, branchId: barat.id, name: 'Dodi Hidayat', email: `manager.bar+${id}@demo.stokita.local`, passwordHash, role: 'MANAGER' } })
    const staffBar = await tx.user.create({ data: { storeId: id, branchId: barat.id, name: 'Eka Sari', email: `staff.bar+${id}@demo.stokita.local`, passwordHash, role: 'STAFF' } })

    const user = role === 'OWNER' ? owner : role === 'MANAGER' ? mgrSel : staffPst

    for (const branch of [pusat, selatan, barat]) {
      const factor = branch.id === pusat.id ? 1 : branch.id === selatan.id ? 0.6 : 0.35
      for (const product of store.products) {
        let stock = Math.max(0, Math.round(catalog.find(item => item.sku === product.sku)!.stock * factor))
        
        if (branch.id === selatan.id && product.sku === 'TAS-010') stock = 0;
        if (branch.id === barat.id && product.category === 'Bahan Baku') stock = Math.floor(product.minStock * 0.8);
        
        await tx.branchInventory.create({ data: { storeId: id, branchId: branch.id, productId: product.id, stock } })
        
        if (stock > 0) {
          await tx.stockMovement.create({ data: { storeId: id, branchId: branch.id, productId: product.id, userId: owner.id, type: 'IN', quantity: stock, balanceAfter: stock, reason: 'Stok awal demo' } })
        }
      }
    }

    let orderCounter = 1;
    const createOrder = async (branch: any, customer: string, items: any[], status: 'DRAFT' | 'CONFIRMED' | 'FULFILLED', userObj: any) => {
      const orderNum = `ORD-DEMO-${String(orderCounter++).padStart(3, '0')}`;
      let total = 0;
      const orderItemsData = items.map(i => {
        const p = store.products.find(prod => prod.sku === i.sku)!;
        total += p.price * i.qty;
        return { productId: p.id, quantity: i.qty, unitPrice: p.price };
      });
      
      const order = await tx.order.create({
        data: {
          storeId: id, branchId: branch.id, number: orderNum, customerName: customer, total, status,
          items: { create: orderItemsData }
        }
      });
      
      if (status !== 'DRAFT') {
        for (const i of items) {
          const p = store.products.find(prod => prod.sku === i.sku)!;
          const inv = await tx.branchInventory.findUnique({ where: { branchId_productId: { branchId: branch.id, productId: p.id } } });
          const newStock = inv!.stock - i.qty;
          await tx.branchInventory.update({ where: { branchId_productId: { branchId: branch.id, productId: p.id } }, data: { stock: newStock } });
          
          await tx.stockMovement.create({ data: {
            storeId: id, branchId: branch.id, productId: p.id, orderId: order.id, userId: userObj.id,
            type: 'SALE', quantity: -i.qty, balanceAfter: newStock, reason: `Konfirmasi pesanan ${orderNum}`
          }});
        }
      }
      
      await tx.auditLog.create({ data: { storeId: id, branchId: branch.id, userId: userObj.id, action: 'CREATE', entity: 'ORDER', entityId: order.id } });
      if (status !== 'DRAFT') {
         await tx.auditLog.create({ data: { storeId: id, branchId: branch.id, userId: userObj.id, action: status === 'FULFILLED' ? 'FULFILL' : 'CONFIRM', entity: 'ORDER', entityId: order.id } });
      }
    };

    await createOrder(pusat, 'Nadia Putri', [{ sku: 'KOPI-001', qty: 2 }, { sku: 'KUE-005', qty: 1 }], 'FULFILLED', staffPst);
    await createOrder(pusat, 'Raka Santoso', [{ sku: 'TEH-002', qty: 1 }, { sku: 'ROTI-006', qty: 2 }], 'CONFIRMED', staffPst);
    await createOrder(pusat, 'Kopi Sebelah', [{ sku: 'KEMASAN-012', qty: 50 }], 'DRAFT', staffPst);

    await createOrder(selatan, 'Ibu Ratna', [{ sku: 'SUSU-007', qty: 4 }, { sku: 'SIRUP-004', qty: 1 }], 'CONFIRMED', staffSel);
    await createOrder(selatan, 'Bapak Andi', [{ sku: 'MESIN-009', qty: 1 }], 'FULFILLED', mgrSel);
    await createOrder(selatan, 'CV. Maju', [{ sku: 'KOPI-001', qty: 5 }], 'DRAFT', staffSel);

    await createOrder(barat, 'Maya', [{ sku: 'MUG-003', qty: 2 }], 'CONFIRMED', staffBar);
    await createOrder(barat, 'Agus', [{ sku: 'SNACK-011', qty: 3 }, { sku: 'TEH-002', qty: 1 }], 'DRAFT', staffBar);
    await createOrder(barat, 'Dina', [{ sku: 'GELAS-008', qty: 2 }], 'FULFILLED', mgrBar);

    return { user, store }
  }, { timeout: 30_000 })
}
