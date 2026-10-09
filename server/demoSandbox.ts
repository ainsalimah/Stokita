import { randomBytes, randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { PrismaClient, Prisma, Role } from '@prisma/client'

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
    await tx.purchaseOrder.deleteMany({ where: { storeId: { in: ids } } })
    await tx.supplier.deleteMany({ where: { storeId: { in: ids } } })
    await tx.stockTransfer.deleteMany({ where: { storeId: { in: ids } } })
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
    
    const demoUser = (name: string, email: string, role: Role, branchId: string | null = null) => ({
      id: randomUUID(), storeId: id, branchId, name, email: `${email}+${id}@demo.stokita.local`, passwordHash, role, active: true
    })
    const owner = demoUser('Alya Pratama', 'owner', 'OWNER')
    const mgrPst = demoUser('Arman Hakim', 'manager.pst', 'MANAGER', pusat.id)
    const staffPst = demoUser('Bunga Citra', 'staff.pst', 'STAFF', pusat.id)
    const mgrSel = demoUser('Bima Saputra', 'manager.sel', 'MANAGER', selatan.id)
    const staffSel = demoUser('Citra Dewi', 'staff.sel', 'STAFF', selatan.id)
    const mgrBar = demoUser('Dodi Hidayat', 'manager.bar', 'MANAGER', barat.id)
    const staffBar = demoUser('Eka Sari', 'staff.bar', 'STAFF', barat.id)
    await tx.user.createMany({ data: [owner, mgrPst, staffPst, mgrSel, staffSel, mgrBar, staffBar] })

    const user = role === 'OWNER' ? owner : role === 'MANAGER' ? mgrSel : staffPst

    const inventoryRows = []
    const movementRows = []
    for (const branch of [pusat, selatan, barat]) {
      const factor = branch.id === pusat.id ? 1 : branch.id === selatan.id ? 0.6 : 0.35
      for (const product of store.products) {
        let stock = Math.max(0, Math.round(catalog.find(item => item.sku === product.sku)!.stock * factor))
        
        if (branch.id === selatan.id && product.sku === 'TAS-010') stock = 0;
        if (branch.id === barat.id && product.category === 'Bahan Baku') stock = Math.floor(product.minStock * 0.8);
        
        inventoryRows.push({ storeId: id, branchId: branch.id, productId: product.id, stock })
        if (stock > 0) movementRows.push({ storeId: id, branchId: branch.id, productId: product.id, userId: owner.id, type: 'IN' as const, quantity: stock, balanceAfter: stock, reason: 'Stok awal demo' })
      }
    }
    const inventoryKey = (branchId: string, productId: string) => `${branchId}:${productId}`
    const balances = new Map(inventoryRows.map(row => [inventoryKey(row.branchId, row.productId), row.stock]))
    const saleMovements: Prisma.StockMovementCreateManyInput[] = []
    const orderAudits: Prisma.AuditLogCreateManyInput[] = []
    const orderRows: Prisma.OrderCreateManyInput[] = []
    const orderItemRows: Prisma.OrderItemCreateManyInput[] = []

    let orderCounter = 1;
    const createOrder = (branch: any, customer: string, items: any[], status: 'DRAFT' | 'CONFIRMED' | 'FULFILLED', userObj: any, paid = status === 'FULFILLED') => {
      const orderId = randomUUID()
      const orderNum = `ORD-DEMO-${String(orderCounter++).padStart(3, '0')}`;
      let total = 0;
      for (const i of items) {
        const p = store.products.find(prod => prod.sku === i.sku)!;
        total += p.price * i.qty;
        orderItemRows.push({ orderId, productId: p.id, quantity: i.qty, unitPrice: p.price })
      }
      orderRows.push({
        id: orderId, storeId: id, branchId: branch.id, number: orderNum, customerName: customer, total, status,
        paymentStatus: paid ? 'PAID' : 'UNPAID', paymentMethod: paid ? 'QRIS' : null, paidAt: paid ? now : null
      })
      
      if (status !== 'DRAFT') {
        for (const i of items) {
          const p = store.products.find(prod => prod.sku === i.sku)!;
          const key = inventoryKey(branch.id, p.id)
          const newStock = (balances.get(key) ?? 0) - i.qty
          balances.set(key, newStock)
          saleMovements.push({
            storeId: id, branchId: branch.id, productId: p.id, orderId, userId: userObj.id,
            type: 'SALE', quantity: -i.qty, balanceAfter: newStock, reason: `Konfirmasi pesanan ${orderNum}`
          })
        }
      }
      
      orderAudits.push({ storeId: id, branchId: branch.id, userId: userObj.id, action: 'CREATE', entity: 'ORDER', entityId: orderId })
      if (status !== 'DRAFT') orderAudits.push({ storeId: id, branchId: branch.id, userId: userObj.id, action: status === 'FULFILLED' ? 'FULFILL' : 'CONFIRM', entity: 'ORDER', entityId: orderId })
      if (paid) orderAudits.push({ storeId: id, branchId: branch.id, userId: userObj.id, action: 'PAY', entity: 'ORDER', entityId: orderId })
    };

    createOrder(pusat, 'Nadia Putri', [{ sku: 'KOPI-001', qty: 2 }, { sku: 'KUE-005', qty: 1 }], 'FULFILLED', staffPst);
    createOrder(pusat, 'Raka Santoso', [{ sku: 'TEH-002', qty: 1 }, { sku: 'ROTI-006', qty: 2 }], 'CONFIRMED', staffPst);
    createOrder(pusat, 'Kopi Sebelah', [{ sku: 'KEMASAN-012', qty: 50 }], 'DRAFT', staffPst);

    createOrder(selatan, 'Ibu Ratna', [{ sku: 'SUSU-007', qty: 4 }, { sku: 'SIRUP-004', qty: 1 }], 'CONFIRMED', staffSel, true);
    createOrder(selatan, 'Bapak Andi', [{ sku: 'MESIN-009', qty: 1 }], 'FULFILLED', mgrSel);
    createOrder(selatan, 'CV. Maju', [{ sku: 'KOPI-001', qty: 5 }], 'DRAFT', staffSel);

    createOrder(barat, 'Maya', [{ sku: 'MUG-003', qty: 2 }], 'CONFIRMED', staffBar);
    createOrder(barat, 'Agus', [{ sku: 'SNACK-011', qty: 3 }, { sku: 'TEH-002', qty: 1 }], 'DRAFT', staffBar);
    createOrder(barat, 'Dina', [{ sku: 'GELAS-008', qty: 2 }], 'FULFILLED', mgrBar);
    await tx.order.createMany({ data: orderRows })
    await tx.orderItem.createMany({ data: orderItemRows })

    const transferProduct = store.products.find(product => product.sku === 'KEMASAN-012')!
    const demoTransferId = randomUUID()
    await tx.stockTransfer.create({ data: {
      id: demoTransferId, storeId: id, number: 'TRF-DEMO-001', fromBranchId: pusat.id, toBranchId: selatan.id, createdById: owner.id,
      status: 'IN_TRANSIT', sentAt: now, note: 'Pengisian stok untuk akhir pekan'
    } })
    await tx.stockTransferItem.create({ data: { transferId: demoTransferId, productId: transferProduct.id, quantity: 20 } })
    const transferKey = inventoryKey(pusat.id, transferProduct.id)
    const transferBalance = (balances.get(transferKey) ?? 0) - 20
    balances.set(transferKey, transferBalance)
    saleMovements.push({ storeId: id, branchId: pusat.id, productId: transferProduct.id, transferId: demoTransferId, userId: owner.id, type: 'TRANSFER_OUT', quantity: -20, balanceAfter: transferBalance, reason: 'Pengiriman transfer TRF-DEMO-001' })
    orderAudits.push({ storeId: id, branchId: pusat.id, userId: owner.id, action: 'SEND', entity: 'TRANSFER', entityId: demoTransferId })

    const supplierCoffee = { id: randomUUID(), storeId: id, name: 'Nusantara Coffee Supply', contactName: 'Dewi Lestari', email: 'dewi@nusantara.demo', phone: '0812-0000-1001' }
    const supplierPackaging = { id: randomUUID(), storeId: id, name: 'Prima Kemasan', contactName: 'Rudi Hartono', email: 'rudi@prima.demo', phone: '0812-0000-2002' }
    await tx.supplier.createMany({ data: [supplierCoffee, supplierPackaging] })
    const mug = store.products.find(product => product.sku === 'MUG-003')!
    const glass = store.products.find(product => product.sku === 'GELAS-008')!
    const demoPurchaseId = randomUUID()
    await tx.purchaseOrder.create({ data: {
      id: demoPurchaseId, storeId: id, branchId: pusat.id, supplierId: supplierCoffee.id, createdById: owner.id, number: 'PO-DEMO-001', status: 'ORDERED',
      totalCost: 1_400_000, expectedAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), orderedAt: now, note: 'Restok peralatan untuk cabang pusat'
    } })
    await tx.purchaseOrderItem.createMany({ data: [
      { purchaseOrderId: demoPurchaseId, productId: mug.id, quantity: 10, unitCost: 90000 },
      { purchaseOrderId: demoPurchaseId, productId: glass.id, quantity: 20, unitCost: 25000 }
    ] })
    orderAudits.push({ storeId: id, branchId: pusat.id, userId: owner.id, action: 'CREATE', entity: 'PURCHASE_ORDER', entityId: demoPurchaseId })
    orderAudits.push({ storeId: id, branchId: pusat.id, userId: owner.id, action: 'ORDER', entity: 'PURCHASE_ORDER', entityId: demoPurchaseId })
    orderAudits.push({ storeId: id, branchId: pusat.id, userId: owner.id, action: 'CREATE', entity: 'SUPPLIER', entityId: supplierCoffee.id })
    orderAudits.push({ storeId: id, branchId: pusat.id, userId: owner.id, action: 'CREATE', entity: 'SUPPLIER', entityId: supplierPackaging.id })

    for (const inventory of inventoryRows) inventory.stock = balances.get(inventoryKey(inventory.branchId, inventory.productId)) ?? inventory.stock
    await tx.branchInventory.createMany({ data: inventoryRows })
    await tx.stockMovement.createMany({ data: [...movementRows, ...saleMovements] })
    await tx.auditLog.createMany({ data: orderAudits })

    return { user, store }
  }, { maxWait: 60_000, timeout: 30_000 })
}
