-- CreateEnum
CREATE TYPE "EventFrequency" AS ENUM ('WEEKLY', 'MONTHLY_NTH', 'MONTHLY_DAY');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "series_id" TEXT;

-- CreateTable
CREATE TABLE "event_series" (
    "id" TEXT NOT NULL,
    "kind" "EventKind" NOT NULL DEFAULT 'ACTIVITE',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "agenda" TEXT,
    "frequency" "EventFrequency" NOT NULL,
    "weekday" INTEGER,
    "nth" INTEGER,
    "month_day" INTEGER,
    "time" TEXT NOT NULL,
    "until" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "events_series_id_starts_at_key" ON "events"("series_id", "starts_at");

-- AddForeignKey
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "event_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

