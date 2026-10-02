-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('BUG', 'AMELIORATION');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NOUVEAU', 'PRIS_EN_COMPTE', 'TERMINE', 'NON_RETENU');

-- CreateTable
CREATE TABLE "app_feedback" (
    "id" TEXT NOT NULL,
    "kind" "FeedbackKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "page" TEXT,
    "device" TEXT,
    "screenshot_key" TEXT,
    "screenshot_name" TEXT,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NOUVEAU',
    "admin_note" TEXT,
    "author_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_feedback_status_idx" ON "app_feedback"("status");

-- AddForeignKey
ALTER TABLE "app_feedback" ADD CONSTRAINT "app_feedback_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

