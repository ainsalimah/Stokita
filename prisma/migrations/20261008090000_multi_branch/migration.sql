CREATE TABLE "Branch" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Branch_storeId_code_key" ON "Branch"("storeId", "code");
CREATE INDEX "Branch_storeId_active_idx" ON "Branch"("storeId", "active");
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Branch" ("id", "storeId", "code", "name")
SELECT 'main-' || "id", "id", 'UTAMA', 'Cabang Utama' FROM "Store";

CREATE TABLE "BranchInventory" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "stock" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "BranchInventory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BranchInventory_branchId_productId_key" ON "BranchInventory"("branchId", "productId");
CREATE INDEX "BranchInventory_storeId_branchId_idx" ON "BranchInventory"("storeId", "branchId");
ALTER TABLE "BranchInventory" ADD CONSTRAINT "BranchInventory_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchInventory" ADD CONSTRAINT "BranchInventory_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchInventory" ADD CONSTRAINT "BranchInventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "BranchInventory" ("id", "storeId", "branchId", "productId", "stock")
SELECT 'inventory-' || p."id", p."storeId", 'main-' || p."storeId", p."id", p."stock" FROM "Product" p;

ALTER TABLE "User" ADD COLUMN "branchId" TEXT;
UPDATE "User" SET "branchId" = 'main-' || "storeId" WHERE "role" <> 'OWNER';
CREATE INDEX "User_branchId_idx" ON "User"("branchId");
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Session" ADD COLUMN "activeBranchId" TEXT;
UPDATE "Session" s SET "activeBranchId" = 'main-' || u."storeId" FROM "User" u WHERE s."userId" = u."id";
ALTER TABLE "Session" ADD CONSTRAINT "Session_activeBranchId_fkey" FOREIGN KEY ("activeBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN "branchId" TEXT;
UPDATE "Order" SET "branchId" = 'main-' || "storeId";
ALTER TABLE "Order" ALTER COLUMN "branchId" SET NOT NULL;
CREATE INDEX "Order_branchId_status_createdAt_idx" ON "Order"("branchId", "status", "createdAt");
ALTER TABLE "Order" ADD CONSTRAINT "Order_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD COLUMN "branchId" TEXT;
UPDATE "StockMovement" SET "branchId" = 'main-' || "storeId";
ALTER TABLE "StockMovement" ALTER COLUMN "branchId" SET NOT NULL;
CREATE INDEX "StockMovement_branchId_createdAt_idx" ON "StockMovement"("branchId", "createdAt");
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD COLUMN "branchId" TEXT;
UPDATE "AuditLog" SET "branchId" = 'main-' || "storeId";
CREATE INDEX "AuditLog_branchId_createdAt_idx" ON "AuditLog"("branchId", "createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Product" DROP COLUMN "stock";
