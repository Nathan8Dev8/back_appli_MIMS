-- CreateEnum
CREATE TYPE "ComplaintKind" AS ENUM ('PLAINTE', 'SUGGESTION');

-- CreateEnum
CREATE TYPE "ComplaintCategory" AS ENUM ('ACTIVITES', 'COTISATIONS', 'COMPORTEMENT', 'BUREAU', 'AUTRE');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('RECUE', 'EN_COURS', 'RESOLUE', 'CLASSEE');

-- CreateTable
CREATE TABLE "complaints" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" "ComplaintKind" NOT NULL,
    "category" "ComplaintCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'RECUE',
    "author_id" TEXT NOT NULL,
    "attachment_key" TEXT,
    "attachment_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "reminded_at" TIMESTAMP(3),

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_messages" (
    "id" TEXT NOT NULL,
    "complaint_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "content" TEXT,
    "new_status" "ComplaintStatus",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "complaints_reference_key" ON "complaints"("reference");

-- CreateIndex
CREATE INDEX "complaints_author_id_idx" ON "complaints"("author_id");

-- CreateIndex
CREATE INDEX "complaints_status_idx" ON "complaints"("status");

-- CreateIndex
CREATE INDEX "complaint_messages_complaint_id_idx" ON "complaint_messages"("complaint_id");

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_messages" ADD CONSTRAINT "complaint_messages_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_messages" ADD CONSTRAINT "complaint_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

