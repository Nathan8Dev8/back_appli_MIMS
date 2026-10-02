-- CreateEnum
CREATE TYPE "PaymentNature" AS ENUM ('COTISATION', 'INSCRIPTION', 'COLLECTE');

-- CreateEnum
CREATE TYPE "CollecteKind" AS ENUM ('MARIAGE', 'NAISSANCE', 'DECES', 'AUTRE');

-- CreateEnum
CREATE TYPE "CollecteStatus" AS ENUM ('OUVERTE', 'CLOTUREE');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('REMISE_COLLECTE', 'FONCTIONNEMENT', 'ACTIVITE', 'AUTRE_DEPENSE');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('VALIDE', 'ANNULE');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "collecte_id" TEXT,
ADD COLUMN     "nature" "PaymentNature" NOT NULL DEFAULT 'COTISATION';

-- CreateTable
CREATE TABLE "collectes" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "CollecteKind" NOT NULL,
    "beneficiary" TEXT,
    "description" TEXT,
    "status" "CollecteStatus" NOT NULL DEFAULT 'OUVERTE',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "collectes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "expense_ref" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "label" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "spent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collecte_id" TEXT,
    "note" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'VALIDE',
    "cancel_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "entered_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collectes_status_idx" ON "collectes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_expense_ref_key" ON "expenses"("expense_ref");

-- CreateIndex
CREATE INDEX "expenses_spent_at_idx" ON "expenses"("spent_at");

-- CreateIndex
CREATE INDEX "expenses_category_idx" ON "expenses"("category");

-- CreateIndex
CREATE INDEX "expenses_collecte_id_idx" ON "expenses"("collecte_id");

-- CreateIndex
CREATE INDEX "payments_nature_idx" ON "payments"("nature");

-- CreateIndex
CREATE INDEX "payments_paid_at_idx" ON "payments"("paid_at");

-- CreateIndex
CREATE INDEX "payments_collecte_id_idx" ON "payments"("collecte_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_collecte_id_fkey" FOREIGN KEY ("collecte_id") REFERENCES "collectes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collectes" ADD CONSTRAINT "collectes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_collecte_id_fkey" FOREIGN KEY ("collecte_id") REFERENCES "collectes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_entered_by_fkey" FOREIGN KEY ("entered_by") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
