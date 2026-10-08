CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID', 'REFUNDED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'QRIS', 'CARD');

ALTER TABLE "Order"
ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
ADD COLUMN "paymentMethod" "PaymentMethod",
ADD COLUMN "paidAt" TIMESTAMP(3),
ADD COLUMN "refundedAt" TIMESTAMP(3);

UPDATE "Order"
SET
  "paymentStatus" = 'PAID',
  "paymentMethod" = 'CASH',
  "paidAt" = "updatedAt"
WHERE "status" = 'FULFILLED';

CREATE INDEX "Order_branchId_paymentStatus_createdAt_idx"
ON "Order"("branchId", "paymentStatus", "createdAt");
