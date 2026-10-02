-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('ASSISE', 'ACTIVITE', 'AUTRE');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "agenda" TEXT,
ADD COLUMN     "decisions" TEXT,
ADD COLUMN     "kind" "EventKind" NOT NULL DEFAULT 'ACTIVITE',
ADD COLUMN     "report_document_id" TEXT;

-- AlterTable
ALTER TABLE "event_participations" ADD COLUMN     "attended" BOOLEAN;

-- CreateIndex
CREATE UNIQUE INDEX "events_report_document_id_key" ON "events"("report_document_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_report_document_id_fkey" FOREIGN KEY ("report_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

