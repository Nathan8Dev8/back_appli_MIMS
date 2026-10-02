/**
 * Vérifie la règle « cotisation le 2e dimanche du mois ».   npm run check:cotisation
 */
import { strict as assert } from 'assert';
import { firstOwedMonth, isOverdue, lastOverdueMonth, planCotisationAllocation, secondSundayUtc } from '../src/payments/cotisation-allocation';

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const day = (x: Date) => x.toISOString().slice(0, 10);

// 2e dimanche : mois commençant un jeudi, un dimanche, un samedi
assert.equal(day(secondSundayUtc(d('2026-10-01'))), '2026-10-11');
assert.equal(day(secondSundayUtc(d('2026-11-01'))), '2026-11-08');
assert.equal(day(secondSundayUtc(d('2026-08-01'))), '2026-08-09');

// En retard seulement à partir du lundi qui suit
assert.equal(isOverdue(d('2026-10-01'), d('2026-10-11')), false);
assert.equal(isOverdue(d('2026-10-01'), d('2026-10-12')), true);
assert.equal(day(lastOverdueMonth(d('2026-10-05'))), '2026-09-01');
assert.equal(day(lastOverdueMonth(d('2026-10-12'))), '2026-10-01');

// Nouveau membre : prochain 2e dimanche (le jour même compris)
assert.equal(day(firstOwedMonth(d('2026-10-05'))), '2026-10-01');
assert.equal(day(firstOwedMonth(d('2026-10-11'))), '2026-10-01');
assert.equal(day(firstOwedMonth(d('2026-10-20'))), '2026-11-01');

// Arrivé le 20 octobre, il verse 500 le jour même : ça paie novembre, pas octobre
const steps = planCotisationAllocation({ amount: 500, refMonth: d('2026-10-01'), dues: [], firstMonth: firstOwedMonth(d('2026-10-20')) });
assert.deepEqual(steps.map((s) => [day(s.dueMonth), s.amount]), [['2026-11-01', 500]]);

console.log('✅ Règle du 2e dimanche : tout est bon.');
