/**
 * Vérifie la correction des quiz et le calcul des sans-faute.   npm run check:quiz
 */
import { strict as assert } from 'assert';
import { grade, normalizeText, perfectScorers, readQuestions, startOfWeek, validateQuestions } from '../src/quizzes/quiz-rules';

const questions = validateQuestions([
  { id: 'a', type: 'CHOIX', question: 'Les évangiles ?', choices: ['Matthieu', 'Paul', 'Luc', 'Pierre'], correctIndexes: [2, 0] },
  { id: 'b', type: 'TEXTE', question: 'Qui a reçu les 10 commandements ?', answer: 'Moïse' },
]);
assert.deepEqual((questions[0] as any).correctIndexes, [0, 2]);

// Cases à cocher : il faut exactement les bonnes ; réponse écrite : accents, majuscules et ponctuation ignorés
assert.deepEqual(grade(questions, { a: [2, 0], b: '  moise. ' }), { a: true, b: true });
assert.deepEqual(grade(questions, { a: [0], b: 'Moise' }), { a: false, b: true });
assert.deepEqual(grade(questions, { a: [0, 1, 2], b: 'Abraham' }), { a: false, b: false });
assert.deepEqual(grade(questions, {}), { a: false, b: false });
assert.equal(normalizeText('Jésus-Christ !'), 'jesus christ');

// Ancien format (une seule bonne réponse) toujours lisible
assert.deepEqual(readQuestions({ questions: [{ id: 'x', question: '?', choices: ['a', 'b'], correctIndex: 1 }] })[0], {
  id: 'x', type: 'CHOIX', question: '?', choices: ['a', 'b'], correctIndexes: [1],
});

// Formulaire incomplet refusé
assert.throws(() => validateQuestions([{ type: 'CHOIX', question: 'Q', choices: ['a', 'b'], correctIndexes: [] }]));
assert.throws(() => validateQuestions([{ type: 'TEXTE', question: 'Q', answer: ' ' }]));

// Semaine : jeudi 1er octobre 2026 à 10 h (Douala) → lundi 28 septembre 00:00 Douala = dimanche 27 à 23:00 UTC
assert.equal(startOfWeek(new Date('2026-10-01T09:00:00Z')).toISOString(), '2026-09-27T23:00:00.000Z');

// Sans-faute : tous les quiz du mois, note maximale à chacun
const attempts = [
  { memberId: 'ana', score: 5, total: 5 }, { memberId: 'ana', score: 4, total: 4 },
  { memberId: 'ben', score: 5, total: 5 }, { memberId: 'ben', score: 3, total: 4 },
  { memberId: 'cyr', score: 5, total: 5 },
];
assert.deepEqual(perfectScorers(2, attempts), [{ memberId: 'ana', quizzes: 2, score: 9, total: 9 }]);
assert.deepEqual(perfectScorers(0, attempts), []);

console.log('✅ Règles des quiz : tout est bon.');
