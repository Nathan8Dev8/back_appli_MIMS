-- AlterTable
ALTER TABLE "quizzes" ADD COLUMN     "comment" TEXT;

-- AlterTable
ALTER TABLE "quiz_attempts" ADD COLUMN     "results" JSONB NOT NULL DEFAULT '{}';

-- Participations de comptes déjà supprimés (aucun lien n'existait jusqu'ici)
DELETE FROM "quiz_attempts" WHERE "member_id" NOT IN (SELECT "id" FROM "members");

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

