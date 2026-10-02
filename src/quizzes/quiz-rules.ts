import { BadRequestException } from '@nestjs/common';

/**
 * Règles des quiz, sans base de données (vérifiables avec `npm run check:quiz`).
 *  - CHOIX : cases à cocher, une ou plusieurs bonnes réponses ; juste si l'on coche exactement les bonnes.
 *  - TEXTE : réponse écrite, comparée sans tenir compte des majuscules, accents, ponctuation ni espaces.
 */
export type QuizQuestion =
  | { id: string; type: 'CHOIX'; question: string; choices: string[]; correctIndexes: number[] }
  | { id: string; type: 'TEXTE'; question: string; answer: string };

export type QuizAnswer = number[] | string;

/** Les premiers quiz n'avaient qu'une bonne réponse (`correctIndex`) : on les lit au nouveau format. */
export function readQuestions(content: unknown): QuizQuestion[] {
  const questions = ((content as any)?.questions ?? []) as any[];
  return questions.map((q) =>
    q.type === 'TEXTE'
      ? { id: q.id, type: 'TEXTE', question: q.question, answer: q.answer ?? '' }
      : { id: q.id, type: 'CHOIX', question: q.question, choices: q.choices ?? [], correctIndexes: q.correctIndexes ?? [q.correctIndex ?? 0] },
  );
}

export function validateQuestions(input: unknown): QuizQuestion[] {
  if (!Array.isArray(input) || !input.length) throw new BadRequestException('Ajoute au moins une question.');
  return input.map((q: any, i) => {
    const n = i + 1;
    const question = String(q?.question ?? '').trim();
    if (!question) throw new BadRequestException(`Question ${n} : écris la question.`);
    const id = String(q?.id || `q${n}`);
    if (q?.type === 'TEXTE') {
      const answer = String(q?.answer ?? '').trim();
      if (!answer) throw new BadRequestException(`Question ${n} : indique la réponse attendue.`);
      return { id, type: 'TEXTE', question, answer };
    }
    const choices = (Array.isArray(q?.choices) ? q.choices : []).map((c: unknown) => String(c ?? '').trim());
    if (choices.length < 2 || choices.some((c: string) => !c)) throw new BadRequestException(`Question ${n} : il faut au moins 2 réponses remplies.`);
    const correctIndexes = [...new Set<number>((Array.isArray(q?.correctIndexes) ? q.correctIndexes : []).map(Number))]
      .filter((x) => Number.isInteger(x) && x >= 0 && x < choices.length)
      .sort((a, b) => a - b);
    if (!correctIndexes.length) throw new BadRequestException(`Question ${n} : coche au moins une bonne réponse.`);
    return { id, type: 'CHOIX', question, choices, correctIndexes };
  });
}

export function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Corrige chaque question : { [questionId]: juste ? }. Une question sans réponse est fausse. */
export function grade(questions: QuizQuestion[], answers: Record<string, QuizAnswer>): Record<string, boolean> {
  const results: Record<string, boolean> = {};
  for (const q of questions) {
    const given = answers?.[q.id];
    if (q.type === 'TEXTE') {
      results[q.id] = typeof given === 'string' && !!given.trim() && normalizeText(given) === normalizeText(q.answer);
    } else {
      const picked = Array.isArray(given) ? [...new Set(given.map(Number))].sort((a, b) => a - b) : [];
      results[q.id] = picked.length === q.correctIndexes.length && picked.every((x, i) => x === q.correctIndexes[i]);
    }
  }
  return results;
}

/** Ce que voit un participant : jamais les bonnes réponses tant que le quiz est ouvert. */
export function publicQuestions(questions: QuizQuestion[], reveal: boolean) {
  return questions.map((q) =>
    reveal
      ? q
      : q.type === 'TEXTE'
        ? { id: q.id, type: q.type, question: q.question }
        : { id: q.id, type: q.type, question: q.question, choices: q.choices },
  );
}

// ——— Calendrier du groupe (Cameroun, UTC+1 toute l'année : pas d'heure d'été) ———
const OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Lundi 00:00 (heure de Douala) de la semaine en cours, en UTC. */
export function startOfWeek(now = new Date()) {
  const local = new Date(now.getTime() + OFFSET_MS);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday) - OFFSET_MS);
}

/** Bornes [début, fin[ d'un mois (heure de Douala), en UTC. month : 0-11. */
export function monthRange(year: number, month: number) {
  return { from: new Date(Date.UTC(year, month, 1) - OFFSET_MS), to: new Date(Date.UTC(year, month + 1, 1) - OFFSET_MS) };
}

/** Mois précédent celui de `now` (heure de Douala). */
export function previousMonth(now = new Date()) {
  const local = new Date(now.getTime() + OFFSET_MS);
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

/**
 * Sans-faute du mois : a répondu à TOUS les quiz publiés ce mois-là, avec la note maximale à chacun.
 */
export function perfectScorers<T extends { memberId: string; score: number; total: number }>(quizCount: number, attempts: T[]) {
  if (!quizCount) return [];
  const byMember = new Map<string, T[]>();
  for (const a of attempts) byMember.set(a.memberId, [...(byMember.get(a.memberId) ?? []), a]);
  return [...byMember.entries()]
    .filter(([, list]) => list.length === quizCount && list.every((a) => a.total > 0 && a.score === a.total))
    .map(([memberId, list]) => ({ memberId, quizzes: list.length, score: list.reduce((s, a) => s + a.score, 0), total: list.reduce((s, a) => s + a.total, 0) }));
}

export const DEFAULT_DURATION_MS = 7 * DAY_MS;
